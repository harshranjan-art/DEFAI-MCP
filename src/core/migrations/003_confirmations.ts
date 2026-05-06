/**
 * Migration 003: confirmation gate.
 * Adds the pending_confirmations table — single-use, TTL-bound tokens that
 * gate destructive engine methods.
 */

export const MIGRATION_003_VERSION = 3;

export const MIGRATION_003_SQL = `
  CREATE TABLE IF NOT EXISTS pending_confirmations (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    args_json TEXT NOT NULL,
    preview_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_pending_user
    ON pending_confirmations(user_id, expires_at);
`;
