/**
 * Per-user execution lock — serializes write actions across transports.
 *
 * Acquire is atomic via a SQLite transaction (SELECT + INSERT OR REPLACE)
 * so two concurrent acquire calls deterministically pick one winner.
 * TTL prevents a crashed holder from permanently wedging the user.
 *
 * The `holder` is a short opaque token the caller generates (typically the
 * trace_id from the engine method). It's only used to gate release —
 * holders are not authenticated, so callers must keep their token secret
 * within the same process.
 */

import { db } from './db';
import { logger } from '../utils/logger';

const DEFAULT_TTL_MS = 30_000;

export interface AcquireResult {
  acquired: boolean;
  /** The current holder when acquired = false; useful for diagnostics. */
  held_by?: string;
  /** When the lock will auto-expire — caller can return a helpful error. */
  expires_at?: string;
}

/**
 * Try to grab a per-user lock. Returns acquired:true if successful or if
 * the prior lock has expired (in which case it's overwritten). Returns
 * acquired:false with held_by + expires_at if the lock is still live.
 */
export function acquireUserLock(
  userId: string,
  holder: string,
  ttlMs: number = DEFAULT_TTL_MS,
): AcquireResult {
  const result = db.transaction((): AcquireResult => {
    const row = db.prepare(`SELECT held_by, expires_at FROM user_locks WHERE user_id = ?`).get(userId) as
      | { held_by: string; expires_at: string }
      | undefined;
    const now = new Date();

    if (row && new Date(row.expires_at) > now) {
      // Lock is live and held by someone else (or by us — caller's choice
      // to treat that as a no-op or as contention; we report contention).
      return { acquired: false, held_by: row.held_by, expires_at: row.expires_at };
    }

    const expires_at = new Date(now.getTime() + ttlMs).toISOString();
    db.prepare(`
      INSERT INTO user_locks (user_id, held_by, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        held_by = excluded.held_by,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    `).run(userId, holder, now.toISOString(), expires_at);
    return { acquired: true, expires_at };
  })();
  if (!result.acquired) {
    logger.warn({ userId, holder, currentHolder: result.held_by, expires_at: result.expires_at }, 'user-lock contention');
  }
  return result;
}

/**
 * Release the lock if we hold it. No-op if the lock is held by someone else
 * or has already expired — protects against double-release after a TTL
 * timeout overlaps with a successful run.
 */
export function releaseUserLock(userId: string, holder: string): boolean {
  const r = db.prepare(`DELETE FROM user_locks WHERE user_id = ? AND held_by = ?`).run(userId, holder);
  return r.changes > 0;
}

/**
 * Convenience wrapper: acquire, run fn, always release. Returns the fn's
 * return value if acquired; throws LockContentionError if not.
 */
export class LockContentionError extends Error {
  constructor(public userId: string, public currentHolder?: string, public expires_at?: string) {
    super(`user lock for ${userId} is held by ${currentHolder ?? 'unknown'} until ${expires_at ?? 'unknown'}`);
    this.name = 'LockContentionError';
  }
}

export async function withUserLock<T>(
  userId: string,
  holder: string,
  fn: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const r = acquireUserLock(userId, holder, ttlMs);
  if (!r.acquired) throw new LockContentionError(userId, r.held_by, r.expires_at);
  try {
    return await fn();
  } finally {
    releaseUserLock(userId, holder);
  }
}
