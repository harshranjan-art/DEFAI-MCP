/**
 * Judge calibration — measures agreement between the LLM-as-judge
 * (defined in evals/helpers/judge.ts) and a hand-scored ground truth.
 *
 * Why this matters:
 *   The LLM-judge is what gates "the agent is still good enough" in CI.
 *   If the judge's scores systematically diverge from human judgement,
 *   the gate is meaningless. The fix is to re-calibrate (adjust the
 *   judge prompt, swap the model, raise/lower the threshold) whenever
 *   you change the planner stack — like Phase 7B (Groq Llama → Vertex
 *   Gemini 3) does.
 *
 * Usage:
 *   ts-node scripts/calibrate-judge.ts evals/calibration/judge-cases.json
 *
 * Input file format (JSON):
 *   [{
 *     "name": "swap-clean",
 *     "user_input": "swap 0.1 BNB to USDT",
 *     "captured_trajectory": [{"tool": "swap_tokens", "args": {...}}],
 *     "response": "OK, swapped...",
 *     "expected_trajectory": { "tool_sequence": [...] },
 *     "human_score": { "tool_correctness": 3, "argument_correctness": 3, "step_efficiency": 3 }
 *   }, ...]
 *
 * Output: a markdown report showing per-case agreement and the overall
 * agreement rate. Bullets stay short — designed to be pasted into a
 * commit body or PR description.
 *
 * Definition of agreement: per-rubric absolute difference ≤ 1 on the 0-3
 * scale. The plan target is ≥80% (4 of 5 cases) before declaring the
 * judge calibrated.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { judgeTrajectory, type JudgeScore } from '../evals/helpers/judge';
import { getLLMProvider } from '../src/llm';

interface CalibrationCase {
  name: string;
  user_input: string;
  captured_trajectory: Array<{ tool: string; args: Record<string, unknown> }>;
  response: string;
  expected_trajectory: { tool_sequence: Array<{ name: string; args_match?: Record<string, unknown> }> };
  human_score: {
    tool_correctness: number;
    argument_correctness: number;
    step_efficiency: number;
  };
}

const AGREEMENT_TOLERANCE = 1; // absolute diff ≤ 1 per rubric counts as agreement
const RUBRICS = ['tool_correctness', 'argument_correctness', 'step_efficiency'] as const;

function agreeOnRubric(judge: number, human: number): boolean {
  return Math.abs(judge - human) <= AGREEMENT_TOLERANCE;
}

function caseAgrees(judge: JudgeScore, human: CalibrationCase['human_score']): boolean {
  return RUBRICS.every((r) => agreeOnRubric(judge[r], human[r]));
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: ts-node scripts/calibrate-judge.ts <cases.json>');
    process.exit(2);
  }

  const cases: CalibrationCase[] = JSON.parse(readFileSync(path, 'utf-8'));
  if (cases.length === 0) {
    console.error('No cases in file');
    process.exit(2);
  }

  let provider = '<unknown>';
  let judgeModel = '<unknown>';
  try {
    const p = getLLMProvider();
    provider = p.name;
    judgeModel = p.modelFor('judge');
  } catch {
    // Provider resolution shouldn't fail in normal use, but it shouldn't
    // crash the calibration if env is half-set either.
  }

  console.log(`# Judge Calibration`);
  console.log('');
  console.log(`- Provider: **${provider}**`);
  console.log(`- Judge model: \`${judgeModel}\``);
  console.log(`- Tolerance: ±${AGREEMENT_TOLERANCE} per rubric (0-3 scale)`);
  console.log(`- Cases: ${cases.length}`);
  console.log('');
  console.log(`| Case | Judge: tool/arg/eff | Human: tool/arg/eff | Agree |`);
  console.log(`|------|----------------------|----------------------|-------|`);

  let agreed = 0;
  for (const tc of cases) {
    const score = await judgeTrajectory({
      user_input: tc.user_input,
      captured_trajectory: tc.captured_trajectory,
      expected_trajectory: tc.expected_trajectory,
      response: tc.response,
    });
    const ok = caseAgrees(score, tc.human_score);
    if (ok) agreed += 1;
    const j = `${score.tool_correctness}/${score.argument_correctness}/${score.step_efficiency}`;
    const h = `${tc.human_score.tool_correctness}/${tc.human_score.argument_correctness}/${tc.human_score.step_efficiency}`;
    console.log(`| ${tc.name} | ${j} | ${h} | ${ok ? '✓' : '✗'} |`);
  }

  const rate = agreed / cases.length;
  console.log('');
  console.log(`**Agreement: ${agreed}/${cases.length} (${(rate * 100).toFixed(0)}%)**`);
  console.log('');
  if (rate >= 0.8) {
    console.log('Result: **PASS** — judge agrees with humans on ≥80% of cases. Keep using it as the eval gate.');
  } else {
    console.log('Result: **FAIL** — judge disagrees too often. Re-tune the judge prompt or swap the model before relying on its scores for CI gating.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('calibrate-judge crashed:', e);
  process.exit(1);
});
