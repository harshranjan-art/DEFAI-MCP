import axios from 'axios';

export async function convertINRtoUSD(amountINR: number): Promise<number> {
  try {
    const res = await axios.get('https://api.exchangerate.host/convert', {
      params: { from: 'INR', to: 'USD', amount: amountINR },
    });
    const result = res.data?.result;
    if (typeof result === 'number' && result > 0) return result;
  } catch { /* fall through */ }
  return amountINR / 83;
}
