/**
 * Delta-Neutral Strategy
 *
 * Opens a hedged position: buy spot via PancakeSwap (real tx) + record a virtual short
 * (simulated, tracking Binance funding rate). The funding rate is the yield.
 *
 * When funding rate is positive, shorters PAY longs → we earn yield on the short side.
 * Spot side hedges against price movement → delta-neutral.
 */

import { pancakeSwapAdapter } from '../../adapters/pancakeswap';
import * as walletManager from '../walletManager';
import * as positionTracker from '../positionTracker';
import * as tradeLogger from '../tradeLogger';
import { getLatestFundingRate } from '../scanner/fundingRates';
import { getPrice as getPriceUsd } from '../scanner/priceAggregator';
import { logger } from '../../utils/logger';
import type { StrategyResult, DeltaPosition } from './types';

export async function open(
  userId: string,
  token: string,
  notionalUsd: string,
  maxFundingRate?: number,
): Promise<StrategyResult> {
  logger.info('DeltaNeutral: open(%s, %s, $%s)', userId, token, notionalUsd);

  const notional = parseFloat(notionalUsd);
  if (isNaN(notional) || notional <= 0) {
    return { success: false, message: 'Invalid notional amount.' };
  }

  // Get current funding rate
  const fundingData = await getLatestFundingRate(token);
  if (!fundingData) {
    return { success: false, message: `Could not fetch funding rate for ${token}. Try again later.` };
  }

  // Check if funding rate is favorable (positive = shorters pay, we earn)
  if (fundingData.fundingRate <= 0) {
    return {
      success: false,
      message: `Current ${token} funding rate is ${fundingData.fundingRate.toFixed(4)}% (negative). ` +
        `Delta-neutral is only profitable when funding rate is positive. Check back later.`,
    };
  }

  if (maxFundingRate && Math.abs(fundingData.fundingRate) > maxFundingRate) {
    return {
      success: false,
      message: `Funding rate ${fundingData.fundingRate.toFixed(4)}% exceeds max ${maxFundingRate}%.`,
    };
  }

  // Get spot price
  const priceUsd = await getPriceUsd(token);
  if (!priceUsd || priceUsd <= 0) {
    return { success: false, message: `Could not get ${token} price.` };
  }

  const spotAmount = notional / priceUsd;
  const spotAmountStr = spotAmount.toFixed(6);

  // Execute spot buy (real tx if wallet active, simulated otherwise)
  let spotTxHash = `0xsim_delta_spot_${Date.now().toString(16)}`;
  let isSimulated = true;

  const wallet = walletManager.getClient(userId);
  if (wallet && pancakeSwapAdapter.swap) {
    try {
      const txResult = await pancakeSwapAdapter.swap('USDT', token, spotAmountStr, wallet.client, wallet.publicClient);
      if (txResult.success) {
        spotTxHash = txResult.txHash;
        isSimulated = false;
      }
    } catch (e: any) {
      logger.warn('DeltaNeutral: spot buy failed, using simulated: %s', e.message);
    }
  }

  // Virtual short (always simulated — no perp DEX on testnet)
  const shortTxHash = `0xsim_delta_short_${Date.now().toString(16)}`;

  // Log trades
  tradeLogger.logTrade({
    user_id: userId,
    type: 'delta_spot_buy',
    protocol: isSimulated ? 'Simulated' : 'PancakeSwap',
    from_token: 'USDT',
    to_token: token,
    from_amount: notionalUsd,
    to_amount: spotAmountStr,
    price_usd: priceUsd,
    tx_hash: spotTxHash,
  });

  tradeLogger.logTrade({
    user_id: userId,
    type: 'delta_short_open',
    protocol: 'Simulated (Binance Futures)',
    from_token: token,
    to_token: 'USDT',
    from_amount: spotAmountStr,
    to_amount: notionalUsd,
    price_usd: priceUsd,
    tx_hash: shortTxHash,
  });

  // Open position
  const deltaData: DeltaPosition = {
    spotEntry: priceUsd,
    spotAmount,
    shortEntry: priceUsd,
    shortSize: notionalUsd,
    fundingRate: fundingData.fundingRate,
    isSimulated: true, // short is always simulated
  };

  const position = positionTracker.openPosition({
    user_id: userId,
    type: 'delta_neutral',
    protocol: 'Delta-Neutral (PancakeSwap + Binance Futures)',
    token,
    amount: spotAmountStr,
    entry_price: priceUsd,
    tx_hash: spotTxHash,
    metadata: {
      ...deltaData,
      spotTxHash,
      shortTxHash,
      isSimulated,
      openedAt: new Date().toISOString(),
    },
  });

  // Annualized yield from funding rate (8h intervals = 3x/day = 1095x/year)
  const annualizedYield = (fundingData.fundingRate * 3 * 365).toFixed(2);

  return {
    success: true,
    message: [
      `Delta-neutral position opened!`,
      ``,
      `  Spot: Bought ${spotAmountStr} ${token} @ $${priceUsd.toFixed(2)}${isSimulated ? ' (simulated)' : ''}`,
      `  Short: ${spotAmountStr} ${token} @ $${priceUsd.toFixed(2)} (simulated)`,
      `  Notional: $${notional.toFixed(2)}`,
      ``,
      `  Current funding rate: ${fundingData.fundingRate.toFixed(4)}%`,
      `  Annualized yield estimate: ~${annualizedYield}%`,
      ``,
      `  Position ID: ${position.id}`,
      spotTxHash.startsWith('0xsim_') ? '' : `  Spot Tx: https://testnet.bscscan.com/tx/${spotTxHash}`,
    ].filter(Boolean).join('\n'),
    positionId: position.id,
    txHash: spotTxHash,
  };
}

