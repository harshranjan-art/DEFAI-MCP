import cron from 'node-cron';
import { scrapeWiseFee, scrapeWesternUnionFee, type RemittanceFee } from './remittanceScraper';
import { getBestINROffRamp, type ExchangeRate } from './indianExchanges';

export interface Cache {
  wiseFee: RemittanceFee;
  wuFee: RemittanceFee;
  bestExchange: ExchangeRate;
  allExchanges: ExchangeRate[];
  lastRefreshed: Date;
}

let cache: Cache | null = null;

export async function refreshCache(sampleINR: number = 5000): Promise<void> {
  try {
    const [wiseFee, wuFee, exchangeData] = await Promise.all([
      scrapeWiseFee(sampleINR),
      scrapeWesternUnionFee(sampleINR),
      getBestINROffRamp(),
    ]);
    cache = {
      wiseFee,
      wuFee,
      bestExchange: exchangeData.best,
      allExchanges: exchangeData.all,
      lastRefreshed: new Date(),
    };
    console.log('[Cache] Refreshed at', cache.lastRefreshed.toISOString());
    console.log('[Cache] Best exchange:', cache.bestExchange.exchange, cache.bestExchange.bnb_inr, 'INR/BNB');
    console.log('[Cache] Wise fee:', cache.wiseFee.fee_inr, 'INR for', sampleINR, 'INR sent');
  } catch (e: any) {
    console.error('[Cache] Refresh failed, keeping old cache:', e.message);
  }
}

export function getCache(): Cache | null {
  return cache;
}

export function startCacheCron(): void {
  refreshCache(); // immediate first call
  cron.schedule('*/30 * * * *', () => { refreshCache(); });
  console.log('[Cache] Cron started, refreshing every 30 minutes');
}
