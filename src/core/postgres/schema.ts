/**
 * Postgres schema — translated from the SQLite schema in src/core/db.ts.
 *
 * Type translations:
 *   INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL PRIMARY KEY
 *   DATETIME                          → TIMESTAMPTZ DEFAULT now()
 *   INTEGER (used as boolean)         → BOOLEAN
 *   REAL                              → DOUBLE PRECISION
 *   json_set() function (SQLite)      → use jsonb_set() in app SQL
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 * Run once on a fresh DB, then let the migration runner apply versioned
 * migrations (POSTGRES_MIGRATIONS_SQL below).
 */
export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  encrypted_private_key TEXT NOT NULL,
  smart_account_address TEXT NOT NULL,
  pimlico_api_key TEXT,
  telegram_id BIGINT UNIQUE,
  risk_config TEXT DEFAULT '{}',
  alert_config TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  entry_price DOUBLE PRECISION,
  entry_apy DOUBLE PRECISION,
  current_value_usd DOUBLE PRECISION,
  pnl_usd DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'open',
  tx_hash TEXT,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  protocol TEXT NOT NULL,
  from_token TEXT,
  to_token TEXT,
  from_amount TEXT,
  to_amount TEXT,
  price_usd DOUBLE PRECISION,
  gas_usd DOUBLE PRECISION,
  tx_hash TEXT NOT NULL,
  position_id TEXT REFERENCES positions(id),
  executed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  apy DOUBLE PRECISION,
  price_usd DOUBLE PRECISION,
  tvl_usd DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auto_arb_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_loss_usd DOUBLE PRECISION NOT NULL,
  max_slippage_bps INTEGER NOT NULL DEFAULT 50,
  total_pnl_usd DOUBLE PRECISION DEFAULT 0,
  trades_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON market_snapshots(recorded_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_auto_arb_status ON auto_arb_sessions(status);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/**
 * Bundled migrations 002 + 003 + 004 + 005 + 008 + 009. Applied atomically
 * once per database (idempotent via schema_migrations(version)).
 */
export const POSTGRES_MIGRATIONS_SQL = `
-- 002 — Idempotency (client_op_id partial UNIQUE on trades + positions)
ALTER TABLE trades    ADD COLUMN IF NOT EXISTS client_op_id TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS client_op_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_client_op_id
  ON trades(client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_client_op_id
  ON positions(client_op_id) WHERE client_op_id IS NOT NULL;

-- 003 — Pending confirmations
CREATE TABLE IF NOT EXISTS pending_confirmations (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_confirmations_user
  ON pending_confirmations(user_id, expires_at) WHERE consumed_at IS NULL;

-- 004 — State-transition audit log
CREATE TABLE IF NOT EXISTS state_transitions (
  id BIGSERIAL PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  event TEXT NOT NULL,
  context_json TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_state_transitions_entity
  ON state_transitions(entity_kind, entity_id, occurred_at);

-- 005 — Arb session state column + failure counter
ALTER TABLE auto_arb_sessions ADD COLUMN IF NOT EXISTS current_state TEXT NOT NULL DEFAULT 'SCANNING';
ALTER TABLE auto_arb_sessions ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_auto_arb_current_state ON auto_arb_sessions(current_state);
UPDATE auto_arb_sessions SET current_state = 'SCANNING' WHERE current_state IS NULL AND status = 'active';
UPDATE auto_arb_sessions SET current_state = 'STOPPED'  WHERE current_state IS NULL AND status <> 'active';

-- 008 — Per-call LLM cost ledger
CREATE TABLE IF NOT EXISTS llm_costs (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL,
  user_id TEXT,
  model TEXT NOT NULL,
  task TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  input_cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_costs_user_day ON llm_costs(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_llm_costs_trace ON llm_costs(trace_id);

-- 009 — Per-user execution locks
CREATE TABLE IF NOT EXISTS user_locks (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  lock_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_locks_expires ON user_locks(expires_at);
`;

export const POSTGRES_TARGET_VERSION = 9;
