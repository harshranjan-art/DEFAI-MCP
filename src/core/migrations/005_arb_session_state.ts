/**
 * Migration 005: arb-session FSM state expansion.
 *
 * Adds:
 *   current_state          — explicit FSM state, replaces the old binary `status`
 *                             ('active'|'stopped'). Existing rows are backfilled.
 *   cooling_until          — when COOLING state expires (reserved; used in 2.5)
 *   failure_count          — consecutive failure counter (reserved; used in 2.5)
 *   last_step_completed    — 'BUY' | 'SELL' | NULL — checkpoint within EXECUTING
 *                             (reserved; populated once arb adapters are real)
 *
 * The legacy `status` column stays. Both columns are kept in sync during this
 * phase; new code reads/writes `current_state`, legacy code keeps working.
 */

export const MIGRATION_005_VERSION = 5;

export const MIGRATION_005_SQL = `
  ALTER TABLE auto_arb_sessions ADD COLUMN current_state TEXT;
  ALTER TABLE auto_arb_sessions ADD COLUMN cooling_until DATETIME;
  ALTER TABLE auto_arb_sessions ADD COLUMN failure_count INTEGER DEFAULT 0;
  ALTER TABLE auto_arb_sessions ADD COLUMN last_step_completed TEXT;
  UPDATE auto_arb_sessions SET current_state = CASE
    WHEN status = 'active'  THEN 'SCANNING'
    WHEN status = 'stopped' THEN 'STOPPED'
    ELSE 'STOPPED'
  END WHERE current_state IS NULL;
  CREATE INDEX IF NOT EXISTS idx_auto_arb_current_state
    ON auto_arb_sessions(current_state);
`;
