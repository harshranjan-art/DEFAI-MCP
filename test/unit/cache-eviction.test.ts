import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTLCache } from '../../src/core/scanner/cache';

describe('TTLCache eviction', () => {
  beforeEach(() => vi.useRealTimers());

  it('returns null for an expired entry on next get + auto-deletes it', async () => {
    const c = new TTLCache({ sweepEveryMs: 0 });
    c.set('k', 'v', 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(c.get('k')).toBeNull();
    expect(c.size()).toBe(0);
  });

  it('manual sweep evicts all expired entries', async () => {
    const c = new TTLCache({ sweepEveryMs: 0 });
    c.set('a', 1, 10);
    c.set('b', 2, 10);
    c.set('c', 3, 5_000);
    await new Promise((r) => setTimeout(r, 30));
    const { evicted } = c.sweep();
    expect(evicted).toBe(2);
    expect(c.size()).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('respects maxSize by evicting oldest entries', () => {
    const c = new TTLCache({ maxSize: 3, sweepEveryMs: 0 });
    c.set('a', 1, 60_000);
    c.set('b', 2, 60_000);
    c.set('c', 3, 60_000);
    c.set('d', 4, 60_000); // pushes over the cap
    expect(c.size()).toBe(3);
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('re-setting an existing key refreshes insertion order (oldest is the OTHER key)', () => {
    const c = new TTLCache({ maxSize: 2, sweepEveryMs: 0 });
    c.set('a', 1, 60_000);
    c.set('b', 2, 60_000);
    c.set('a', 99, 60_000); // refresh 'a' — 'b' is now the oldest
    c.set('c', 3, 60_000);  // would normally evict 'a'; instead evicts 'b'
    expect(c.get('a')).toBe(99);
    expect(c.get('b')).toBeNull();
    expect(c.get('c')).toBe(3);
  });

  it('has() returns false for expired entries', async () => {
    const c = new TTLCache({ sweepEveryMs: 0 });
    c.set('x', 'v', 5);
    expect(c.has('x')).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.has('x')).toBe(false);
  });

  it('background sweeper does not keep the event loop alive (unref-able)', () => {
    // Smoke test — creating with sweep on shouldn't hang the test runner.
    // If unref() is missing the test process will hang after this case.
    const c = new TTLCache({ sweepEveryMs: 50 });
    c.set('x', 1, 100);
    c.stop();
    expect(c.size()).toBe(1);
  });
});
