import cron from 'node-cron';
import { scan } from '../core/strategy/arbScanner';
import { broadcastAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Cron job: scan for arbitrage opportunities every 2 minutes.
 * If viable opportunities found, alert users who have arb_opportunity alerts configured.
 */
export function startArbWatcher(): void {
  cron.schedule('*/2 * * * *', async () => {
    try {
      const opps = await scan('BNB', 'USDT', '1');
      const viable = opps.filter(o => o.viable);

      if (viable.length > 0) {
        const best = viable[0];
        const message = [
          `*Arbitrage Alert!*`,
          ``,
          `${best.token}: ${best.buyDex} → ${best.sellDex}`,
          `Spread: ${best.spreadBps} bps (${(best.spreadBps / 100).toFixed(2)}%)`,
          `Est. profit: $${best.estimatedProfitUsd.toFixed(4)} per unit`,
          ``,
          `Use \`arb_execute\` to act on this opportunity.`,
        ].join('\n');

        await broadcastAlert('arb_opportunity', message);
      }
    } catch (e: any) {
      logger.error('Arb watcher failed: %s', e.message);
    }
  });

  logger.info('Arb watcher started (every 2 minutes)');
}
