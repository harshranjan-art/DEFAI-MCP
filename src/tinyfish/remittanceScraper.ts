import { runTinyFish } from './client';

export interface RemittanceFee {
  provider: string;
  fee_inr: number;
  time: string;
}

export async function scrapeWiseFee(amountINR: number): Promise<RemittanceFee> {
  const result = await runTinyFish({
    url: 'https://wise.com/gb/currency-converter/inr-to-usd-rate',
    goal: `Get the transfer fee for sending ${amountINR} INR via Wise. Return JSON: { provider: "Wise", fee_inr: number, time: string }`,
  });
  if (result.status === 'COMPLETE' && result.data) {
    try {
      const d = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      if (typeof d.fee_inr === 'number') {
        return { provider: 'Wise', fee_inr: d.fee_inr, time: d.time || '1-2 days' };
      }
    } catch { /* fall through to fallback */ }
  }
  return { provider: 'Wise', fee_inr: Math.round(amountINR * 0.018), time: '1-2 days' };
}

export async function scrapeWesternUnionFee(amountINR: number): Promise<RemittanceFee> {
  const result = await runTinyFish({
    url: 'https://www.westernunion.com/us/en/send-money/app/price-estimation',
    goal: `Get the transfer fee for sending ${amountINR} INR via Western Union. Return JSON: { provider: "Western Union", fee_inr: number, time: string }`,
  });
  if (result.status === 'COMPLETE' && result.data) {
    try {
      const d = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      if (typeof d.fee_inr === 'number') {
        return { provider: 'Western Union', fee_inr: d.fee_inr, time: d.time || '3-5 days' };
      }
    } catch { /* fall through to fallback */ }
  }
  return { provider: 'Western Union', fee_inr: Math.round(amountINR * 0.035), time: '3-5 days' };
}
