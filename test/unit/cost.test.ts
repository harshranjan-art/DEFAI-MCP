import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/core/db';
import { computeCostUsd, recordCost, getDailyCost, isBudgetExceeded } from '../../src/observability/cost';

const TEST_USER = 'cost-test-user';

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

beforeEach(() => {
  db.prepare(`DELETE FROM llm_costs WHERE user_id = ?`).run(TEST_USER);
});

describe('computeCostUsd', () => {
  it('computes cost for Llama-70B with no cache', () => {
    const c = computeCostUsd({
      trace_id: 't', model: 'llama-3.3-70b-versatile', task: 'planner',
      input_tokens: 1000, output_tokens: 100,
    });
    // 1000 * 0.59/1M + 100 * 0.79/1M = 0.00059 + 0.000079 = 0.000669
    expect(c).toBeCloseTo(0.000669, 9);
  });

  it('discounts cached input tokens', () => {
    const c = computeCostUsd({
      trace_id: 't', model: 'llama-3.3-70b-versatile', task: 'planner',
      input_tokens: 1000, input_cached_tokens: 800, output_tokens: 100,
    });
    // fresh: 200 * 0.59/1M = 0.000118
    // cached: 800 * 0.30/1M = 0.000240
    // output: 100 * 0.79/1M = 0.000079
    // total: 0.000437
    expect(c).toBeCloseTo(0.000437, 9);
  });

  it('uses Llama-8B-Instant pricing', () => {
    const c = computeCostUsd({
      trace_id: 't', model: 'llama-3.1-8b-instant', task: 'verifier',
      input_tokens: 200, output_tokens: 30,
    });
    // 200 * 0.05/1M + 30 * 0.08/1M = 0.00001 + 0.0000024 = 0.0000124
    expect(c).toBeCloseTo(0.0000124, 9);
  });

  it('returns 0 for unknown model (does not throw)', () => {
    const c = computeCostUsd({
      trace_id: 't', model: 'gpt-4o-mystery', task: 'planner',
      input_tokens: 1000, output_tokens: 100,
    });
    expect(c).toBe(0);
  });

  it('handles cached > input_tokens gracefully (clamps fresh to 0)', () => {
    const c = computeCostUsd({
      trace_id: 't', model: 'llama-3.3-70b-versatile', task: 'planner',
      input_tokens: 100, input_cached_tokens: 200, output_tokens: 10,
    });
    // fresh clamped to 0; cached: 200 * 0.30/1M = 0.00006; output: 10 * 0.79/1M = 0.0000079
    expect(c).toBeCloseTo(0.0000679, 9);
  });
});

describe('recordCost + getDailyCost', () => {
  it('persists a row and returns the cost', () => {
    const cost = recordCost({
      trace_id: 't1', user_id: TEST_USER, model: 'llama-3.3-70b-versatile',
      task: 'planner', input_tokens: 1000, output_tokens: 100,
    });
    expect(cost).toBeGreaterThan(0);
    const row = db.prepare(`SELECT * FROM llm_costs WHERE trace_id = ?`).get('t1') as any;
    expect(row).toBeDefined();
    expect(row.task).toBe('planner');
    expect(row.cost_usd).toBeCloseTo(cost, 9);
  });

  it('sums daily cost by task', () => {
    recordCost({ trace_id: 'tA', user_id: TEST_USER, model: 'llama-3.3-70b-versatile', task: 'planner', input_tokens: 1000, output_tokens: 50 });
    recordCost({ trace_id: 'tA', user_id: TEST_USER, model: 'llama-3.1-8b-instant', task: 'verifier', input_tokens: 200, output_tokens: 30 });
    recordCost({ trace_id: 'tB', user_id: TEST_USER, model: 'llama-3.3-70b-versatile', task: 'planner', input_tokens: 800, output_tokens: 60 });

    const daily = getDailyCost(TEST_USER);
    expect(daily.total_usd).toBeGreaterThan(0);
    expect(daily.by_task.planner).toBeGreaterThan(0);
    expect(daily.by_task.verifier).toBeGreaterThan(0);
    // Planner total = two rows
    const plannerCount = db.prepare(`SELECT COUNT(*) AS n FROM llm_costs WHERE user_id = ? AND task = 'planner'`).get(TEST_USER) as any;
    expect(plannerCount.n).toBe(2);
  });

  it('isolates today from past days', () => {
    recordCost({ trace_id: 't-today', user_id: TEST_USER, model: 'llama-3.1-8b-instant', task: 'verifier', input_tokens: 100, output_tokens: 10 });
    // Manually backdate one row
    db.prepare(`UPDATE llm_costs SET occurred_at = '2020-01-01 00:00:00' WHERE trace_id = ?`).run('t-today');
    const daily = getDailyCost(TEST_USER);
    expect(daily.total_usd).toBe(0);
  });

  it('recordCost is fail-soft on unknown model (no throw, returns 0, no row)', () => {
    const cost = recordCost({
      trace_id: 't-unknown', user_id: TEST_USER, model: 'unknown-model',
      task: 'planner', input_tokens: 100, output_tokens: 10,
    });
    expect(cost).toBe(0);
    // A row IS still inserted with cost 0 — we want visibility into surprises.
    const row = db.prepare(`SELECT * FROM llm_costs WHERE trace_id = ?`).get('t-unknown') as any;
    expect(row).toBeDefined();
    expect(row.cost_usd).toBe(0);
  });
});

describe('isBudgetExceeded', () => {
  it('returns false when cap is undefined / 0 (no enforcement)', () => {
    expect(isBudgetExceeded(TEST_USER, undefined).exceeded).toBe(false);
    expect(isBudgetExceeded(TEST_USER, 0).exceeded).toBe(false);
  });

  it('returns false when daily spend is below cap', () => {
    recordCost({ trace_id: 't1', user_id: TEST_USER, model: 'llama-3.1-8b-instant', task: 'verifier', input_tokens: 100, output_tokens: 10 });
    const r = isBudgetExceeded(TEST_USER, 1.0);
    expect(r.exceeded).toBe(false);
    expect(r.spent_usd).toBeGreaterThan(0);
    expect(r.cap_usd).toBe(1.0);
  });

  it('returns true once spend reaches or exceeds cap', () => {
    // 1M tokens × planner input rate = $0.59 — exceeds $0.50 cap.
    recordCost({
      trace_id: 't-big', user_id: TEST_USER, model: 'llama-3.3-70b-versatile',
      task: 'planner', input_tokens: 1_000_000, output_tokens: 0,
    });
    const r = isBudgetExceeded(TEST_USER, 0.5);
    expect(r.exceeded).toBe(true);
    expect(r.spent_usd).toBeGreaterThanOrEqual(0.5);
  });
});
