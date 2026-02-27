import type { ProtocolAdapter, TxResult, PriceQuote } from './types';
import { getAllQuotes } from '../core/scanner/priceAggregator';
import { logger } from '../utils/logger';

/**
 * BiSwap DEX adapter — simulated (no BSC testnet contracts).
 * Uses real mainnet price data from DexScreener for quotes.
 */
class BiSwapAdapter implements ProtocolAdapter {
  name = 'BiSwap';
  isSimulated = true;

  async swap(from: string, to: string, amount: string): Promise<TxResult> {
    logger.info('BiSwap (simulated): swap %s %s → %s', amount, from, to);
    return {
      txHash: `0xsim_biswap_${Date.now().toString(16)}`,
      success: true,
    };
  }

  async getQuote(from: string, to: string, amount: string): Promise<PriceQuote> {
    const quotes = await getAllQuotes(from, to, amount);
    const biswapQuote = quotes.find(q => q.dex.toLowerCase().includes('biswap'));

    if (biswapQuote) {
      return {
        dex: 'BiSwap',
        fromToken: from,
        toToken: to,
        amountIn: amount,
        amountOut: biswapQuote.amountOut,
        effectivePrice: biswapQuote.effectivePrice,
        priceImpact: biswapQuote.priceImpact,
      };
    }

    // Fallback: use average of available quotes with slight spread
    const avgPrice = quotes.length > 0
      ? quotes.reduce((s, q) => s + q.effectivePrice, 0) / quotes.length * 1.001
      : 0;

    return {
      dex: 'BiSwap',
      fromToken: from,
      toToken: to,
      amountIn: amount,
      amountOut: (parseFloat(amount) * avgPrice).toFixed(6),
      effectivePrice: avgPrice,
      priceImpact: 0.15,
    };
  }
}

export const biSwapAdapter = new BiSwapAdapter();
