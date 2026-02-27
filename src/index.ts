import 'dotenv/config';
import { startBot } from './bot/index';
import { startYieldWatcher } from './monitor/yieldWatcher';
import { startArbWatcher } from './monitor/arbWatcher';
import { startSnapshotLogger } from './monitor/snapshotLogger';
import { startPositionHealthMonitor } from './monitor/positionHealth';
import { startApiServer } from './api/server';
import * as userResolver from './core/userResolver';
import * as walletManager from './core/walletManager';
import { logger } from './utils/logger';

async function main() {
  // Ensure default user exists (backward compat with PRIVATE_KEY env)
  const defaultId = await userResolver.ensureDefaultUser();
  if (defaultId) {
    await walletManager.activate(defaultId, 'defai-dev-default');
    logger.info('Default user activated: %s', defaultId);
  }

  // Start Telegram bot
  startBot();

  // Start cron jobs
  startYieldWatcher();
  startArbWatcher();
  startSnapshotLogger();
  startPositionHealthMonitor();

  // Start REST API server
  startApiServer();

  logger.info('DeFAI — all systems running');
}

main().catch((e) => {
  logger.error('Startup failed: %s', e.message);
  process.exit(1);
});
