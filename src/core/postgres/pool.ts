/**
 * Postgres connection pool + migration runner.
 *
 * This module owns the lifecycle of a pg.Pool. It loads schema.sql once on
 * boot, then applies versioned migrations (migrations.sql blocks) idempotently
 * using a `schema_migrations` table — the Postgres equivalent of SQLite's
 * `PRAGMA user_version`.
 *
 * Connection sources (in priority order):
 *   1. CLOUD_SQL_CONNECTION_NAME (e.g. "project:region:instance") — wired
 *      to the local Cloud SQL Auth Proxy unix socket at
 *      `/cloudsql/<connection_name>/.s.PGSQL.5432`. Cloud Run sidecar
 *      provides this automatically when the proxy is attached.
 *   2. POSTGRES_URL — full libpq connection string.
 *   3. POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER / POSTGRES_PASSWORD /
 *      POSTGRES_DATABASE — discrete env vars for local docker-compose dev.
 *
 * If none of the above is set, this module is a no-op (no pool is created).
 * That keeps the SQLite-default test path green during Phase 7C while the
 * caller migration (sync → async) is staged in a follow-up commit.
 *
 * Phase 7C scope:
 *   - Provide the adapter + schema + migrations + lifecycle.
 *   - Wire the pool into onShutdown so it closes cleanly under SIGTERM
 *     (matters for Cloud Run; the platform sends SIGTERM before evicting
 *     an instance).
 *
 * Phase 7C.1 (follow-up):
 *   - Migrate 31 sync `db.prepare(...).run()` call sites to await this
 *     adapter. Each call gets its SQL `?` → `$N` rewritten.
 */

import { Pool, type PoolConfig, type QueryResultRow, type QueryResult } from 'pg';
import { logger } from '../../utils/logger';
import { onShutdown } from '../../utils/lifecycle';
import { POSTGRES_SCHEMA_SQL, POSTGRES_MIGRATIONS_SQL, POSTGRES_TARGET_VERSION } from './schema';

let cachedPool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export interface PostgresConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** Unix socket dir for Cloud SQL Auth Proxy. Set when CLOUD_SQL_CONNECTION_NAME is present. */
  socketDir?: string;
  /** Max pool size (default 10 — Cloud Run instances are small). */
  max?: number;
}

/**
 * Resolve env vars into a pg config. Returns null when no source is
 * configured (callers should keep using SQLite in that case).
 */
export function resolvePostgresConfig(): PostgresConfig | null {
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    return {
      socketDir: `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      max: Number(process.env.POSTGRES_MAX_POOL) || 10,
    };
  }
  if (process.env.POSTGRES_URL) {
    return {
      connectionString: process.env.POSTGRES_URL,
      max: Number(process.env.POSTGRES_MAX_POOL) || 10,
    };
  }
  if (process.env.POSTGRES_HOST) {
    return {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT) || 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      max: Number(process.env.POSTGRES_MAX_POOL) || 10,
    };
  }
  return null;
}

function toPoolConfig(cfg: PostgresConfig): PoolConfig {
  if (cfg.socketDir) {
    return {
      host: cfg.socketDir,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      max: cfg.max,
    };
  }
  if (cfg.connectionString) {
    return { connectionString: cfg.connectionString, max: cfg.max };
  }
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: cfg.max,
  };
}

/**
 * Lazy singleton — first access triggers schema + migrations. Subsequent
 * calls return the cached pool synchronously after init completes.
 *
 * Returns null when no Postgres config is present in the environment
 * (callers fall back to SQLite during the Phase 7C staging).
 */
export async function getPostgresPool(): Promise<Pool | null> {
  if (cachedPool) return cachedPool;
  const cfg = resolvePostgresConfig();
  if (!cfg) return null;

  if (initPromise) {
    await initPromise;
    return cachedPool;
  }

  const pool = new Pool(toPoolConfig(cfg));
  pool.on('error', (err) => {
    logger.error({ err: err.message }, 'pg.Pool emitted error');
  });
  cachedPool = pool;

  initPromise = (async () => {
    await applySchema(pool);
    await applyMigrations(pool);
  })();
  try {
    await initPromise;
  } catch (e) {
    // If init fails, drop the cached pool so callers can retry after the
    // operator fixes connectivity. Otherwise we'd serve a half-migrated DB.
    cachedPool = null;
    initPromise = null;
    throw e;
  }

  onShutdown(async () => {
    if (!cachedPool) return;
    logger.info('Closing pg.Pool');
    try {
      await cachedPool.end();
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'pg.Pool.end() threw on shutdown');
    } finally {
      cachedPool = null;
    }
  });

  logger.info('Postgres pool initialized');
  return pool;
}

async function applySchema(pool: Pool): Promise<void> {
  await pool.query(POSTGRES_SCHEMA_SQL);
  logger.info('[pg] schema applied');
}

/**
 * Bundled migrations 002+003+004+005+008+009. Applied atomically once per
 * database, tracked via schema_migrations(version). For Phase 7C we ship
 * the bundle keyed to version 9 (the highest existing SQLite migration);
 * a future commit can split this back into one-file-per-version once
 * Postgres is the only backend.
 */
async function applyMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [POSTGRES_TARGET_VERSION],
    );
    if (result.rowCount && result.rowCount > 0) {
      await client.query('COMMIT');
      return; // Already applied.
    }
    await client.query(POSTGRES_MIGRATIONS_SQL);
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
      [POSTGRES_TARGET_VERSION],
    );
    await client.query('COMMIT');
    logger.info({ version: POSTGRES_TARGET_VERSION }, '[pg] migrations applied');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Run a single query. Thin wrapper around pool.query so callers don't have
 * to import `pg` types directly.
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<R>> {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error(
      'No Postgres pool configured — set CLOUD_SQL_CONNECTION_NAME, ' +
        'POSTGRES_URL, or POSTGRES_HOST. (During Phase 7C staging, ' +
        'most code paths still use SQLite via src/core/db.ts.)',
    );
  }
  return pool.query<R>(sql, params as never);
}

/**
 * Convenience: run a callback inside a transaction with a dedicated client.
 * Use this when multiple statements must be atomic (FSM transitions,
 * idempotency check + insert, etc.). pg does not support the
 * `db.transaction(fn)()` shortcut better-sqlite3 provides — every
 * transaction needs explicit BEGIN/COMMIT.
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await getPostgresPool();
  if (!pool) {
    throw new Error('No Postgres pool configured — see getPostgresPool().');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Test-only: drop the cached pool. Used by unit tests that swap config
 * between describe blocks. Production code should never call this.
 */
export function _resetPostgresPool(): void {
  if (cachedPool) {
    cachedPool.end().catch(() => {});
  }
  cachedPool = null;
  initPromise = null;
}
