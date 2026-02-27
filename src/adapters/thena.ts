import type { ProtocolAdapter, TxResult, PriceQuote } from './types';
import { getAllQuotes } from '../core/scanner/priceAggregator';
import { logger } from '../utils/logger';

/**
 * Thena DEX adapter — simulated (no BSC testnet contracts).
 * Uses real mainnet price data from DexScreener for quotes.
 */
class ThenaAdapter implements ProtocolAdapter {
  name = 'Thena';
  isSimulated = true;

  async swap(from: string, to: string, amount: string): Promise<TxResult> {
    logger.info('Thena (simulated): swap %s %s → %s', amount, from, to);
    return {
      txHash: `0xsim_thena_${Date.now().toString(16)}`,
      success: true,
    };
  }

  async getQuote(from: string, to: string, amount: string): Promise<PriceQuote> {
    const quotes = await getAllQuotes(from, to, amount);
    const thenaQuote = quotes.find(q => q.dex.toLowerCase().includes('thena'));

    if (thenaQuote) {
      return {
        dex: 'Thena',
        fromToken: from,
        toToken: to,
        amountIn: amount,
        amountOut: thenaQuote.amountOut,
        effectivePrice: thenaQuote.effectivePrice,
        priceImpact: thenaQuote.priceImpact,
      };
    }

    // Fallback: use average of available quotes with small spread
    const avgPrice = quotes.length > 0
      ? quotes.reduce((s, q) => s + q.effectivePrice, 0) / quotes.length * 0.998
      : 0;

    return {
      dex: 'Thena',
      fromToken: from,
      toToken: to,
      amountIn: amount,
      amountOut: (parseFloat(amount) * avgPrice).toFixed(6),
      effectivePrice: avgPrice,
      priceImpact: 0.2,
    };
  }
}

export const thenaAdapter = new ThenaAdapter();
