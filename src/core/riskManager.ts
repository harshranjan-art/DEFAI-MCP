/**
 * Risk Manager — DB-backed risk configuration per user.
 * Called by engine before every strategy execution.
 */

import * as dbOps from './db';
import { logger } from '../utils/logger';

export interface RiskConfig {
  maxPositionUsd: number;
  maxTotalExposureUsd: number;
  maxSlippageBps: number;
  allowedProtocols: string[];  // empty = all allowed
  maxDeltaNeutralPositions: number;
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionUsd: 1000,
  maxTotalExposureUsd: 5000,
  maxSlippageBps: 100, // 1%
  allowedProtocols: [],
  maxDeltaNeutralPositions: 3,
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

export function check(
  userId: string,
  action: {
    type: 'deposit' | 'swap' | 'arb' | 'delta_neutral';
    amountUsd: number;
    protocol?: string;
    slippageBps?: number;
  },
): RiskCheckResult {
  const config = getConfig(userId);

  // Check position size
  if (action.amountUsd > config.maxPositionUsd) {
    return {
      allowed: false,
      reason: `Position size $${action.amountUsd.toFixed(2)} exceeds max $${config.maxPositionUsd.toFixed(2)}. Update risk settings to increase.`,
    };
  }

  // Check total exposure
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

  // Check slippage
  if (action.slippageBps && action.slippageBps > config.maxSlippageBps) {
    return {
      allowed: false,
      reason: `Slippage ${action.slippageBps} bps exceeds max ${config.maxSlippageBps} bps.`,
    };
  }

  // Check allowed protocols
  if (config.allowedProtocols.length > 0 && action.protocol) {
    const normalized = action.protocol.toLowerCase();
    const isAllowed = config.allowedProtocols.some(p => p.toLowerCase() === normalized);
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Protocol "${action.protocol}" is not in your allowed list: ${config.allowedProtocols.join(', ')}.`,
      };
    }
  }

  // Check delta-neutral position count
  if (action.type === 'delta_neutral') {
    const deltaPositions = positions.filter((p: any) => p.type === 'delta_neutral');
    if (deltaPositions.length >= config.maxDeltaNeutralPositions) {
      return {
        allowed: false,
        reason: `Already have ${deltaPositions.length} delta-neutral positions (max: ${config.maxDeltaNeutralPositions}).`,
      };
    }
  }

  return { allowed: true };
}
