/**
 * Core Engine — thin orchestrator that every transport calls.
 * MCP tools, Telegram commands, and API routes all call engine methods.
 * This centralizes validation, logging, and error handling.
 */

import { encodeFunctionData, isAddress, parseEther } from 'viem';
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

// ─── Market Scanning ───

export async function scanMarkets(category: 'yield' | 'prices' | 'funding_rates' | 'arbitrage' | 'all'): Promise<string> {
  logger.info('Engine: scanMarkets(%s)', category);
  return executeScanMarkets(category);
}

// ─── Yield ───

export async function yieldDeposit(
  userId: string,
  token: string,
  amount: string,
  protocol?: string,
): Promise<DepositResult> {
  logger.info('Engine: yieldDeposit(%s, %s, %s, %s)', userId, token, amount, protocol || 'auto');
  // TODO: risk check here once riskManager is implemented (Phase 5)
  return yieldOptimizer.deposit(userId, token, amount, protocol);
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

export async function swapTokens(
  userId: string,
  fromToken: string,
  toToken: string,
  amount: string,
): Promise<{ success: boolean; message: string; protocol: string; txHash?: string; effectivePrice?: number }> {
  logger.info('Engine: swapTokens(%s, %s→%s, %s)', userId, fromToken, toToken, amount);
  // TODO: risk check here once riskManager is implemented (Phase 5)

  const wallet = walletManager.getClient(userId);
  if (!wallet) {
    return { success: false, message: 'Wallet not activated. Call wallet_setup first.', protocol: '' };
  }

  const txResult = await pancakeSwapAdapter.swap!(fromToken, toToken, amount, wallet.client, wallet.publicClient);

  // Log the trade
  tradeLogger.logTrade({
    user_id: userId,
    type: 'swap',
    protocol: 'PancakeSwap',
    from_token: fromToken,
    to_token: toToken,
    from_amount: amount,
    to_amount: '', // unknown until receipt parsed
    price_usd: 0,
    tx_hash: txResult.txHash,
  });

  if (!txResult.success) {
    return { success: false, message: `Swap failed: ${txResult.error}`, protocol: 'PancakeSwap' };
  }

  return {
    success: true,
    message: `Swapped ${amount} ${fromToken} → ${toToken} via PancakeSwap`,
    protocol: 'PancakeSwap',
    txHash: txResult.txHash,
  };
}

// ─── Send Tokens ───

const TOKEN_ADDRESSES: Record<string, `0x${string}` | 'native'> = {
  BNB: 'native',
  WBNB: ADDRESSES.WBNB_TESTNET,
  USDT: ADDRESSES.USDT_TESTNET,
};

export async function sendTokens(
  userId: string,
  token: string,
  amount: string,
  toAddress: string,
): Promise<{ success: boolean; message: string; txHash?: string; explorerUrl?: string }> {
  logger.info('Engine: sendTokens(%s, %s %s → %s)', userId, amount, token, toAddress);

  if (!isAddress(toAddress)) {
    return { success: false, message: `Invalid recipient address: ${toAddress}` };
  }

  const tokenUpper = token.toUpperCase();
  const tokenAddress = TOKEN_ADDRESSES[tokenUpper];
  if (!tokenAddress) {
    return { success: false, message: `Unsupported token: ${token}. Supported: ${Object.keys(TOKEN_ADDRESSES).join(', ')}` };
  }

  const wallet = walletManager.getClient(userId);
  if (!wallet) {
    return { success: false, message: 'Wallet not activated. Call wallet_setup first.' };
  }

  try {
    let txHash: string;

    if (tokenAddress === 'native') {
      // Native BNB transfer — no data needed
      txHash = await wallet.client.sendTransaction({
        to: toAddress as `0x${string}`,
        value: parseEther(amount),
      });
    } else {
      // ERC-20 transfer
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [toAddress as `0x${string}`, parseEther(amount)],
      });
      txHash = await wallet.client.sendTransaction({
        to: tokenAddress,
        data,
      });
    }

    await wallet.publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

    tradeLogger.logTrade({
      user_id: userId,
      type: 'transfer',
      protocol: 'direct',
      from_token: tokenUpper,
      to_token: tokenUpper,
      from_amount: amount,
      to_amount: amount,
      price_usd: 0,
      tx_hash: txHash,
    });

    return {
      success: true,
      message: `Sent ${amount} ${tokenUpper} to ${toAddress}`,
      txHash,
      explorerUrl: `https://testnet.bscscan.com/tx/${txHash}`,
    };
  } catch (e: any) {
    return { success: false, message: `Transfer failed: ${e.message}` };
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

export async function deltaNeutralOpen(
  userId: string,
  token: string,
  notionalUsd: string,
  maxFundingRate?: number,
): Promise<StrategyResult> {
  logger.info('Engine: deltaNeutralOpen(%s, %s, $%s)', userId, token, notionalUsd);

  const riskCheck = riskManager.check(userId, {
    type: 'delta_neutral',
    amountUsd: parseFloat(notionalUsd),
  });
  if (!riskCheck.allowed) {
    return { success: false, message: `Risk check failed: ${riskCheck.reason}` };
  }

  return deltaNeutral.open(userId, token, notionalUsd, maxFundingRate);
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
