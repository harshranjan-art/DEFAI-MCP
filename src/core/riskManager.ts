/**
 * Risk Manager — DB-backed risk configuration per user.
 * Called by engine before every strategy execution.
 */

import * as dbOps from './db';
import { logger } from '../utils/logger';
import { getRollingVol, volAdjustedPositionCap } from './vol';

export interface RiskConfig {
  maxPositionUsd: number;
  maxTotalExposureUsd: number;
  maxSlippageBps: number;
  allowedProtocols: string[];  // empty = all allowed
  maxDeltaNeutralPositions: number;
  /** Daily LLM-cost cap in USD. 0 = unlimited. */
  dailyLlmCostCapUsd: number;

  // ─── Phase 6 part 1 — risk depth ──────────────────────────────────────
  /**
   * Daily realized-loss cap in USD. 0 = unlimited. When today's net
   * realized PnL drops below -dailyLossCapUsd, new write actions are
   * refused until UTC midnight.
   */
  dailyLossCapUsd: number;
  /** Allowlist of recipient addresses for send_tokens. */
  sendAddressAllowlist: string[];
  /** Enforce the allowlist? Default true — default-deny for sends. */
  sendAddressAllowlistEnforced: boolean;
  /**
   * Volatility-adjusted sizing: target annualized vol the agent treats
   * as the "1.0x" baseline. adjustedMax = maxPositionUsd * min(1, targetVol/assetVol).
   * 0 = vol adjustment disabled.
   */
  volTargetPercent: number;
  /**
   * Cooldown after a loss: if a trade lost more than X USD in the past
   * `cooldownMinutes`, refuse new write actions. 0 = disabled.
   */
  cooldownLossThresholdUsd: number;
  cooldownMinutes: number;
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionUsd: 1000,
  maxTotalExposureUsd: 5000,
  maxSlippageBps: 100,
  allowedProtocols: [],
  maxDeltaNeutralPositions: 3,
  dailyLlmCostCapUsd: 2.0,
  dailyLossCapUsd: 500,
  sendAddressAllowlist: [],
  sendAddressAllowlistEnforced: true,
  volTargetPercent: 0.30,
  cooldownLossThresholdUsd: 50,
  cooldownMinutes: 15,
};

