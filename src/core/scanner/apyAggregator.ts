import { logger } from '../../utils/logger';
import { API_URLS } from '../../utils/constants';
import { scannerCache } from './cache';
import { CircuitBreaker, CircuitOpenError } from '../circuit';
import { withRetry } from '../retry';
import { sanitizeString } from '../sanitize';

const venusBreaker = new CircuitBreaker('venus_api');
const beefyBreaker = new CircuitBreaker('beefy_api');
const defillamaBreaker = new CircuitBreaker('defillama_api');

function isCircuitOpen(e: unknown): e is CircuitOpenError {
  return e instanceof CircuitOpenError;
}

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
    const json = await venusBreaker.exec(() =>
      withRetry(async () => {
        const res = await fetch(API_URLS.VENUS, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`venus ${res.status}`);
        return (await res.json()) as any;
      }, { attempts: 2 }),
    );
    const markets: any[] = json?.result ?? json?.data?.markets ?? json?.markets ?? [];

    for (const m of markets) {
      const apy = parseFloat(m.supplyApy || '0');
      if (apy > 0 && m.underlyingSymbol) {
        // Layer 1: Venus API symbol + contract address flow into LLM context.
        const symbol = sanitizeString(m.underlyingSymbol, { source: 'venus', field: 'token', maxLength: 16 });
        const contractAddress = sanitizeString(m.address || '', { source: 'venus', field: 'contractAddress', maxLength: 42 });
        if (symbol.flagged || contractAddress.flagged) {
          logger.warn(
            { source: 'venus', flagged: [...(symbol.flagged ? ['token'] : []), ...(contractAddress.flagged ? ['contractAddress'] : [])] },
            'sanitizer flagged scanner field',
          );
        }
        results.push({
          protocol: 'Venus',
          pool: `${symbol.value} Supply`,
          token: symbol.value,
          apy,
          tvl: parseFloat(m.totalSupplyUsd || '0'),
          risk: 'low',
          contractAddress: contractAddress.value || undefined,
          action: 'supply',
          source: 'venus-api',
          isSimulated: false, // Real testnet execution available
        });
      }
    }
  } catch (e: any) {
    logger.warn({ breaker: 'venus_api', circuit_open: isCircuitOpen(e) }, 'Venus API failed: %s', e.message);
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
    const [apys, vaults] = await beefyBreaker.exec(() =>
      withRetry(async () => {
        const [apyRes, vaultRes] = await Promise.all([
          fetch(API_URLS.BEEFY_APY, { signal: AbortSignal.timeout(10000) }),
          fetch(API_URLS.BEEFY_VAULTS, { signal: AbortSignal.timeout(10000) }),
        ]);
        if (!apyRes.ok) throw new Error(`beefy-apy ${apyRes.status}`);
        if (!vaultRes.ok) throw new Error(`beefy-vaults ${vaultRes.status}`);
        const a = (await apyRes.json()) as Record<string, number>;
        const v = (await vaultRes.json()) as any[];
        return [a, v] as const;
      }, { attempts: 2 }),
    );

    const bscVaults = vaults.filter((v: any) => v.chain === 'bsc' && v.status === 'active');

    for (const v of bscVaults.slice(0, 30)) {
      const apy = apys[v.id];
      if (typeof apy === 'number' && apy > 0) {
        // Layer 1: Beefy returns user-facing strings that flow into LLM context.
        const pool = sanitizeString(v.name || v.id, { source: 'beefy', field: 'pool', maxLength: 64 });
        const token = sanitizeString(v.token || v.oracleId || 'UNKNOWN', { source: 'beefy', field: 'token', maxLength: 32 });
        const contractAddress = sanitizeString(v.earnContractAddress || '', { source: 'beefy', field: 'contractAddress', maxLength: 42 });
        const anyFlagged = pool.flagged || token.flagged || contractAddress.flagged;
        if (anyFlagged) {
          logger.warn({ source: 'beefy', flagged: [pool.flagged && 'pool', token.flagged && 'token', contractAddress.flagged && 'contractAddress'].filter(Boolean) }, 'sanitizer flagged scanner field');
        }
        results.push({
          protocol: 'Beefy',
          pool: pool.value,
          token: token.value,
          apy: apy * 100,
          tvl: v.tvl || 0,
          risk: apy * 100 > 50 ? 'high' : apy * 100 > 15 ? 'medium' : 'low',
          contractAddress: contractAddress.value || undefined,
          action: 'vault',
          source: 'beefy-api',
          isSimulated: true, // Mainnet data only, no testnet contracts
        });
      }
    }
  } catch (e: any) {
    logger.warn({ breaker: 'beefy_api', circuit_open: isCircuitOpen(e) }, 'Beefy API failed: %s', e.message);
  }
  return results;
}

async function fetchDefiLlama(): Promise<YieldOpportunity[]> {
  const results: YieldOpportunity[] = [];
  try {
    const json = await defillamaBreaker.exec(() =>
      withRetry(async () => {
        const res = await fetch(API_URLS.DEFILLAMA_YIELDS, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`defillama ${res.status}`);
        return (await res.json()) as any;
      }, { attempts: 2 }),
    );
    const pools: any[] = json.data || [];

    const bsc = pools
      .filter((p: any) => p.chain === 'Binance' && p.apy > 0 && p.tvlUsd > 100000)
      .sort((a: any, b: any) => b.apy - a.apy);

    for (const p of bsc.slice(0, 30)) {
      // Layer 1: DefiLlama strings are 100% community-curated → highest injection risk.
      const protocol = sanitizeString(p.project || 'Unknown', { source: 'defillama', field: 'protocol', maxLength: 48 });
      const pool = sanitizeString(p.pool || p.symbol || 'Unknown', { source: 'defillama', field: 'pool', maxLength: 64 });
      const token = sanitizeString(p.symbol || 'UNKNOWN', { source: 'defillama', field: 'token', maxLength: 32 });
      const anyFlagged = protocol.flagged || pool.flagged || token.flagged;
      if (anyFlagged) {
        logger.warn(
          { source: 'defillama', flagged: [protocol.flagged && 'protocol', pool.flagged && 'pool', token.flagged && 'token'].filter(Boolean) },
          'sanitizer flagged scanner field',
        );
      }
      results.push({
        protocol: protocol.value,
        pool: pool.value,
        token: token.value,
        apy: p.apy,
        tvl: p.tvlUsd || 0,
        risk: p.apy > 50 ? 'high' : p.apy > 15 ? 'medium' : 'low',
        action: 'supply',
        source: 'defillama',
        isSimulated: true, // Mainnet data only
      });
    }
  } catch (e: any) {
    logger.warn({ breaker: 'defillama_api', circuit_open: isCircuitOpen(e) }, 'DefiLlama API failed: %s', e.message);
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
