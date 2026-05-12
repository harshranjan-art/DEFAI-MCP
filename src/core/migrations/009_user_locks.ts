/**
 * Migration 009: per-user execution lock.
 *
 * Prevents two transports (Telegram bot + dashboard + MCP) from racing on
 * the same user's wallet. Idempotency keys (Phase 1) cover the same-key
 * replay case; this lock covers the different-key concurrent case.
 *
 * A short TTL (30s) handles the holder-crashed scenario — the lock
 * auto-expires so a crashed process doesn't permanently wedge the user.
 */

export const MIGRATION_009_VERSION = 9;

export const MIGRATION_009_SQL = `
  CREATE TABLE IF NOT EXISTS user_locks (
    user_id TEXT PRIMARY KEY,
    held_by TEXT NOT NULL,
    acquired_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_locks_expires
    ON user_locks(expires_at);
`;
