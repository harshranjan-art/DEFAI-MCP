import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/core/db';
import { getRollingVol, volAdjustedPositionCap } from '../../src/core/vol';

const TOKEN = 'VOLTEST';

beforeAll(() => {
  // No users table dependency — market_snapshots is keyed by token only.
});

beforeEach(() => {
  db.prepare(`DELETE FROM market_snapshots WHERE token = ?`).run(TOKEN);
});

function insertPrices(prices: number[]): void {
  // Insert with monotonically increasing timestamps within the lookback window.
  // SQLite's CURRENT_TIMESTAMP doesn't change within a single statement, so we
  // offset each row backwards from now.
  for (let i = 0; i < prices.length; i++) {
    const offsetSec = (prices.length - i) * 60; // 1-minute apart
    db.prepare(`
      INSERT INTO market_snapshots (protocol, token, price_usd, recorded_at)
      VALUES ('test', ?, ?, datetime('now', ?))
    `).run(TOKEN, prices[i], `-${offsetSec} seconds`);
  }
}

describe('getRollingVol', () => {
  it('returns default when there are too few samples', () => {
    insertPrices([100]); // only 1 sample
    const v = getRollingVol(TOKEN);
    expect(v.source).toBe('default_insufficient_samples');
    expect(v.annualized_vol).toBe(0.30); // documented default
  });

  it('returns default when no samples exist at all', () => {
    const v = getRollingVol(TOKEN);
    expect(v.source).toBe('default_insufficient_samples');
    expect(v.samples).toBe(0);
  });

  it('computes a non-zero vol when prices vary', () => {
    insertPrices([100, 101, 99, 102, 98, 103, 97]);
    const v = getRollingVol(TOKEN);
    expect(v.source).toBe('computed');
    expect(v.annualized_vol).toBeGreaterThan(0);
    // ~2% swings per minute → annualized vol should be very large.
    expect(v.annualized_vol).toBeGreaterThan(0.1);
  });

  it('returns ~0 (clamped to 0.01 floor) for a constant price series', () => {
    insertPrices([100, 100, 100, 100, 100, 100, 100]);
    const v = getRollingVol(TOKEN);
    expect(v.source).toBe('computed');
    expect(v.annualized_vol).toBe(0.01); // floor
  });

  it('clamps absurd vol (e.g. one bad tick) to a 5.0 ceiling', () => {
    insertPrices([100, 100, 100, 100, 100, 100, 100, 100, 1e6, 100, 100]);
    const v = getRollingVol(TOKEN);
    expect(v.source).toBe('computed');
    expect(v.annualized_vol).toBeLessThanOrEqual(5.0);
  });
});

describe('volAdjustedPositionCap', () => {
  it('returns the base cap unchanged when asset vol <= target vol', () => {
    const r = volAdjustedPositionCap(1000, 0.30, 0.20);
    expect(r.scalar).toBe(1);
    expect(r.cap_usd).toBe(1000);
  });

  it('shrinks the cap proportionally when asset vol > target', () => {
    const r = volAdjustedPositionCap(1000, 0.30, 0.60);
    expect(r.scalar).toBeCloseTo(0.5, 6);
    expect(r.cap_usd).toBeCloseTo(500, 6);
  });

  it('handles zero asset vol (no scaling) without dividing by zero', () => {
    const r = volAdjustedPositionCap(1000, 0.30, 0);
    expect(r.scalar).toBe(1);
    expect(r.cap_usd).toBe(1000);
  });
});
