/**
 * Idempotency — server-side dedup of write operations via client_op_id.
 * Backed by a partial UNIQUE index on trades.client_op_id (migration 002).
 */

import { db } from './db';

export type IdempotencyHit<T> = { hit: true; original: T };
export type IdempotencyMiss = { hit: false };

/**
 * Look up an existing trade by client_op_id.
 * Returns hit:true with the original row if a match exists, hit:false otherwise.
 * Caller MUST return the cached result without re-executing the side effect.
 */
export function checkTrade(clientOpId: string | undefined): IdempotencyHit<any> | IdempotencyMiss {
  if (!clientOpId) return { hit: false };
  const row = db.prepare(`SELECT * FROM trades WHERE client_op_id = ? LIMIT 1`).get(clientOpId) as any;
  return row ? { hit: true, original: row } : { hit: false };
}

export function checkPosition(clientOpId: string | undefined): IdempotencyHit<any> | IdempotencyMiss {
  if (!clientOpId) return { hit: false };
  const row = db.prepare(`SELECT * FROM positions WHERE client_op_id = ? LIMIT 1`).get(clientOpId) as any;
  return row ? { hit: true, original: row } : { hit: false };
}

/**
 * Generate a fresh client_op_id. Used internally when a transport doesn't supply one.
 */
export function newClientOpId(): string {
  // Browser/Node-portable v4-ish UUID without pulling extra dep cycles.
  // Good enough for a private-DB collision resistance check.
  return 'op_' + (
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  );
}
