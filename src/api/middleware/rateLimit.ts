/**
 * Fixed-window IP rate limiter — Express middleware factory.
 *
 * Returns 429 with a Retry-After header when the bucket is full.
 *
 * Why fixed-window over token-bucket: the surfaces we apply this to
 * (auth/login, auth/register) are low-traffic, so the burstiness boundary
 * issue doesn't matter much. Fixed-window is ~20 lines, no extra deps,
 * easy to reason about. Production at scale would move to Redis + token
 * bucket; mention at interview.
 */

import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Override the IP-derivation function (e.g., for behind-proxy setups). */
  keyFn?: (req: Request) => string;
}

interface Bucket {
  count: number;
  reset: number; // epoch ms when the bucket resets to 0
}

const buckets = new Map<string, Bucket>();

// Single sweeper — clears expired buckets so memory stays bounded.
let sweeperStarted = false;
function startSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  const handle = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }, 60_000);
  if (typeof (handle as any).unref === 'function') (handle as any).unref();
}

function defaultKey(req: Request): string {
  // x-forwarded-for if present (proxied), else req.ip / connection address.
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}:${req.path}`;
}

export function rateLimit(opts: RateLimitOptions) {
  startSweeper();
  const key = opts.keyFn ?? defaultKey;
  return (req: Request, res: Response, next: NextFunction): void => {
    const k = key(req);
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || b.reset < now) {
      buckets.set(k, { count: 1, reset: now + opts.windowMs });
      next();
      return;
    }
    if (b.count >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.reset - now) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'rate_limited',
        retry_after_ms: b.reset - now,
        message: `Too many requests. Retry in ~${retryAfterSec}s.`,
      });
      return;
    }
    b.count += 1;
    next();
  };
}

/** Test-only: clear all bucket state. */
export function _resetRateLimitBuckets(): void {
  buckets.clear();
}
