/**
 * Migration 008: per-call LLM cost tracking.
 *
 * One row per Groq (or future Vertex) chat-completion call. Lets us answer:
 *   - which user is most expensive?
 *   - which task type (planner / verifier / classifier / summarizer)?
 *   - is prompt caching helping? (input_cached_tokens / input_tokens)
 *   - did the recent code change blow up per-turn cost?
 */

export const MIGRATION_008_VERSION = 8;

export const MIGRATION_008_SQL = `
  CREATE TABLE IF NOT EXISTS llm_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    user_id TEXT,
    model TEXT NOT NULL,
    task TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    input_cached_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_llm_costs_user_day
    ON llm_costs(user_id, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_llm_costs_task
    ON llm_costs(task, occurred_at);
  CREATE INDEX IF NOT EXISTS idx_llm_costs_trace
    ON llm_costs(trace_id);
`;
