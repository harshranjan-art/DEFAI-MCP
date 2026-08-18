/**
 * Trajectory runner — exercises the live agent against a curated user input,
 * captures the actual tool-call sequence, and scores it against the golden
 * expected_trajectory.
 *
 * Two modes:
 *   - "live": calls agentRouter.route() against real Groq. Used by
 *     `npm run eval` and CI (with GROQ_API_KEY).
 *   - "stub": planner/verifier responses are injected via stubGroq. Used
 *     in unit tests of the runner itself (`npm test`).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { setToolCallListener, type CapturedToolCall } from '../../src/bot/agentRouter';
import { matchTrajectory, type CapturedStep, type ExpectedTrajectory, type MatchResult } from './matcher';
import { judgeTrajectory, type JudgeScore } from './judge';

export interface TrajectoryCase {
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  user_input: string;
  user_id: string;
  expected_trajectory: ExpectedTrajectory;
  expected_response_keywords?: string[];
}

export interface TrajectoryResult {
  case_name: string;
  difficulty: string;
  captured: CapturedStep[];
  response: string;
  match: MatchResult;
  judge?: JudgeScore;
  duration_ms: number;
}

export type AgentRouteFn = (userId: string, message: string) => Promise<string>;

export interface RunOptions {
  /** Route function to exercise. Defaults to the real agentRouter.route. */
  route?: AgentRouteFn;
  /** Whether to invoke the LLM-as-judge (real Groq). False in unit tests. */
  judge?: boolean;
}

/**
 * Run a single trajectory and return its scored result.
 * Caller is responsible for setting up any required fixtures (test user,
 * mocked external APIs, stubbed Groq) BEFORE invoking this.
 */
export async function runTrajectory(
  tc: TrajectoryCase,
  opts: RunOptions = {},
): Promise<TrajectoryResult> {
  const captured: CapturedStep[] = [];
  const listener = (call: CapturedToolCall) => {
    captured.push({ tool: call.tool, args: call.args });
  };
  setToolCallListener(listener);

  const start = Date.now();
  let response = '';
  try {
    if (opts.route) {
      response = await opts.route(tc.user_id, tc.user_input);
    } else {
      // Lazy import so the runner module can be loaded in environments
      // where dotenv hasn't run yet (e.g., in tests of just the matcher).
      const { route } = await import('../../src/bot/agentRouter');
      response = await route(tc.user_id, tc.user_input);
    }
  } finally {
    setToolCallListener(null);
  }
  const duration_ms = Date.now() - start;

  const match = matchTrajectory(captured, tc.expected_trajectory, response, tc.expected_response_keywords);

  let judge: JudgeScore | undefined;
  if (opts.judge) {
    judge = await judgeTrajectory({
      user_input: tc.user_input,
      captured_trajectory: captured,
      expected_trajectory: tc.expected_trajectory,
      response,
    });
  }

  return { case_name: tc.name, difficulty: tc.difficulty, captured, response, match, judge, duration_ms };
}

/**
 * Load all golden trajectory JSON files from the given directory.
 * Sorted by filename so eval output is stable across runs.
 */
export function loadTrajectoryCases(dir: string): TrajectoryCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TrajectoryCase);
}

/**
 * Aggregate results into both JSON (machine-parseable) and Markdown
 * (PR-comment friendly) summary forms.
 */
export interface LatencyStats {
  min_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  avg_ms: number;
}

export interface AggregatedReport {
  total: number;
  passed: number;
  pass_rate: number;
  avg_judge?: { tool_correctness: number; argument_correctness: number; step_efficiency: number };
  by_difficulty: Record<string, { total: number; passed: number }>;
  latency: LatencyStats;
  results: TrajectoryResult[];
}

export function aggregate(results: TrajectoryResult[]): AggregatedReport {
  const passed = results.filter((r) => r.match.passed).length;
  const by_difficulty: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const d = by_difficulty[r.difficulty] || (by_difficulty[r.difficulty] = { total: 0, passed: 0 });
    d.total += 1;
    if (r.match.passed) d.passed += 1;
  }

  const judged = results.filter((r) => r.judge);
  const avg_judge = judged.length
    ? {
        tool_correctness: avg(judged.map((r) => r.judge!.tool_correctness)),
        argument_correctness: avg(judged.map((r) => r.judge!.argument_correctness)),
        step_efficiency: avg(judged.map((r) => r.judge!.step_efficiency)),
      }
    : undefined;

  return {
    total: results.length,
    passed,
    pass_rate: results.length ? passed / results.length : 0,
    avg_judge,
    by_difficulty,
    latency: latencyStats(results.map((r) => r.duration_ms)),
    results,
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Nearest-rank percentile — simple, deterministic, no interpolation. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function latencyStats(durations: number[]): LatencyStats {
  if (durations.length === 0) {
    return { min_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0, avg_ms: 0 };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    min_ms: sorted[0],
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted[sorted.length - 1],
    avg_ms: Math.round(avg(sorted)),
  };
}

export function formatMarkdown(report: AggregatedReport): string {
  const lines: string[] = [];
  lines.push(`## Trajectory eval results`);
  lines.push('');
  lines.push(`- **Pass rate:** ${report.passed}/${report.total} (${(report.pass_rate * 100).toFixed(1)}%)`);
  lines.push(
    `- **Latency:** p50=${report.latency.p50_ms}ms · p95=${report.latency.p95_ms}ms · p99=${report.latency.p99_ms}ms · max=${report.latency.max_ms}ms (avg ${report.latency.avg_ms}ms, n=${report.total})`,
  );
  if (report.avg_judge) {
    lines.push(
      `- **Avg judge scores:** tool=${report.avg_judge.tool_correctness.toFixed(2)}/3, args=${report.avg_judge.argument_correctness.toFixed(2)}/3, eff=${report.avg_judge.step_efficiency.toFixed(2)}/3`,
    );
  }
  lines.push(`- **By difficulty:** ${Object.entries(report.by_difficulty).map(([d, v]) => `${d} ${v.passed}/${v.total}`).join(' · ')}`);
  lines.push('');
  lines.push('### Per-case');
  lines.push('');
  // Large --repeat runs (hundreds-thousands of rows) would otherwise blow up
  // latest.md — list every failure (what you actually need to debug) plus a
  // capped sample of passes for a sanity check.
  const failed = report.results.filter((r) => !r.match.passed);
  const passedSample = report.results.filter((r) => r.match.passed).slice(0, 30);
  const rows = report.total <= 60 ? report.results : [...failed, ...passedSample];
  lines.push('| Case | Difficulty | Result | Failures |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    const status = r.match.passed ? '✅' : '❌';
    const failures = r.match.failures.length ? r.match.failures.slice(0, 3).join('; ') : '—';
    lines.push(`| ${r.case_name} | ${r.difficulty} | ${status} | ${failures} |`);
  }
  if (report.total > 60) {
    lines.push('');
    lines.push(
      `_${failed.length} failure(s) listed in full; showing ${passedSample.length} of ${report.total - failed.length} passing rows as a sample._`,
    );
  }
  return lines.join('\n');
}
