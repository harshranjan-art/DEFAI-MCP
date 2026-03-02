import 'dotenv/config';
import { startBot } from './bot/index';
import { startYieldWatcher } from './monitor/yieldWatcher';
import { startArbWatcher } from './monitor/arbWatcher';
import { startSnapshotLogger } from './monitor/snapshotLogger';
import { startPositionHealthMonitor } from './monitor/positionHealth';
import { startAutoArbExecutor } from './monitor/autoArbExecutor';
import { startApiServer, app as apiApp } from './api/server';
import { mountMcpSseRoutes } from './mcp/server';
import * as userResolver from './core/userResolver';
import * as walletManager from './core/walletManager';
import { logger } from './utils/logger';

async function main() {
  // Ensure default user exists (backward compat with PRIVATE_KEY env)
  const defaultId = await userResolver.ensureDefaultUser();
  if (defaultId) {
    await walletManager.activate(defaultId);
    logger.info('Default user activated: %s', defaultId);
  }

  // Start Telegram bot
  startBot();

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
  logger.error('Startup failed: %s', e.message);
  process.exit(1);
});
