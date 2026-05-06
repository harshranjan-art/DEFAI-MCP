/**
 * Migration 002: idempotency keys.
 * Adds nullable client_op_id columns + partial UNIQUE indexes (only enforced
 * when client_op_id IS NOT NULL, so legacy rows pre-migration coexist).
 */

export const MIGRATION_002_VERSION = 2;

export const MIGRATION_002_SQL = `
  ALTER TABLE trades    ADD COLUMN client_op_id TEXT;
  ALTER TABLE positions ADD COLUMN client_op_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_clientop
    ON trades(client_op_id) WHERE client_op_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_clientop
    ON positions(client_op_id) WHERE client_op_id IS NOT NULL;
`;
