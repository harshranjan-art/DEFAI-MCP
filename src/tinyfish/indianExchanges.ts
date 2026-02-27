import { runTinyFish } from './client';

export interface ExchangeRate {
  exchange: string;
  bnb_inr: number;
}

const FALLBACK_BNB_INR = 52000;

async function scrapeOne(url: string, exchange: string, fallback: number): Promise<ExchangeRate> {
  const result = await runTinyFish({
    url,
    goal: 'Current BNB sell price in INR. Return JSON: { exchange, bnb_inr: number }',
  });
  if (result.status === 'COMPLETE' && result.data) {
    try {
      const d = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      if (typeof d.bnb_inr === 'number' && d.bnb_inr > 0) {
        return { exchange, bnb_inr: d.bnb_inr };
      }
    } catch { /* fall through to fallback */ }
  }
  return { exchange, bnb_inr: fallback };
}

export async function getBestINROffRamp(): Promise<{
  best: ExchangeRate;
  all: ExchangeRate[];
  savingVsWorst: number;
}> {
  const [coindcx, wazirx, mudrex] = await Promise.all([
    scrapeOne('https://coindcx.com/trade/BNBINR', 'CoinDCX', FALLBACK_BNB_INR),
    scrapeOne('https://wazirx.com/exchange/BNB-INR', 'WazirX', FALLBACK_BNB_INR),
    scrapeOne('https://mudrex.com/earn', 'Mudrex', FALLBACK_BNB_INR),
  ]);
  const all = [coindcx, wazirx, mudrex].sort((a, b) => b.bnb_inr - a.bnb_inr);
  const best = all[0];
  const worst = all[all.length - 1];
  return { best, all, savingVsWorst: best.bnb_inr - worst.bnb_inr };
}
