import cron from 'node-cron';
import { getVenusAPY } from '../data/venus';
import * as positionTracker from '../core/positionTracker';
import { broadcastAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Cron job: check Venus APY every 5 minutes.
 * If APY dropped significantly from a user's entry, alert via the dispatcher.
 */
export function startYieldWatcher(): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const current = await getVenusAPY();

      // Get all open positions on Venus
      const allPositions = positionTracker.getAllOpenPositions();
      const venusPositions = allPositions.filter(p => p.protocol === 'Venus');

      for (const pos of venusPositions) {
        if (pos.entry_apy && pos.entry_apy - current.apy >= 0.5) {
          const message = [
            `*APY Alert!*`,
            ``,
            `Venus APY dropped: ${pos.entry_apy.toFixed(2)}% → ${current.apy.toFixed(2)}%`,
            `Position: ${pos.amount} ${pos.token}`,
            ``,
            `Consider using \`yield_rotate\` to move to a higher-APY protocol.`,
          ].join('\n');

          await broadcastAlert('apy_drop', message);
        }
      }
    } catch (e: any) {
      logger.error('Yield watcher failed: %s', e.message);
    }
  });

  logger.info('Yield watcher started (every 5 minutes)');
}
