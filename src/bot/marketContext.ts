/**
 * Brief market + user-state snapshot for the verifier sub-agent.
 *
 * The verifier runs in a FRESH LLM context (no tools, no history, no
 * conversation memory). It needs *just enough* state to reason about whether
 * a proposed action looks consistent with what the user appears to want.
 *
 * Keep this small and structured. The verifier's whole reason to exist is
 * to be hard to inject into — a long market_context string defeats that.
 */

import * as positionTracker from '../core/positionTracker';
import * as dbOps from '../core/db';
import { getTokenPrices } from '../core/scanner/priceAggregator';
import { logger } from '../utils/logger';

const RELEVANT_TOKENS = ['BNB', 'USDT', 'WBNB'];

export interface MarketContext {
  smartAccountAddress: string;
  recentPricesUsd: Record<string, number>;     // token symbol -> USD
  openPositionsCount: number;
  totalValueUsd: number;
}

export async function buildMarketContext(userId: string): Promise<MarketContext> {
  const portfolio = positionTracker.getPortfolio(userId);
  const user = dbOps.getUser(userId);

  let prices: Record<string, number> = {};
  try {
    const tokenPrices = await getTokenPrices();
    prices = Object.fromEntries(tokenPrices.map((p) => [p.token, p.priceUsd]));
  } catch (e: any) {
    // Verifier still runs even if price lookup fails — falls back to hardcoded.
    logger.warn({ err: e?.message }, 'marketContext: price fetch failed, using defaults');
  }

  // Always include the relevant tokens with a sensible fallback so the
  // verifier has SOMETHING to reason about.
  const recentPricesUsd: Record<string, number> = {};
  for (const t of RELEVANT_TOKENS) {
    recentPricesUsd[t] = prices[t] ?? (t === 'USDT' || t === 'BUSD' ? 1 : t === 'BNB' ? 600 : 0);
  }

  return {
    smartAccountAddress: user?.smart_account_address || portfolio.smartAccountAddress || '',
    recentPricesUsd,
    openPositionsCount: portfolio.positions.length,
    totalValueUsd: portfolio.totalValueUsd,
  };
}

/**
 * Compact one-line context the verifier can ingest cheaply.
 * Deliberately omits raw position metadata to keep the verifier's context
 * tiny and stable — the more structured + bounded, the harder to inject.
 */
export function formatMarketContext(ctx: MarketContext): string {
  const prices = Object.entries(ctx.recentPricesUsd)
    .map(([t, p]) => `${t}=$${p}`)
    .join(', ');
  return [
    `User smart account: ${ctx.smartAccountAddress || 'unknown'}`,
    `Open positions: ${ctx.openPositionsCount}`,
    `Total portfolio value: $${ctx.totalValueUsd.toFixed(2)}`,
    `Recent prices: ${prices}`,
  ].join(' | ');
}
