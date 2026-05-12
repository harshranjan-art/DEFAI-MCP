/**
 * Per-call LLM cost accounting.
 *
 * Records one row per chat-completion call in the llm_costs table (migration 008).
 * Queries support per-user and per-task aggregation — used for daily budget
 * enforcement (this module) and the anomaly cron (Phase 4.5).
 */

import { db } from '../core/db';
import { logger } from '../utils/logger';

/**
 * Pricing table — USD per 1M tokens.
 * Source: Groq published pricing as of 2026-Q2.
 * When Vertex AI lands (Phase 7), add Gemini Pro / Flash here.
 */
const PRICING_USD_PER_M: Record<string, { input: number; output: number; cached: number }> = {
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79, cached: 0.30 },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79, cached: 0.30 },
  'llama-3.1-8b-instant':    { input: 0.05, output: 0.08, cached: 0.025 },
};

export type LlmTask = 'planner' | 'verifier' | 'classifier' | 'summarizer' | 'intent' | 'judge';

export interface CostRecord {
  trace_id: string;
  user_id?: string;
  model: string;
  task: LlmTask;
  input_tokens: number;
  input_cached_tokens?: number;
  output_tokens: number;
}

/**
 * Compute and persist the cost of one LLM call. Fail-soft — never throws,
 * since an observability failure shouldn't break the user-facing path.
 * Returns the computed cost so callers can attach it to a Langfuse span.
 */
export function recordCost(rec: CostRecord): number {
  const cost = computeCostUsd(rec);
  try {
    db.prepare(`
      INSERT INTO llm_costs (trace_id, user_id, model, task, input_tokens, input_cached_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.trace_id,
      rec.user_id ?? null,
      rec.model,
      rec.task,
      rec.input_tokens,
      rec.input_cached_tokens ?? 0,
      rec.output_tokens,
      cost,
    );
  } catch (e: any) {
    logger.warn({ err: e?.message, trace_id: rec.trace_id }, 'recordCost failed; continuing');
  }
  return cost;
}

/**
 * Compute USD cost for a call given pricing in the table above. Cached input
 * tokens are charged at the cached rate; the rest at the input rate. Output
 * is unconditional.
 */
export function computeCostUsd(rec: CostRecord): number {
  const p = PRICING_USD_PER_M[rec.model];
  if (!p) {
    logger.warn({ model: rec.model }, 'cost.computeCostUsd: unknown model, returning 0');
    return 0;
  }
  const cached = rec.input_cached_tokens ?? 0;
  const fresh = Math.max(0, rec.input_tokens - cached);
  const usd =
    (fresh * p.input + cached * p.cached + rec.output_tokens * p.output) / 1_000_000;
  // Round to 9 decimal places. Llama-8B verifier calls are ~$0.00001 — 6dp
  // would underreport by ~3% per call. 9dp preserves per-nanocent precision
  // while still trimming floating-point noise from sums.
  return Math.round(usd * 1_000_000_000) / 1_000_000_000;
}

export interface DailyCost {
  total_usd: number;
  by_task: Record<string, number>;
}

/**
 * Sum a user's cost spent today (UTC midnight boundary).
 */
export function getDailyCost(user_id: string, date?: string): DailyCost {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT task, SUM(cost_usd) AS total
    FROM llm_costs
    WHERE user_id = ? AND date(occurred_at) = ?
    GROUP BY task
  `).all(user_id, day) as Array<{ task: string; total: number }>;
  return {
    total_usd: rows.reduce((s, r) => s + (r.total ?? 0), 0),
    by_task: Object.fromEntries(rows.map((r) => [r.task, r.total ?? 0])),
  };
}

/**
 * Returns true if the user has reached or exceeded their daily LLM cost cap.
 * Returns false if no cap is configured (cap === 0 or undefined).
 */
export function isBudgetExceeded(user_id: string, capUsd: number | undefined): {
  exceeded: boolean;
  spent_usd: number;
  cap_usd: number;
} {
  if (!capUsd || capUsd <= 0) {
    return { exceeded: false, spent_usd: 0, cap_usd: capUsd ?? 0 };
  }
  const { total_usd } = getDailyCost(user_id);
  return { exceeded: total_usd >= capUsd, spent_usd: total_usd, cap_usd: capUsd };
}
