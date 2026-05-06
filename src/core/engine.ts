/**
 * Core Engine — thin orchestrator that every transport calls.
 * MCP tools, Telegram commands, and API routes all call engine methods.
 * This centralizes validation, logging, and error handling.
 */

import { encodeFunctionData, parseEther } from 'viem';
import { logger } from '../utils/logger';
import * as positionTracker from './positionTracker';
import * as tradeLogger from './tradeLogger';
import * as yieldOptimizer from './strategy/yieldOptimizer';
import * as arbScanner from './strategy/arbScanner';
import * as deltaNeutral from './strategy/deltaNeutral';
import * as riskManager from './riskManager';
import { pancakeSwapAdapter } from '../adapters/pancakeswap';
import * as walletManager from './walletManager';
import * as dbOps from './db';
import { executeScanMarkets } from '../mcp/tools/scanMarkets';
import { ADDRESSES, ERC20_ABI } from '../utils/constants';
import type { DepositResult, RotationPlan, StrategyResult } from './strategy/types';
import type { RiskConfig } from './riskManager';
import type { Portfolio } from './positionTracker';
import type { Trade } from './tradeLogger';

// Phase 1 — typed boundary primitives
import { EngineResult, ok, err, needsConfirmation, newTraceId } from './result';
import { SwapInputSchema } from './schemas/swap';
import { SendInputSchema } from './schemas/send';
import { YieldDepositInputSchema } from './schemas/yield';
import { DeltaOpenInputSchema } from './schemas/delta';
import { checkTrade } from './idempotency';
import { createConfirmation, consumeConfirmation, diffArgs } from './confirmations';

// ─── Phase 1 helpers ───

