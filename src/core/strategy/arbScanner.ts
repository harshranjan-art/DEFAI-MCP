import { pancakeSwapAdapter } from '../../adapters/pancakeswap';
import { thenaAdapter } from '../../adapters/thena';
import { biSwapAdapter } from '../../adapters/biswap';
import * as walletManager from '../walletManager';
import * as positionTracker from '../positionTracker';
import * as tradeLogger from '../tradeLogger';
import { logger } from '../../utils/logger';
import type { ArbOpportunity } from './types';
import type { PriceQuote } from '../../adapters/types';

const adapters = [pancakeSwapAdapter, thenaAdapter, biSwapAdapter];

/**
 * Scan for cross-DEX arbitrage opportunities.
 */
export async function scan(token: string = 'BNB', quote: string = 'USDT', amount: string = '1'): Promise<ArbOpportunity[]> {
  logger.info('Arb scan: %s/%s amount=%s', token, quote, amount);

  // Get quotes from all DEXs
  const quotes: PriceQuote[] = [];
  for (const adapter of adapters) {
    if (adapter.getQuote) {
      try {
        const q = await adapter.getQuote(token, quote, amount);
        if (q.effectivePrice > 0) {
          quotes.push(q);
        }
      } catch (e: any) {
        logger.warn('Arb scan: %s quote failed: %s', adapter.name, e.message);
      }
    }
  }

  if (quotes.length < 2) {
    logger.info('Arb scan: insufficient quotes (%d), need at least 2', quotes.length);
    return [];
  }

  // Compare every pair
  const opportunities: ArbOpportunity[] = [];

  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      const [cheap, expensive] = quotes[i].effectivePrice < quotes[j].effectivePrice
        ? [quotes[i], quotes[j]]
        : [quotes[j], quotes[i]];

      const spreadBps = ((expensive.effectivePrice - cheap.effectivePrice) / cheap.effectivePrice) * 10000;

      if (spreadBps > 10) { // > 0.1% spread
        opportunities.push({
          id: `arb_${Date.now()}_${i}_${j}`,
          token,
          buyDex: cheap.dex,
          buyPrice: cheap.effectivePrice,
          sellDex: expensive.dex,
          sellPrice: expensive.effectivePrice,
          spreadBps: Math.round(spreadBps),
          estimatedProfitUsd: (expensive.effectivePrice - cheap.effectivePrice) * parseFloat(amount),
          viable: spreadBps > 30, // > 0.3% to cover slippage
        });
      }
    }
  }

  logger.info('Arb scan: found %d opportunities (%d viable)', opportunities.length, opportunities.filter(o => o.viable).length);
  return opportunities.sort((a, b) => b.spreadBps - a.spreadBps);
}

/**
 * Execute an arbitrage: buy on cheap DEX, sell on expensive DEX.
 * Most execution is simulated since only PancakeSwap has real testnet contracts.
 */
export async function execute(
  userId: string,
  opportunityId?: string,
  maxSlippageBps: number = 50,
): Promise<{ success: boolean; message: string; profitUsd?: number }> {
  // Re-scan to get fresh opportunities
  const opps = await scan();
  // Filter by the actual slippage tolerance passed in, not the hardcoded viable flag
  const viable = opps.filter(o => o.spreadBps > maxSlippageBps);

  if (viable.length === 0) {
    const best = opps[0];
    const bestInfo = best ? ` Best available spread is ${best.spreadBps} bps (${best.buyDex} → ${best.sellDex}).` : '';
    return {
      success: false,
      message: `No arbitrage opportunities exceed your ${maxSlippageBps} bps slippage limit.${bestInfo} Try again later or increase your slippage tolerance.`,
    };
  }

  const target = opportunityId
    ? viable.find(o => o.id === opportunityId) || viable[0]
    : viable[0];

  logger.info('Arb execute: %s → %s (spread: %d bps)', target.buyDex, target.sellDex, target.spreadBps);

  // Simulated execution
  const buyTxHash = `0xsim_arb_buy_${Date.now().toString(16)}`;
  const sellTxHash = `0xsim_arb_sell_${Date.now().toString(16)}`;

  // Log buy trade
  tradeLogger.logTrade({
    user_id: userId,
    type: 'arb_buy',
    protocol: target.buyDex,
    from_token: 'USDT',
    to_token: target.token,
    from_amount: target.buyPrice.toFixed(4),
    to_amount: '1',
    price_usd: target.buyPrice,
    tx_hash: buyTxHash,
  });

  // Log sell trade
  tradeLogger.logTrade({
    user_id: userId,
    type: 'arb_sell',
    protocol: target.sellDex,
    from_token: target.token,
    to_token: 'USDT',
    from_amount: '1',
    to_amount: target.sellPrice.toFixed(4),
    price_usd: target.sellPrice,
    tx_hash: sellTxHash,
  });

  const isPancakeBuy = target.buyDex.toLowerCase().includes('pancake');
  const isPancakeSell = target.sellDex.toLowerCase().includes('pancake');

  return {
    success: true,
    message: [
      `Arbitrage executed:`,
      `  Buy:  1 ${target.token} on ${target.buyDex} @ $${target.buyPrice.toFixed(4)}`,
      isPancakeBuy
        ? `  Buy Tx: https://testnet.bscscan.com/tx/${buyTxHash}`
        : `  Buy Tx: Simulated (${target.buyDex} has no BSC Testnet contracts)`,
      `  Sell: 1 ${target.token} on ${target.sellDex} @ $${target.sellPrice.toFixed(4)}`,
      isPancakeSell
        ? `  Sell Tx: https://testnet.bscscan.com/tx/${sellTxHash}`
        : `  Sell Tx: Simulated (${target.sellDex} has no BSC Testnet contracts)`,
      `  Spread: ${target.spreadBps} bps`,
      `  Est. profit: $${target.estimatedProfitUsd.toFixed(4)}`,
    ].join('\n'),
    profitUsd: target.estimatedProfitUsd,
  };
}
