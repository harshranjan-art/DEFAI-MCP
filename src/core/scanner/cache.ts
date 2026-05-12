/**
 * Generic TTL (time-to-live) cache.
 *
 * Entries expire after their individual TTL. A background sweeper runs every
 * `sweepEveryMs` to evict expired entries; without it, write-heavy callers
 * could accumulate dead entries indefinitely.
 *
 * `maxSize` caps memory — when exceeded, the oldest entries (by insertion
 * order, which Map preserves) are dropped first.
 */

interface CacheEntry {
  value: any;
  expiresAt: number;
}

export interface TTLCacheOptions {
  maxSize?: number;        // hard cap on entries before LRU-ish eviction kicks in
  sweepEveryMs?: number;   // background expiry sweep interval (set to 0 to disable)
}

export class TTLCache {
  private store = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private sweepTimer?: NodeJS.Timeout;

  constructor(opts: TTLCacheOptions = {}) {
    this.maxSize = opts.maxSize ?? 5_000;
    const sweepMs = opts.sweepEveryMs ?? 60_000;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
      // Don't keep the event loop alive just for the sweeper
      if (typeof (this.sweepTimer as any).unref === 'function') (this.sweepTimer as any).unref();
    }
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.store.has(key)) this.store.delete(key); // refresh insertion order
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > this.maxSize) this.evictOldest(this.store.size - this.maxSize);
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Test/diagnostic — returns the current entry count. */
  size(): number {
    return this.store.size;
  }

  /** Test/diagnostic — runs a manual expiry sweep. */
  sweep(): { evicted: number } {
    const now = Date.now();
    let evicted = 0;
    for (const [k, v] of this.store) {
      if (v.expiresAt < now) {
        this.store.delete(k);
        evicted += 1;
      }
    }
    return { evicted };
  }

  /** Stop the background sweeper. Call on shutdown to allow clean exit. */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  private evictOldest(n: number): void {
    let i = 0;
    for (const k of this.store.keys()) {
      if (i >= n) break;
      this.store.delete(k);
      i += 1;
    }
  }
}

// Shared scanner cache instance — Phase 2 adds bounded size + background sweep.
export const scannerCache = new TTLCache({ maxSize: 2_000, sweepEveryMs: 60_000 });