function firstZodIssue(error: any): string {
  const issue = error?.issues?.[0];
  if (!issue) return error?.message || 'validation failed';
  const path = (issue.path || []).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Coarse USD price table for confirmation previews. Phase 4 wires this to live
// CoinGecko snapshots; for now this is good enough to surface a sensible $X
// preview without an extra HTTP call on the hot path.
const TOKEN_USD: Record<string, number> = {
  BNB: 600, WBNB: 600, USDT: 1, USDC: 1, BUSD: 1, CAKE: 2,
};

function estimateUsd(token: string, amount: string): number {
  const px = TOKEN_USD[token.toUpperCase()] ?? 0;
  return parseFloat(amount) * px;
}

// ─── Market Scanning ───

export async function scanMarkets(category: 'yield' | 'prices' | 'funding_rates' | 'arbitrage' | 'all'): Promise<string> {
  logger.info('Engine: scanMarkets(%s)', category);
  return executeScanMarkets(category);
}

// ─── Yield ───

export interface YieldDepositData {
  protocol: string;
  apy: number;
  amount: string;
  token: string;
  alternatives: { protocol: string; apy: number; isSimulated: boolean }[];
  positionId?: string;
  txHash?: string;
}

export async function yieldDeposit(rawInput: unknown): Promise<EngineResult<YieldDepositData>> {
  const trace_id = newTraceId();
  const parsed = YieldDepositInputSchema.safeParse(rawInput);
  if (!parsed.success) return err('VALIDATION_ERROR', firstZodIssue(parsed.error), trace_id);
  const input = parsed.data;
  logger.info(
    { trace_id, tool: 'yield_deposit', user_id: input.userId, token: input.token, amount: input.amount, protocol: input.protocol || 'auto' },
    'engine.yieldDeposit',
  );

  const cached = checkTrade(input.client_op_id);
  if (cached.hit) {
    return err('IDEMPOTENCY_REPLAY', 'duplicate request — returning original result', trace_id, {
      details: { tx_hash: cached.original.tx_hash, original_executed_at: cached.original.executed_at },
    });
  }

  if (!input.confirmation_token) {
    const preview = {
      action: 'yield_deposit',
      token: input.token,
      amount: input.amount,
      estimated_usd: estimateUsd(input.token, input.amount),
      protocol: input.protocol || 'auto-pick highest APY',
    };
    const cfm = createConfirmation({ userId: input.userId, action: 'yield_deposit', args: input, preview });
    return needsConfirmation({ action: 'yield_deposit', preview, confirmation_token: cfm.token, expires_at: cfm.expires_at }, trace_id);
  }
  const consumed = consumeConfirmation({ token: input.confirmation_token, userId: input.userId, action: 'yield_deposit' });
  if (!consumed) return err('VALIDATION_ERROR', 'confirmation_token invalid, expired, or already consumed', trace_id);
  const drift = diffArgs(consumed, input as any, ['token', 'amount', 'protocol']);
  if (drift.length > 0) return err('VALIDATION_ERROR', `arguments do not match confirmation (drift: ${drift.join(', ')})`, trace_id);

  try {
    const result = await yieldOptimizer.deposit(input.userId, input.token, input.amount, input.protocol);
    if (!result.success) {
      return err('PROTOCOL_UNAVAILABLE', result.message || 'yield deposit failed', trace_id, { retryable: true });
    }
    return ok(
      {
        protocol: result.protocol,
        apy: result.apy,
        amount: result.amount,
        token: result.token,
        alternatives: result.alternatives,
        positionId: result.positionId,
        txHash: result.txHash,
      },
      trace_id,
    );
  } catch (e: any) {
    return err('INTERNAL_ERROR', e?.message || 'yield deposit failed', trace_id);
  }
}

export async function yieldRotate(
  userId: string,
  positionId: string,
  minImprovementBps?: number,
): Promise<DepositResult> {
  logger.info('Engine: yieldRotate(%s, %s, min=%d)', userId, positionId, minImprovementBps || 50);
  return yieldOptimizer.rotate(userId, positionId, minImprovementBps);
}

export async function checkRotation(
  positionId: string,
  minImprovementBps?: number,
): Promise<RotationPlan | null> {
  return yieldOptimizer.shouldRotate(positionId, minImprovementBps);
}

// ─── Portfolio ───

export function getPortfolio(userId: string): Portfolio {
  logger.info('Engine: getPortfolio(%s)', userId);
  return positionTracker.getPortfolio(userId);
}

// ─── Trades ───

export function getTradeHistory(userId: string, opts?: { limit?: number; type?: string }): Trade[] {
  logger.info('Engine: getTradeHistory(%s)', userId);
  return tradeLogger.getHistory(userId, opts);
}

// ─── Swaps ───

export interface SwapData { txHash: string; protocol: string; fromToken: string; toToken: string; amount: string }

export async function swapTokens(rawInput: unknown): Promise<EngineResult<SwapData>> {
  const trace_id = newTraceId();
  const parsed = SwapInputSchema.safeParse(rawInput);
  if (!parsed.success) return err('VALIDATION_ERROR', firstZodIssue(parsed.error), trace_id);
  const input = parsed.data;
  logger.info(
    { trace_id, tool: 'swap_tokens', user_id: input.userId, fromToken: input.fromToken, toToken: input.toToken, amount: input.amount },
    'engine.swapTokens',
  );

  const cached = checkTrade(input.client_op_id);
  if (cached.hit) {
    return err('IDEMPOTENCY_REPLAY', 'duplicate request — returning original result', trace_id, {
      details: { tx_hash: cached.original.tx_hash, original_executed_at: cached.original.executed_at },
    });
  }

  if (!input.confirmation_token) {
    const preview = {
      action: 'swap',
      from: { token: input.fromToken, amount: input.amount },
      to: { token: input.toToken },
      protocol: 'PancakeSwap',
      estimated_usd: estimateUsd(input.fromToken, input.amount),
      slippage_cap_bps: 500,
    };
    const cfm = createConfirmation({ userId: input.userId, action: 'swap_tokens', args: input, preview });
    return needsConfirmation({ action: 'swap_tokens', preview, confirmation_token: cfm.token, expires_at: cfm.expires_at }, trace_id);
  }
  const consumed = consumeConfirmation({ token: input.confirmation_token, userId: input.userId, action: 'swap_tokens' });
  if (!consumed) return err('VALIDATION_ERROR', 'confirmation_token invalid, expired, or already consumed', trace_id);
  const drift = diffArgs(consumed, input as any, ['fromToken', 'toToken', 'amount']);
  if (drift.length > 0) return err('VALIDATION_ERROR', `arguments do not match confirmation (drift: ${drift.join(', ')})`, trace_id);

  let wallet;
  try { wallet = walletManager.getClient(input.userId); }
  catch (e: any) { return err('WALLET_INACTIVE', e?.message || 'wallet not activated', trace_id); }

  const txResult = await pancakeSwapAdapter.swap!(
    input.fromToken,
    input.toToken,
    input.amount,
    wallet.client,
    wallet.publicClient,
  );

  // Log the trade carrying client_op_id so retries hit the idempotency check above.
  tradeLogger.logTrade({
    user_id: input.userId,
    type: 'swap',
    protocol: 'PancakeSwap',
    from_token: input.fromToken,
    to_token: input.toToken,
    from_amount: input.amount,
    to_amount: '',
    price_usd: 0,
    tx_hash: txResult.txHash || `0xfailed_${Date.now()}`,
    client_op_id: input.client_op_id,
  });

  if (!txResult.success) {
    return err('PROTOCOL_UNAVAILABLE', `swap failed: ${txResult.error}`, trace_id, { retryable: true });
  }
  return ok(
    { txHash: txResult.txHash, protocol: 'PancakeSwap', fromToken: input.fromToken, toToken: input.toToken, amount: input.amount },
    trace_id,
  );
}

// ─── Send Tokens ───

const TOKEN_ADDRESSES: Record<string, `0x${string}` | 'native'> = {
  BNB: 'native',
  WBNB: ADDRESSES.WBNB_TESTNET,
  USDT: ADDRESSES.USDT_TESTNET,
};

export interface SendData { txHash: string; explorerUrl: string; token: string; amount: string; toAddress: string }

export async function sendTokens(rawInput: unknown): Promise<EngineResult<SendData>> {
  const trace_id = newTraceId();
  const parsed = SendInputSchema.safeParse(rawInput);
  if (!parsed.success) return err('VALIDATION_ERROR', firstZodIssue(parsed.error), trace_id);
  const input = parsed.data;
  logger.info(
    { trace_id, tool: 'send_tokens', user_id: input.userId, token: input.token, amount: input.amount, toAddress: input.toAddress },
    'engine.sendTokens',
  );

  const tokenUpper = input.token.toUpperCase();
  const tokenAddress = TOKEN_ADDRESSES[tokenUpper];
  if (!tokenAddress) {
    return err(
      'VALIDATION_ERROR',
      `Unsupported token: ${input.token}. Supported: ${Object.keys(TOKEN_ADDRESSES).join(', ')}`,
      trace_id,
    );
  }

  const cached = checkTrade(input.client_op_id);
  if (cached.hit) {
    return err('IDEMPOTENCY_REPLAY', 'duplicate request — returning original result', trace_id, {
      details: { tx_hash: cached.original.tx_hash, original_executed_at: cached.original.executed_at },
    });
  }

  // send_tokens always confirms — funds leaving the system is the highest-risk
  // primitive. Phase 6 layers on a per-user address allowlist.
  if (!input.confirmation_token) {
    const preview = {
      action: 'send',
      token: tokenUpper,
      amount: input.amount,
      to: input.toAddress,
      estimated_usd: estimateUsd(tokenUpper, input.amount),
    };
    const cfm = createConfirmation({ userId: input.userId, action: 'send_tokens', args: input, preview });
    return needsConfirmation({ action: 'send_tokens', preview, confirmation_token: cfm.token, expires_at: cfm.expires_at }, trace_id);
  }
  const consumed = consumeConfirmation({ token: input.confirmation_token, userId: input.userId, action: 'send_tokens' });
  if (!consumed) return err('VALIDATION_ERROR', 'confirmation_token invalid, expired, or already consumed', trace_id);
  const drift = diffArgs(consumed, input as any, ['token', 'amount', 'toAddress']);
  if (drift.length > 0) return err('VALIDATION_ERROR', `arguments do not match confirmation (drift: ${drift.join(', ')})`, trace_id);

  let wallet;
  try { wallet = walletManager.getClient(input.userId); }
  catch (e: any) { return err('WALLET_INACTIVE', e?.message || 'wallet not activated', trace_id); }

  try {
    let txHash: string;
    if (tokenAddress === 'native') {
      txHash = await wallet.client.sendTransaction({
        to: input.toAddress as `0x${string}`,
        value: parseEther(input.amount),
      });
    } else {
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [input.toAddress as `0x${string}`, parseEther(input.amount)],
      });
      txHash = await wallet.client.sendTransaction({ to: tokenAddress, data });
    }
    await wallet.publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

    tradeLogger.logTrade({
      user_id: input.userId,
      type: 'transfer',
      protocol: 'direct',
      from_token: tokenUpper,
      to_token: tokenUpper,
      from_amount: input.amount,
      to_amount: input.amount,
      price_usd: 0,
      tx_hash: txHash,
      client_op_id: input.client_op_id,
    });

    return ok(
      {
        txHash,
        explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
        token: tokenUpper,
        amount: input.amount,
        toAddress: input.toAddress,
      },
      trace_id,
    );
  } catch (e: any) {
    return err('PROTOCOL_UNAVAILABLE', `transfer failed: ${e.message}`, trace_id, { retryable: true });
  }
}

