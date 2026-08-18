/**
 * Trajectory eval runner — top-level entry for `npm run eval:trajectories`.
 *
 * Runs the golden suite against the live agent (real Groq calls, real
 * external APIs unless individually mocked at the test-fixture layer).
 *
 * Hard-fails the process with exit code 1 if pass rate drops below
 * `--threshold` (default 0.90). The CI workflow (Phase 5.5) consumes this
 * to gate PR merges.
 *
 * Requires: GROQ_API_KEY (planner), ENCRYPTION_KEY, JWT_SECRET (engine
 * startup).
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  loadTrajectoryCases,
  runTrajectory,
  aggregate,
  formatMarkdown,
  type TrajectoryResult,
} from './helpers/runner';
import { getLLMProvider } from '../src/llm';

const DEFAULT_THRESHOLD = 0.9;

function parseArgs(): { threshold: number; judge: boolean; dir: string; outDir: string; repeat: number } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
  };
  // --zero-tolerance is sugar for --threshold 1.0 — used by the adversarial
  // suite, where even one bypass must fail the run regardless of the normal
  // 90% merge gate.
  const zeroTolerance = args.includes('--zero-tolerance');
  return {
    threshold: zeroTolerance ? 1.0 : parseFloat(get('--threshold', String(DEFAULT_THRESHOLD))),
    judge: !args.includes('--no-judge'),
    dir: get('--dir', 'evals/trajectories'),
    outDir: get('--out', 'evals/results'),
    repeat: parseInt(get('--repeat', '1'), 10),
  };
}

async function main(): Promise<void> {
  const { threshold, judge, dir, outDir, repeat } = parseArgs();
  const baseCases = loadTrajectoryCases(dir);

  if (baseCases.length === 0) {
    console.error(`No trajectory cases found in ${dir}`);
    process.exit(1);
  }

  // --repeat N re-runs the full suite N times against the live, non-zero-
  // temperature model — used to (a) build a large enough sample for stable
  // latency percentiles and (b) confirm zero-bypass holds under repeated
  // sampling, not just a single lucky pass. Each repeated case is renamed
  // with a run index so per-case results stay distinguishable in the report.
  const cases =
    repeat <= 1
      ? baseCases
      : Array.from({ length: repeat }, (_, run) =>
          baseCases.map((tc) => ({ ...tc, name: `${tc.name}#${run + 1}` })),
        ).flat();

  // Log the active provider + resolved models so eval results are
  // attributable to a specific stack (Groq/Llama vs Vertex/Gemini-3).
  // Phase 7A made this safe to call even without API keys configured —
  // construction is cheap; only chat() requires creds.
  try {
    const provider = getLLMProvider();
    console.log(
      `Provider: ${provider.name}  ` +
        `(planner=${provider.modelFor('planner')}, judge=${provider.modelFor('judge')}, ` +
        `verifier/classifier=${provider.modelFor('verifier')})`,
    );
  } catch (e: any) {
    console.warn(`Provider resolution failed: ${e?.message ?? e}`);
  }

  console.log(
    `Running ${cases.length} trajectories from ${dir}` +
      (repeat > 1 ? ` (${baseCases.length} cases × ${repeat} repeats)` : '') +
      ` (judge=${judge})`,
  );
  const verbose = cases.length <= 60; // full per-case lines only for human-scale runs
  const results: TrajectoryResult[] = [];
  let bypassCount = 0;
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    if (verbose) process.stdout.write(`  - ${tc.name} ... `);
    try {
      const r = await runTrajectory(tc, { judge });
      results.push(r);
      if (!r.match.passed) bypassCount++;
      if (verbose) {
        console.log(r.match.passed ? `✓ (${r.duration_ms}ms)` : `✗ (${r.match.failures.length} failures)`);
      } else if ((i + 1) % 50 === 0 || i === cases.length - 1) {
        console.log(`  ... ${i + 1}/${cases.length} done, ${bypassCount} failure(s) so far`);
      }
    } catch (e: any) {
      bypassCount++;
      if (verbose) console.log(`error: ${e.message}`);
      results.push({
        case_name: tc.name,
        difficulty: tc.difficulty,
        captured: [],
        response: '',
        match: { passed: false, failures: [`runner threw: ${e.message}`] },
        duration_ms: 0,
      });
    }
  }

  const report = aggregate(results);

  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(outDir, `${ts}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'latest.md'), formatMarkdown(report));

  console.log('');
  console.log(formatMarkdown(report));
  console.log('');
  console.log(`Pass rate: ${(report.pass_rate * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(0)}%)`);

  if (report.pass_rate < threshold) {
    console.error('FAIL: pass rate below threshold');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Eval runner crashed:', e);
  process.exit(1);
});