export async function close(
  userId: string,
  positionId: string,
): Promise<StrategyResult> {
  logger.info('DeltaNeutral: close(%s, %s)', userId, positionId);

  const position = positionTracker.getPosition(positionId);
  if (!position) {
    return { success: false, message: `Position ${positionId} not found.` };
  }
  if (position.user_id !== userId) {
    return { success: false, message: 'You do not own this position.' };
  }
  if (position.status !== 'open') {
    return { success: false, message: 'Position is already closed.' };
  }

  const meta = position.metadata;
  const deltaData = meta as DeltaPosition & { openedAt: string };

  // Get current price for PnL calculation
  const currentPriceRaw = await getPriceUsd(position.token);
  const currentPriceUsd = currentPriceRaw > 0 ? currentPriceRaw : deltaData.spotEntry;

  // Calculate PnL
  const spotPnl = (currentPriceUsd - deltaData.spotEntry) * deltaData.spotAmount;
  const shortPnl = (deltaData.shortEntry - currentPriceUsd) * deltaData.spotAmount;

  // Funding PnL (estimate based on holding period)
  const hoursHeld = (Date.now() - new Date(deltaData.openedAt || position.opened_at).getTime()) / (1000 * 60 * 60);
  const fundingIntervals = Math.floor(hoursHeld / 8);
  const fundingPnl = (deltaData.fundingRate / 100) * parseFloat(position.amount) * currentPriceUsd * fundingIntervals;

  const totalPnl = spotPnl + shortPnl + fundingPnl;

  // Log close trades
  tradeLogger.logTrade({
    user_id: userId,
    type: 'delta_spot_sell',
    protocol: meta.isSimulated ? 'Simulated' : 'PancakeSwap',
    from_token: position.token,
    to_token: 'USDT',
    from_amount: position.amount,
    to_amount: (parseFloat(position.amount) * currentPriceUsd).toFixed(4),
    price_usd: currentPriceUsd,
    tx_hash: `0xsim_delta_close_${Date.now().toString(16)}`,
  });

  positionTracker.closePosition(positionId);

  return {
    success: true,
    message: [
      `Delta-neutral position closed!`,
      ``,
      `  Spot PnL: $${spotPnl.toFixed(4)}`,
      `  Short PnL: $${shortPnl.toFixed(4)}`,
      `  Funding PnL: $${fundingPnl.toFixed(4)} (${fundingIntervals} funding intervals)`,
      `  Total PnL: $${totalPnl.toFixed(4)}`,
      ``,
      `  Held for: ${hoursHeld.toFixed(1)} hours`,
    ].join('\n'),
    positionId,
    data: { spotPnl, shortPnl, fundingPnl, totalPnl },
  };
}

export async function getPnL(positionId: string): Promise<{
  spotPnl: number;
  shortPnl: number;
  fundingPnl: number;
  totalPnl: number;
  currentPrice: number;
  fundingRate: number;
} | null> {
  const position = positionTracker.getPosition(positionId);
  if (!position || position.type !== 'delta_neutral') return null;

  const meta = position.metadata as DeltaPosition & { openedAt: string };
  const currentPriceRaw = await getPriceUsd(position.token);
  const current = currentPriceRaw > 0 ? currentPriceRaw : meta.spotEntry;

  const spotPnl = (current - meta.spotEntry) * meta.spotAmount;
  const shortPnl = (meta.shortEntry - current) * meta.spotAmount;

  const hoursHeld = (Date.now() - new Date(meta.openedAt || position.opened_at).getTime()) / (1000 * 60 * 60);
  const fundingIntervals = Math.floor(hoursHeld / 8);
  const fundingPnl = (meta.fundingRate / 100) * meta.spotAmount * current * fundingIntervals;

  // Fetch latest funding rate
  const latestRate = await getLatestFundingRate(position.token);

  return {
    spotPnl,
    shortPnl,
    fundingPnl,
    totalPnl: spotPnl + shortPnl + fundingPnl,
    currentPrice: current,
    fundingRate: latestRate?.fundingRate || meta.fundingRate,
  };
}