// ─── Arbitrage ───

export async function arbExecute(
  userId: string,
  opportunityId?: string,
  maxSlippageBps?: number,
): Promise<{ success: boolean; message: string; profitUsd?: number }> {
  logger.info('Engine: arbExecute(%s, %s)', userId, opportunityId || 'auto');
  // TODO: risk check here once riskManager is implemented (Phase 5)
  return arbScanner.execute(userId, opportunityId, maxSlippageBps);
}

// ─── Delta-Neutral ───

export interface DeltaOpenData {
  positionId?: string;
  txHash?: string;
  message: string;
  data?: Record<string, any>;
}

export async function deltaNeutralOpen(rawInput: unknown): Promise<EngineResult<DeltaOpenData>> {
  const trace_id = newTraceId();
  const parsed = DeltaOpenInputSchema.safeParse(rawInput);
  if (!parsed.success) return err('VALIDATION_ERROR', firstZodIssue(parsed.error), trace_id);
  const input = parsed.data;
  logger.info(
    { trace_id, tool: 'delta_neutral_open', user_id: input.userId, token: input.token, notionalUsd: input.notionalUsd },
    'engine.deltaNeutralOpen',
  );

  const cached = checkTrade(input.client_op_id);
  if (cached.hit) {
    return err('IDEMPOTENCY_REPLAY', 'duplicate request — returning original result', trace_id, {
      details: { tx_hash: cached.original.tx_hash, original_executed_at: cached.original.executed_at },
    });
  }

  // Risk check up front so a bad position size never surfaces a confirmation prompt.
  const riskCheck = riskManager.check(input.userId, {
    type: 'delta_neutral',
    amountUsd: parseFloat(input.notionalUsd),
  });
  if (!riskCheck.allowed) {
    return err('PERMISSION_DENIED', `Risk check failed: ${riskCheck.reason}`, trace_id);
  }

  if (!input.confirmation_token) {
    const preview = {
      action: 'delta_neutral_open',
      token: input.token,
      notional_usd: input.notionalUsd,
      max_funding_rate: input.maxFundingRate ?? 'no cap',
      note: 'spot leg is real on-chain; short leg is virtual on testnet',
    };
    const cfm = createConfirmation({ userId: input.userId, action: 'delta_neutral_open', args: input, preview });
    return needsConfirmation({ action: 'delta_neutral_open', preview, confirmation_token: cfm.token, expires_at: cfm.expires_at }, trace_id);
  }
  const consumed = consumeConfirmation({ token: input.confirmation_token, userId: input.userId, action: 'delta_neutral_open' });
  if (!consumed) return err('VALIDATION_ERROR', 'confirmation_token invalid, expired, or already consumed', trace_id);
  const drift = diffArgs(consumed, input as any, ['token', 'notionalUsd']);
  if (drift.length > 0) return err('VALIDATION_ERROR', `arguments do not match confirmation (drift: ${drift.join(', ')})`, trace_id);

  try {
    const result = await deltaNeutral.open(input.userId, input.token, input.notionalUsd, input.maxFundingRate);
    if (!result.success) return err('PROTOCOL_UNAVAILABLE', result.message, trace_id, { retryable: true });
    return ok(
      { positionId: result.positionId, txHash: result.txHash, message: result.message, data: result.data },
      trace_id,
    );
  } catch (e: any) {
    return err('INTERNAL_ERROR', e?.message || 'delta-neutral open failed', trace_id);
  }
}

