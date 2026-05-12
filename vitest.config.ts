import { defineConfig } from 'vitest/config';

// Multiple test files share a single SQLite file (data/defai.db). Vitest's
// default thread pool runs files in parallel, which produces sporadic
// "database is locked" errors when migrations + inserts race. Force a
// single worker — tests stay fast enough and the DB stays consistent.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
    pool: 'forks',
    // poolOptions is runtime-supported but missing from the installed
    // vitest types — cast through to keep tsc happy.
    ...({ poolOptions: { forks: { singleFork: true } } } as any),
  },
});
