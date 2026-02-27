import { logger } from '../../utils/logger';
import { API_URLS } from '../../utils/constants';
import { scannerCache } from './cache';

export interface FundingRate {
  symbol: string;
  fundingRate: number;      // as percentage (e.g., 0.01 = 0.01%)
  fundingTime: string;      // ISO timestamp
  markPrice: number;
}

const CACHE_KEY = 'funding_rates';
const CACHE_TTL = 300_000; // 5 minutes (funding rates update every 8 hours)

/**
 * Fetch current and recent funding rates from Binance Futures API.
 * Free, no API key required.
 */
export async function getFundingRates(
  symbols: string[] = ['BNBUSDT', 'ETHUSDT', 'BTCUSDT']
): Promise<Record<string, FundingRate[]>> {
  const cached = scannerCache.get<Record<string, FundingRate[]>>(CACHE_KEY);
  if (cached) return cached;

  const results: Record<string, FundingRate[]> = {};

  for (const symbol of symbols) {
    try {
      const res = await fetch(
        `${API_URLS.BINANCE_FUNDING}?symbol=${symbol}&limit=10`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json() as any[];

      results[symbol] = data.map((d: any) => ({
        symbol: d.symbol,
        fundingRate: parseFloat(d.fundingRate) * 100, // Convert to percentage
        fundingTime: new Date(d.fundingTime).toISOString(),
        markPrice: parseFloat(d.markPrice || '0'),
      }));
    } catch (e: any) {
      logger.warn('Binance funding rate fetch failed for %s: %s', symbol, e.message);
      results[symbol] = [];
    }
  }

  scannerCache.set(CACHE_KEY, results, CACHE_TTL);
  return results;
}

/**
 * Get the latest funding rate for a specific symbol.
 */
export async function getLatestFundingRate(token: string): Promise<FundingRate | null> {
  const symbol = token.toUpperCase().endsWith('USDT') ? token.toUpperCase() : `${token.toUpperCase()}USDT`;
  const rates = await getFundingRates([symbol]);
  const symbolRates = rates[symbol];
  if (!symbolRates || symbolRates.length === 0) return null;
  return symbolRates[0];
}
