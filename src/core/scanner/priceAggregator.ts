import { logger } from '../../utils/logger';
import { API_URLS, ADDRESSES } from '../../utils/constants';
import { scannerCache } from './cache';

export interface PriceQuote {
  dex: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  effectivePrice: number;
  priceImpact: number;
  isSimulated: boolean;
}

export interface TokenPrice {
  token: string;
  priceUsd: number;
  source: string;
}

const PRICE_CACHE_KEY = 'token_prices';
const QUOTES_CACHE_KEY = 'dex_quotes';
const CACHE_TTL = 60_000; // 1 minute

// Common BSC token addresses (mainnet — for DexScreener lookups)
const TOKEN_ADDRESSES: Record<string, string> = {
  BNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',  // WBNB mainnet
  USDT: '0x55d398326f99059fF775485246999027B3197955', // USDT BSC mainnet
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD mainnet
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE mainnet
};

/**
 * Get token USD prices from CoinGecko.
 */
export async function getTokenPrices(tokens: string[] = ['binancecoin', 'tether', 'pancakeswap-token']): Promise<TokenPrice[]> {
  const cached = scannerCache.get<TokenPrice[]>(PRICE_CACHE_KEY);
  if (cached) return cached;

  const results: TokenPrice[] = [];
  try {
    const ids = tokens.join(',');
    const res = await fetch(
      `${API_URLS.COINGECKO_PRICE}?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json() as Record<string, { usd: number }>;

    const nameMap: Record<string, string> = {
      binancecoin: 'BNB',
      tether: 'USDT',
      'pancakeswap-token': 'CAKE',
    };

    for (const [id, data] of Object.entries(json)) {
      if (data?.usd) {
        results.push({
          token: nameMap[id] || id.toUpperCase(),
          priceUsd: data.usd,
          source: 'coingecko',
        });
      }
    }
  } catch (e: any) {
    logger.warn('CoinGecko price fetch failed: %s', e.message);
    // Fallback prices
    results.push(
      { token: 'BNB', priceUsd: 600, source: 'fallback' },
      { token: 'USDT', priceUsd: 1, source: 'fallback' },
    );
  }

  scannerCache.set(PRICE_CACHE_KEY, results, CACHE_TTL);
  return results;
}

/**
 * Get a single token's USD price.
 */
export async function getPrice(token: string): Promise<number> {
  const prices = await getTokenPrices();
  const found = prices.find(p => p.token.toUpperCase() === token.toUpperCase());
  return found?.priceUsd || 0;
}

/**
 * Get DEX price quotes for a token pair using DexScreener.
 */
export async function getAllQuotes(token: string = 'BNB', quote: string = 'USDT', amount: string = '1'): Promise<PriceQuote[]> {
  const cacheKey = `${QUOTES_CACHE_KEY}_${token}_${quote}`;
  const cached = scannerCache.get<PriceQuote[]>(cacheKey);
  if (cached) return cached;

  const results: PriceQuote[] = [];
  const tokenAddr = TOKEN_ADDRESSES[token.toUpperCase()];

  if (tokenAddr) {
    try {
      const res = await fetch(
        `${API_URLS.DEXSCREENER}/${tokenAddr}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const json = await res.json() as any;
      const pairs: any[] = json.pairs || [];

      // Filter for BSC pairs with the target quote token
      const bscPairs = pairs
        .filter((p: any) =>
          p.chainId === 'bsc' &&
          p.quoteToken?.symbol?.toUpperCase() === quote.toUpperCase()
        )
        .slice(0, 10);

      for (const p of bscPairs) {
        const price = parseFloat(p.priceNative || p.priceUsd || '0');
        if (price > 0) {
          results.push({
            dex: p.dexId || 'Unknown',
            fromToken: token,
            toToken: quote,
            amountIn: amount,
            amountOut: (parseFloat(amount) * price).toFixed(6),
            effectivePrice: price,
            priceImpact: parseFloat(p.priceChange?.h1 || '0'),
            isSimulated: true, // DexScreener shows mainnet data
          });
        }
      }
    } catch (e: any) {
      logger.warn('DexScreener fetch failed for %s: %s', token, e.message);
    }
  }

  // Ensure at least a fallback from CoinGecko prices
  if (results.length === 0) {
    const price = await getPrice(token);
    if (price > 0) {
      results.push({
        dex: 'coingecko-reference',
        fromToken: token,
        toToken: 'USD',
        amountIn: amount,
        amountOut: (parseFloat(amount) * price).toFixed(2),
        effectivePrice: price,
        priceImpact: 0,
        isSimulated: true,
      });
    }
  }

  scannerCache.set(cacheKey, results, CACHE_TTL);
  return results;
}
