/**
 * CircuitBreaker — fail-fast for an external dependency that has tipped into
 * a sustained-broken state. Wraps an async function; counts consecutive
 * failures; opens after `threshold`; rejects subsequent calls instantly with
 * `CircuitOpenError` until `resetAfterMs` elapses; then transitions to
 * half-open and probes recovery.
 *
 * Use ONLY on read-style external calls (price feeds, RPC reads). Do NOT
 * wrap on-chain writes — a failed swap is a real chain event, not an
 * outage, and tripping a breaker on writes hides bugs.
 */

import { logger } from '../utils/logger';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitOptions {
  threshold: number;              // consecutive failures before opening
  resetAfterMs: number;            // time to wait in open before half-open probe
  halfOpenSuccessQuota: number;    // probes needed to close back
}

const DEFAULTS: CircuitOptions = {
  threshold: 5,
  resetAfterMs: 30_000,
  halfOpenSuccessQuota: 2,
};

export class CircuitOpenError extends Error {
  constructor(public breakerName: string) {
    super(`Circuit ${breakerName} is open`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  private readonly opts: CircuitOptions;

  constructor(public readonly name: string, opts?: Partial<CircuitOptions>) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.opts.resetAfterMs) {
        throw new CircuitOpenError(this.name);
      }
      this.transition('half-open');
      this.halfOpenSuccesses = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.opts.halfOpenSuccessQuota) {
        this.failures = 0;
        this.transition('closed');
      }
      return;
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.opts.threshold) this.trip();
  }

  private trip(): void {
    this.openedAt = Date.now();
    this.transition('open');
  }

  private transition(next: CircuitState): void {
    if (next === this.state) return;
    logger.info({ breaker: this.name, from: this.state, to: next, failures: this.failures }, 'circuit transition');
    this.state = next;
  }

  /** Inspector — useful for tests and dashboards. */
  status(): { state: CircuitState; failures: number; halfOpenSuccesses: number; openedAt: number } {
    return {
      state: this.state,
      failures: this.failures,
      halfOpenSuccesses: this.halfOpenSuccesses,
      openedAt: this.openedAt,
    };
  }

  /** Test-only reset. */
  _reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = 0;
  }
}