export function getConfig(userId: string): RiskConfig {
  const user = dbOps.getUser(userId);
  if (!user) return { ...DEFAULT_CONFIG };

  try {
    const stored = user.risk_config ? JSON.parse(user.risk_config) : {};
    return { ...DEFAULT_CONFIG, ...stored };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function configure(userId: string, updates: Partial<RiskConfig>): RiskConfig {
  const current = getConfig(userId);
  const merged: RiskConfig = { ...current, ...updates };

  dbOps.db.prepare(
    'UPDATE users SET risk_config = ? WHERE id = ?'
  ).run(JSON.stringify(merged), userId);

  logger.info('Risk config updated for user %s: %j', userId, merged);
  return merged;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface RiskAction {
  type: 'deposit' | 'swap' | 'arb' | 'delta_neutral' | 'send';
  amountUsd: number;
  /** For deposit/swap/delta — used by vol-adjusted sizing. */
  token?: string;
  protocol?: string;
  slippageBps?: number;
  /** For 'send' only — checked against the allowlist. */
  toAddress?: string;
}

export function check(userId: string, action: RiskAction): RiskCheckResult {
  const config = getConfig(userId);

  // 1. Per-position cap
  if (action.amountUsd > config.maxPositionUsd) {
    return {
      allowed: false,
      reason: `Position size $${action.amountUsd.toFixed(2)} exceeds max $${config.maxPositionUsd.toFixed(2)}. Update risk settings to increase.`,
    };
  }

  // 2. Total exposure
  const positions = dbOps.getPositions(userId, 'open') as any[];
  const totalExposure = positions.reduce((sum: number, p: any) => {
    return sum + (p.current_value_usd || parseFloat(p.amount) * (p.entry_price || 0));
  }, 0);
  if (totalExposure + action.amountUsd > config.maxTotalExposureUsd) {
    return {
      allowed: false,
      reason: `Total exposure would be $${(totalExposure + action.amountUsd).toFixed(2)}, exceeding max $${config.maxTotalExposureUsd.toFixed(2)}.`,
    };
  }

  // 3. Slippage
  if (action.slippageBps && action.slippageBps > config.maxSlippageBps) {
    return {
      allowed: false,
      reason: `Slippage ${action.slippageBps} bps exceeds max ${config.maxSlippageBps} bps.`,
    };
  }

  // 4. Protocol allowlist
  if (config.allowedProtocols.length > 0 && action.protocol) {
    const normalized = action.protocol.toLowerCase();
    const isAllowed = config.allowedProtocols.some((p) => p.toLowerCase() === normalized);
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Protocol "${action.protocol}" is not in your allowed list: ${config.allowedProtocols.join(', ')}.`,
      };
    }
  }

  // 5. Delta-neutral position count
  if (action.type === 'delta_neutral') {
    const deltaPositions = positions.filter((p: any) => p.type === 'delta_neutral');
    if (deltaPositions.length >= config.maxDeltaNeutralPositions) {
      return {
        allowed: false,
        reason: `Already have ${deltaPositions.length} delta-neutral positions (max: ${config.maxDeltaNeutralPositions}).`,
      };
    }
  }

  // 6. send_tokens address allowlist (default-deny when enforced)
  if (action.type === 'send' && config.sendAddressAllowlistEnforced) {
    if (config.sendAddressAllowlist.length === 0) {
      return {
        allowed: false,
        reason:
          'No sendAddressAllowlist configured; sends are blocked by default. Use risk_config to add recipient addresses you trust.',
      };
    }
    const target = (action.toAddress ?? '').toLowerCase();
    const ok = config.sendAddressAllowlist.some((a) => a.toLowerCase() === target);
    if (!ok) {
      return {
        allowed: false,
        reason: `Recipient ${action.toAddress} is not in your send allowlist (${config.sendAddressAllowlist.length} allowed).`,
      };
    }
  }

  // 7. Daily loss cap (realized PnL today, UTC day boundary)
  if (config.dailyLossCapUsd > 0 && action.type !== 'send') {
    const dailyPnl = dailyRealizedPnL(userId);
    if (dailyPnl <= -config.dailyLossCapUsd) {
      return {
        allowed: false,
        reason: `Daily loss cap reached (today: $${dailyPnl.toFixed(2)}, cap: $${(-config.dailyLossCapUsd).toFixed(2)}). New positions blocked until UTC midnight.`,
      };
    }
  }

  // 8. Cooldown after a recent loss — exempt 'send' so the user can still
  //    withdraw after a bad trading day (matches the daily-loss-cap exemption).
  if (config.cooldownLossThresholdUsd > 0 && config.cooldownMinutes > 0 && action.type !== 'send') {
    const recentLoss = worstLossInLastMinutes(userId, config.cooldownMinutes);
    if (recentLoss < -config.cooldownLossThresholdUsd) {
      return {
        allowed: false,
        reason: `Cooldown active: lost $${(-recentLoss).toFixed(2)} in the past ${config.cooldownMinutes} min (threshold $${config.cooldownLossThresholdUsd}). Wait for cooldown to clear.`,
      };
    }
  }

  // 9. Volatility-adjusted position sizing
  if (
    config.volTargetPercent > 0 &&
    action.token &&
    (action.type === 'deposit' || action.type === 'delta_neutral' || action.type === 'swap')
  ) {
    const v = getRollingVol(action.token);
    const { cap_usd, scalar } = volAdjustedPositionCap(config.maxPositionUsd, config.volTargetPercent, v.annualized_vol);
    if (action.amountUsd > cap_usd) {
      return {
        allowed: false,
        reason:
          `Position size $${action.amountUsd.toFixed(2)} exceeds vol-adjusted cap $${cap_usd.toFixed(2)} ` +
          `(${action.token} vol ${(v.annualized_vol * 100).toFixed(0)}%/yr, target ${(config.volTargetPercent * 100).toFixed(0)}%/yr → scalar ${scalar.toFixed(2)}). ` +
          `Lower the amount or raise volTargetPercent.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Sum of (to_amount - from_amount) * price_usd over today's trades.
 * Crude but useful — assumes every trade row represents realized PnL.
 */
function dailyRealizedPnL(userId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const rows = dbOps.db.prepare(`
    SELECT from_amount, to_amount, price_usd
    FROM trades WHERE user_id = ? AND date(executed_at) = ?
  `).all(userId, today) as Array<{ from_amount: string | null; to_amount: string | null; price_usd: number | null }>;
  let pnl = 0;
  for (const r of rows) {
    const fromAmt = r.from_amount ? parseFloat(r.from_amount) : 0;
    const toAmt = r.to_amount ? parseFloat(r.to_amount) : 0;
    pnl += (toAmt - fromAmt) * (r.price_usd ?? 0);
  }
  return pnl;
}

function worstLossInLastMinutes(userId: string, minutes: number): number {
  const rows = dbOps.db.prepare(`
    SELECT from_amount, to_amount, price_usd
    FROM trades WHERE user_id = ? AND executed_at > datetime('now', ?)
  `).all(userId, `-${minutes} minutes`) as Array<{ from_amount: string | null; to_amount: string | null; price_usd: number | null }>;
  let worst = 0;
  for (const r of rows) {
    const pnl = ((r.to_amount ? parseFloat(r.to_amount) : 0) - (r.from_amount ? parseFloat(r.from_amount) : 0)) * (r.price_usd ?? 0);
    if (pnl < worst) worst = pnl;
  }
  return worst;
}
