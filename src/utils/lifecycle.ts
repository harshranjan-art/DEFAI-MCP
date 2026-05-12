import { logger } from './logger';

type ShutdownHandler = () => Promise<void> | void;

const handlers: ShutdownHandler[] = [];
let signalsRegistered = false;
let shuttingDown = false;

const SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Register a function to run on graceful shutdown.
 * Handlers run in the order they were registered. Each is awaited.
 */
export function onShutdown(fn: ShutdownHandler): void {
  handlers.push(fn);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown signal received, draining...');

  const timeout = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  for (const fn of handlers) {
    try {
      await fn();
    } catch (e: any) {
      logger.error({ err: e?.message }, 'shutdown handler threw');
    }
  }

  clearTimeout(timeout);
  logger.info('shutdown complete');
  process.exit(0);
}

/**
 * Install SIGTERM / SIGINT handlers + global unhandled-error handlers.
 * Idempotent — safe to call from tests / re-imports.
 */
export function registerSignalHandlers(): void {
  if (signalsRegistered) return;
  signalsRegistered = true;

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // Localized failure: log loudly, keep running. Other users / crons should not be affected.
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ reason }, 'unhandledRejection — investigate immediately');
  });

  // Shared state may now be inconsistent. Flush logs, then exit; supervisor restarts.
  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException — process will exit in 1s');
    setTimeout(() => process.exit(1), 1000).unref();
  });

  process.on('warning', (warning: Error) => {
    logger.warn({ warning: warning.message }, 'process.warning');
  });
}
