import { describe, it, expect, vi } from 'vitest';
import { withRetry, defaultRetryable } from '../../src/core/retry';
import { CircuitOpenError } from '../../src/core/circuit';

describe('withRetry', () => {
  it('returns the value when the first attempt succeeds', async () => {
    const fn = vi.fn(async () => 'ok');
    const r = await withRetry(fn);
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors and eventually succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNRESET');
      return 'ok';
    });
    const r = await withRetry(fn, { attempts: 3, baseMs: 1, jitter: false });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after `attempts` retries and throws the last error', async () => {
    const fn = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
    await expect(withRetry(fn, { attempts: 3, baseMs: 1, jitter: false })).rejects.toThrow('ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on a non-retryable error (default predicate)', async () => {
    const fn = vi.fn(async () => { throw new Error('bad request 400'); });
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a CircuitOpenError (fail-fast)', async () => {
    const fn = vi.fn(async () => { throw new CircuitOpenError('upstream'); });
    await expect(withRetry(fn, { attempts: 3, baseMs: 1 })).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors a custom retryOn predicate', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('custom-transient');
      return 'ok';
    });
    const r = await withRetry(fn, {
      attempts: 3,
      baseMs: 1,
      jitter: false,
      retryOn: (e: any) => e?.message?.includes('custom-transient'),
    });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('defaultRetryable', () => {
  it('matches network error codes', () => {
    expect(defaultRetryable(new Error('socket hang up ECONNRESET'))).toBe(true);
    expect(defaultRetryable(new Error('ETIMEDOUT after 8s'))).toBe(true);
    expect(defaultRetryable(new Error('EAI_AGAIN dns lookup failed'))).toBe(true);
  });

  it('matches HTTP 5xx in message', () => {
    expect(defaultRetryable(new Error('upstream returned 502'))).toBe(true);
    expect(defaultRetryable(new Error('venus 503'))).toBe(true);
  });

  it('matches AbortError', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(defaultRetryable(e)).toBe(true);
  });

  it('does not match 4xx', () => {
    expect(defaultRetryable(new Error('400 bad request'))).toBe(false);
    expect(defaultRetryable(new Error('not found 404'))).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(defaultRetryable('string error')).toBe(false);
    expect(defaultRetryable(undefined)).toBe(false);
  });
});
