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

const DEFAULT_THRESHOLD = 0.9;

function parseArgs(): { threshold: number; judge: boolean; dir: string; outDir: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
  };
  return {
    threshold: parseFloat(get('--threshold', String(DEFAULT_THRESHOLD))),
    judge: !args.includes('--no-judge'),
    dir: get('--dir', 'evals/trajectories'),
    outDir: get('--out', 'evals/results'),
  };
}

async function main(): Promise<void> {
  const { threshold, judge, dir, outDir } = parseArgs();
  const cases = loadTrajectoryCases(dir);

  if (cases.length === 0) {
    console.error(`No trajectory cases found in ${dir}`);
    process.exit(1);
  }

  console.log(`Running ${cases.length} trajectories from ${dir} (judge=${judge})`);
  const results: TrajectoryResult[] = [];
  for (const tc of cases) {
    process.stdout.write(`  - ${tc.name} ... `);
    try {
      const r = await runTrajectory(tc, { judge });
      results.push(r);
      console.log(r.match.passed ? `✓ (${r.duration_ms}ms)` : `✗ (${r.match.failures.length} failures)`);
    } catch (e: any) {
      console.log(`error: ${e.message}`);
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
