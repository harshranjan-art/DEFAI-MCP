/**
 * Rolling annualized volatility from the market_snapshots table.
 *
 * Used by riskManager to shrink position sizes for high-vol assets:
 *   adjustedMax = maxPositionUsd * min(1.0, targetVol / assetVol)
 *
 * Snapshot cadence is 5 minutes (Phase 0 snapshotLogger). 7 days * 288
 * samples/day = ~2,016 max samples per token. With fewer than
 * MIN_SAMPLES we fall back to a sane default — a fresh project shouldn't
 * block deposits just because we haven't observed enough price history.
 */

import { db } from './db';

const MIN_SAMPLES = 5;
const DEFAULT_ANNUALIZED_VOL = 0.30; // 30%/year — typical large-cap-crypto baseline
const TRADING_INTERVALS_PER_YEAR = 365 * 24 * 60 / 5; // 5-min bars

export interface VolResult {
  annualized_vol: number;     // e.g. 0.45 = 45%/year
  samples: number;
  source: 'computed' | 'default_insufficient_samples';
}

export function getRollingVol(token: string, lookbackHours: number = 7 * 24): VolResult {
  const rows = db.prepare(`
    SELECT price_usd FROM market_snapshots
    WHERE token = ? AND price_usd IS NOT NULL AND recorded_at > datetime('now', ?)
    ORDER BY recorded_at ASC
  `).all(token, `-${lookbackHours} hours`) as Array<{ price_usd: number }>;

  if (rows.length < MIN_SAMPLES) {
    return { annualized_vol: DEFAULT_ANNUALIZED_VOL, samples: rows.length, source: 'default_insufficient_samples' };
  }

  // Log returns: r_i = ln(P_i / P_{i-1})
  const returns: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].price_usd;
    const cur = rows[i].price_usd;
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < MIN_SAMPLES - 1) {
    return { annualized_vol: DEFAULT_ANNUALIZED_VOL, samples: rows.length, source: 'default_insufficient_samples' };
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const intervalStdDev = Math.sqrt(variance);
  // sqrt-time scaling: per-interval vol * sqrt(intervals_per_year)
  const annualized = intervalStdDev * Math.sqrt(TRADING_INTERVALS_PER_YEAR);

  // Clamp to a reasonable band — if computation goes haywire (e.g. one bad
  // price tick of 1000x), don't lock the user out of all trades.
  const clamped = Math.max(0.01, Math.min(5.0, annualized));
  return { annualized_vol: clamped, samples: rows.length, source: 'computed' };
}

/**
 * Compute the position-size cap after volatility adjustment.
 * Returns the cap in USD and the scalar applied for diagnostics.
 */
export function volAdjustedPositionCap(
  baseMaxUsd: number,
  targetVol: number,
  assetVol: number,
): { cap_usd: number; scalar: number } {
  if (assetVol <= 0 || targetVol <= 0) return { cap_usd: baseMaxUsd, scalar: 1 };
  const scalar = Math.min(1.0, targetVol / assetVol);
  return { cap_usd: baseMaxUsd * scalar, scalar };
}
