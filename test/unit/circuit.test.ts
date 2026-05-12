import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../../src/core/circuit';

const fastOpts = { threshold: 3, resetAfterMs: 1_000, halfOpenSuccessQuota: 2 };

describe('CircuitBreaker', () => {
  it('passes through results when closed', async () => {
    const cb = new CircuitBreaker('test', fastOpts);
    const r = await cb.exec(async () => 42);
    expect(r).toBe(42);
    expect(cb.status().state).toBe('closed');
  });

  it('opens after `threshold` consecutive failures', async () => {
    const cb = new CircuitBreaker('test', fastOpts);
    const failing = vi.fn(async () => { throw new Error('boom'); });
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(failing)).rejects.toThrow('boom');
    }
    expect(cb.status().state).toBe('open');
  });

  it('rejects with CircuitOpenError while open (without invoking fn)', async () => {
    const cb = new CircuitBreaker('test', fastOpts);
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    }
    const fn = vi.fn(async () => 'should not run');
    await expect(cb.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a single success resets the failure counter when closed', async () => {
    const cb = new CircuitBreaker('test', fastOpts);
    await expect(cb.exec(async () => { throw new Error('a'); })).rejects.toThrow();
    await expect(cb.exec(async () => { throw new Error('b'); })).rejects.toThrow();
    expect(cb.status().failures).toBe(2);
    await cb.exec(async () => 'ok');
    expect(cb.status().failures).toBe(0);
    expect(cb.status().state).toBe('closed');
  });

  it('transitions open -> half-open after resetAfterMs', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('test', fastOpts);
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    }
    expect(cb.status().state).toBe('open');
    vi.advanceTimersByTime(1_100);
    // First call after timeout: should enter half-open, run the fn
    const fn = vi.fn(async () => 'probe');
    const r = await cb.exec(fn);
    expect(r).toBe('probe');
    expect(fn).toHaveBeenCalled();
    expect(cb.status().state).toBe('half-open');
    vi.useRealTimers();
  });

  it('half-open -> closed after `halfOpenSuccessQuota` successes', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('test', fastOpts);
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    }
    vi.advanceTimersByTime(1_100);
    await cb.exec(async () => 'p1'); // half-open probe #1
    expect(cb.status().state).toBe('half-open');
    await cb.exec(async () => 'p2'); // probe #2 — should close
    expect(cb.status().state).toBe('closed');
    vi.useRealTimers();
  });

  it('half-open -> open on any failed probe', async () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('test', fastOpts);
    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    }
    vi.advanceTimersByTime(1_100);
    await expect(cb.exec(async () => { throw new Error('probe failed'); })).rejects.toThrow();
    expect(cb.status().state).toBe('open');
    vi.useRealTimers();
  });

  it('CircuitOpenError carries the breaker name', () => {
    const e = new CircuitOpenError('coingecko');
    expect(e.breakerName).toBe('coingecko');
    expect(e.message).toContain('coingecko');
  });
});
