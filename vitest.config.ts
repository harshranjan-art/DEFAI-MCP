import { defineConfig } from 'vitest/config';

// Multiple test files share a single SQLite file (data/defai.db). Vitest's
// default pool runs files in parallel, which produces sporadic "database is
// locked" errors when migrations + inserts race. Disable parallel test-file
// execution — tests stay fast enough and the DB stays consistent.
//
// Vitest 4 removed `poolOptions`; the replacement that actually serializes
// file execution is the top-level `fileParallelism: false`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
    pool: 'forks',
    fileParallelism: false,
  },
});
