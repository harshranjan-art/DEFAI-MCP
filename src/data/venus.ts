import axios from 'axios';

export async function getVenusAPY(): Promise<{ apy: number; protocol: 'Venus' }> {
  try {
    const res = await axios.get('https://api.venus.io/api/governance/venus', { timeout: 5000 });
    const markets: any[] = res.data?.data?.markets ?? res.data?.markets ?? [];
    const bnb = markets.find((m: any) => m.underlyingSymbol === 'BNB');
    const apy = parseFloat(bnb?.supplyApy ?? '0');
    if (apy > 0) return { apy, protocol: 'Venus' };
  } catch { /* fall through */ }
  return { apy: 3.8, protocol: 'Venus' };
}
