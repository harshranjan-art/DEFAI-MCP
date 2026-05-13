/**
 * Postgres backend entry point (Phase 7C).
 *
 * During the Phase 7C staging window the default backend is still SQLite
 * via src/core/db.ts. This module ships the pg.Pool, schema, migrations,
 * and async query helpers; the caller migration to await these from every
 * existing sync call site is staged as a follow-up commit (see PR body).
 *
 * To take Postgres live locally:
 *   docker compose -f docker-compose.postgres.yml up -d
 *   POSTGRES_URL=postgres://defai:defai@localhost:5432/defai npm run dev
 *
 * To take Postgres live on Cloud Run (Phase 7E):
 *   CLOUD_SQL_CONNECTION_NAME=<project>:<region>:<instance>
 *   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE via Secret Manager
 */

export {
  getPostgresPool,
  query,
  withTransaction,
  resolvePostgresConfig,
  _resetPostgresPool,
} from './pool';
export type { PostgresConfig } from './pool';