export async function deltaNeutralClose(
  userId: string,
  positionId: string,
): Promise<StrategyResult> {
  logger.info('Engine: deltaNeutralClose(%s, %s)', userId, positionId);
  return deltaNeutral.close(userId, positionId);
}

// ─── Risk Management ───

export function getRiskConfig(userId: string): RiskConfig {
  return riskManager.getConfig(userId);
}

export function configureRisk(userId: string, config: Partial<RiskConfig>): RiskConfig {
  logger.info('Engine: configureRisk(%s)', userId);
  return riskManager.configure(userId, config);
}

// ─── Alerts ───

export function setAlert(
  userId: string,
  alertType: string,
  active: boolean,
  threshold?: number,
): { success: boolean; message: string } {
  logger.info('Engine: setAlert(%s, %s, active=%s)', userId, alertType, active);

  const validTypes = ['apy_drop', 'arb_opportunity', 'position_health'];
  if (!validTypes.includes(alertType)) {
    return { success: false, message: `Invalid alert type. Valid types: ${validTypes.join(', ')}` };
  }

  // Upsert alert config
  const existing = dbOps.getAlerts(userId).find((a: any) => a.type === alertType);
  if (existing) {
    dbOps.db.prepare('UPDATE alerts SET active = ?, threshold = ? WHERE id = ?')
      .run(active ? 1 : 0, threshold || null, existing.id);
  } else {
    const id = `alert_${Date.now().toString(36)}`;
    dbOps.db.prepare(
      'INSERT INTO alerts (id, user_id, type, active, threshold) VALUES (?, ?, ?, ?, ?)'
    ).run(id, userId, alertType, active ? 1 : 0, threshold || null);
  }

  return {
    success: true,
    message: `Alert "${alertType}" ${active ? 'enabled' : 'disabled'}${threshold ? ` (threshold: ${threshold})` : ''}.`,
  };
}

export function getAlerts(userId: string): any[] {
  return dbOps.getAlerts(userId);
}

export function getArbSession(userId: string): any | null {
  return dbOps.getAutoArbSession(userId) || null;
}
