import { logger } from '../../utils/logger';
import { API_URLS } from '../../utils/constants';
import { scannerCache } from './cache';

export interface YieldOpportunity {
  protocol: string;
  pool: string;
  token: string;
  apy: number;
  tvl: number;
  risk: 'low' | 'medium' | 'high';
  contractAddress?: string;
  action: 'supply' | 'stake' | 'vault';
  source: string;
  isSimulated: boolean; // true = real data but no testnet execution
}

const CACHE_KEY = 'apy_aggregator';
const CACHE_TTL = 120_000; // 2 minutes

async function fetchVenus(): Promise<YieldOpportunity[]> {
  const results: YieldOpportunity[] = [];
  try {
    const res = await fetch(API_URLS.VENUS, { signal: AbortSignal.timeout(8000) });
    const json = await res.json() as any;
    const markets: any[] = json?.result ?? json?.data?.markets ?? json?.markets ?? [];

    for (const m of markets) {
      const apy = parseFloat(m.supplyApy || '0');
      if (apy > 0 && m.underlyingSymbol) {
        results.push({
          protocol: 'Venus',
          pool: `${m.underlyingSymbol} Supply`,
          token: m.underlyingSymbol,
          apy,
          tvl: parseFloat(m.totalSupplyUsd || '0'),
          risk: 'low',
          contractAddress: m.address,
          action: 'supply',
          source: 'venus-api',
          isSimulated: false, // Real testnet execution available
        });
      }
    }
  } catch (e: any) {
    logger.warn('Venus API failed: %s', e.message);
    // Fallback BNB entry
    results.push({
      protocol: 'Venus',
      pool: 'BNB Supply',
      token: 'BNB',
      apy: 3.8,
      tvl: 0,
      risk: 'low',
      action: 'supply',
      source: 'venus-fallback',
      isSimulated: false,
    });
  }
  return results;
}

async function fetchBeefy(): Promise<YieldOpportunity[]> {
  const results: YieldOpportunity[] = [];
  try {
    const [apyRes, vaultRes] = await Promise.all([
      fetch(API_URLS.BEEFY_APY, { signal: AbortSignal.timeout(10000) }),
      fetch(API_URLS.BEEFY_VAULTS, { signal: AbortSignal.timeout(10000) }),
    ]);
    const apys = await apyRes.json() as Record<string, number>;
    const vaults = await vaultRes.json() as any[];

    const bscVaults = vaults.filter((v: any) => v.chain === 'bsc' && v.status === 'active');

    for (const v of bscVaults.slice(0, 30)) {
      const apy = apys[v.id];
      if (typeof apy === 'number' && apy > 0) {
        results.push({
          protocol: 'Beefy',
          pool: v.name || v.id,
          token: v.token || v.oracleId || 'UNKNOWN',
          apy: apy * 100,
          tvl: v.tvl || 0,
          risk: apy * 100 > 50 ? 'high' : apy * 100 > 15 ? 'medium' : 'low',
          contractAddress: v.earnContractAddress,
          action: 'vault',
          source: 'beefy-api',
          isSimulated: true, // Mainnet data only, no testnet contracts
        });
      }
    }
  } catch (e: any) {
    logger.warn('Beefy API failed: %s', e.message);
  }
  return results;
}

async function fetchDefiLlama(): Promise<YieldOpportunity[]> {
  const results: YieldOpportunity[] = [];
  try {
    const res = await fetch(API_URLS.DEFILLAMA_YIELDS, { signal: AbortSignal.timeout(15000) });
    const json = await res.json() as any;
    const pools: any[] = json.data || [];

    const bsc = pools
      .filter((p: any) => p.chain === 'Binance' && p.apy > 0 && p.tvlUsd > 100000)
      .sort((a: any, b: any) => b.apy - a.apy);

    for (const p of bsc.slice(0, 30)) {
      results.push({
        protocol: p.project || 'Unknown',
        pool: p.pool || p.symbol || 'Unknown',
        token: p.symbol || 'UNKNOWN',
        apy: p.apy,
        tvl: p.tvlUsd || 0,
        risk: p.apy > 50 ? 'high' : p.apy > 15 ? 'medium' : 'low',
        action: 'supply',
        source: 'defillama',
        isSimulated: true, // Mainnet data only
      });
    }
  } catch (e: any) {
    logger.warn('DefiLlama API failed: %s', e.message);
  }
  return results;
}

/**
 * Get all yield opportunities across Venus, Beefy, and DefiLlama.
 * Results are cached for 2 minutes.
 */
export async function getYields(): Promise<YieldOpportunity[]> {
  const cached = scannerCache.get<YieldOpportunity[]>(CACHE_KEY);
  if (cached) return cached;

  logger.info('Fetching yield data from Venus + Beefy + DefiLlama...');

  const [venus, beefy, defiLlama] = await Promise.all([
    fetchVenus(),
    fetchBeefy(),
    fetchDefiLlama(),
  ]);

  const results = [...venus, ...beefy, ...defiLlama].sort((a, b) => b.apy - a.apy);

  logger.info('APY aggregator: %d opportunities (Venus: %d, Beefy: %d, DefiLlama: %d)',
    results.length, venus.length, beefy.length, defiLlama.length);

  scannerCache.set(CACHE_KEY, results, CACHE_TTL);
  return results;
}

/**
 * Get yields filtered by token.
 */
export async function getYieldsForToken(token: string): Promise<YieldOpportunity[]> {
  const all = await getYields();
  return all.filter(y => y.token.toUpperCase().includes(token.toUpperCase()));
}
