/**
 * Migration 004: persistent state-transitions log.
 * Append-only audit log for every FSM transition. Lets you debug
 * "how did this entity end up in state X?" with one query.
 */

export const MIGRATION_004_VERSION = 4;

export const MIGRATION_004_SQL = `
  CREATE TABLE IF NOT EXISTS state_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    event TEXT NOT NULL,
    metadata TEXT,
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_transitions_entity
    ON state_transitions(machine, entity_id, occurred_at);
`;
