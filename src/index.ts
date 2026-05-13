import 'dotenv/config';

// Register error handlers as early as possible — before any other module loads —
// so unhandled rejections during startup are still captured.
import { registerSignalHandlers, onShutdown } from './utils/lifecycle';
registerSignalHandlers();

import { startBot, startBotWebhook } from './bot/index';
import { startYieldWatcher } from './monitor/yieldWatcher';
import { startArbWatcher } from './monitor/arbWatcher';
import { startSnapshotLogger } from './monitor/snapshotLogger';
import { startPositionHealthMonitor } from './monitor/positionHealth';
import { startAutoArbExecutor } from './monitor/autoArbExecutor';
import { startApiServer, app as apiApp } from './api/server';
import { mountMcpSseRoutes } from './mcp/server';
import * as userResolver from './core/userResolver';
import * as walletManager from './core/walletManager';
import { migrateLegacyEncryptedKeys } from './core/migrations/001_reencrypt_keys';
import { db } from './core/db';
import { getServerKey } from './wallet/encryption';
import { logger } from './utils/logger';

async function main() {
  // Fail fast on missing required env vars (instead of silently using a hardcoded fallback).
  // Throws with a helpful message if missing or too short.
  getServerKey();
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET env var is required and must be >= 32 chars. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  // Register DB close on shutdown so SQLite WAL is flushed cleanly.
  onShutdown(() => {
    try {
      db.close();
    } catch (e: any) {
      logger.error({ err: e?.message }, 'failed to close DB on shutdown');
    }
  });

  // One-shot migration: re-encrypt any legacy 3-part encrypted-key rows.
  // Idempotent. No-op once all rows are in the new format.
  try {
    migrateLegacyEncryptedKeys();
  } catch (e: any) {
    logger.error({ err: e?.message }, 'legacy-key migration failed; continuing startup');
  }

  // Ensure default user exists (backward compat with PRIVATE_KEY env)
  const defaultId = await userResolver.ensureDefaultUser();
  if (defaultId) {
    await walletManager.activate(defaultId);
    logger.info('Default user activated: %s', defaultId);
  }

  // Start Telegram bot. On Cloud Run we use webhook mode (scale-to-zero
  // kills long-polling); locally we default to polling.
  if (process.env.TELEGRAM_MODE === 'webhook') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      // Path embeds the token as a shared secret; Telegram only knows this URL.
      await startBotWebhook(apiApp, `/webhook/${token}`);
    } else {
      logger.warn('TELEGRAM_MODE=webhook but TELEGRAM_BOT_TOKEN unset');
    }
  } else {
    startBot();
  }

  // Start cron jobs
  startYieldWatcher();
  startArbWatcher();
  startSnapshotLogger();
  startPositionHealthMonitor();
  startAutoArbExecutor();

  // Mount MCP SSE routes on the API app (shares port 3002)
  mountMcpSseRoutes(apiApp);

  // Start REST API server (serves API + MCP SSE + dashboard on port 3002)
  startApiServer();

  logger.info('DeFAI — all systems running');
}

main().catch((e) => {
  logger.error({ err: e?.message }, 'startup failed');
  process.exit(1);
});
