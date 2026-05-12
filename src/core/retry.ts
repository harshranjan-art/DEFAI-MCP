/**
 * withRetry — exponential backoff with full jitter.
 *
 * Default policy retries transient failures (network errors, 5xx) up to 3
 * attempts, capping the delay at 4s. Always uses full jitter (the delay is
 * a uniform random value in [delay/2, 1.5*delay]) so synchronized clients
 * don't thunder against a recovering upstream.
 */

import { CircuitOpenError } from './circuit';

export interface RetryOptions {
  attempts?: number;     // total attempts including the first
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  retryOn?: (e: unknown) => boolean;
}

const DEFAULTS = {
  attempts: 3,
  baseMs: 200,
  maxMs: 4_000,
  jitter: true,
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? DEFAULTS.attempts;
  const baseMs = opts.baseMs ?? DEFAULTS.baseMs;
  const maxMs = opts.maxMs ?? DEFAULTS.maxMs;
  const jitter = opts.jitter ?? DEFAULTS.jitter;
  const retryOn = opts.retryOn ?? defaultRetryable;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Never retry a tripped circuit — fail fast, the breaker's job.
      if (e instanceof CircuitOpenError) throw e;
      const isLast = i === attempts - 1;
      if (isLast || !retryOn(e)) throw e;
      const baseDelay = Math.min(baseMs * 2 ** i, maxMs);
      const wait = jitter ? baseDelay / 2 + Math.random() * baseDelay : baseDelay;
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function defaultRetryable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return true;
  const msg = e.message || '';
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED/.test(msg)) return true;
  if (/\b5\d\d\b/.test(msg)) return true; // HTTP 5xx, naive but cheap
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the event loop alive just for sleep
    if (typeof (t as any).unref === 'function') (t as any).unref();
  });
}
