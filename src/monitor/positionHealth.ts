import cron from 'node-cron';
import * as positionTracker from '../core/positionTracker';
import { getLatestFundingRate } from '../core/scanner/fundingRates';
import { broadcastAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Cron job: check delta-neutral position health every 5 minutes.
 * Alerts if funding rate flips negative (position losing money).
 */
export function startPositionHealthMonitor(): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const allPositions = positionTracker.getAllOpenPositions();
      const deltaPositions = allPositions.filter(p => p.type === 'delta_neutral');

      for (const pos of deltaPositions) {
        const meta = pos.metadata;
        const entryFunding = meta.fundingRate as number;

        const currentRate = await getLatestFundingRate(pos.token);
        if (!currentRate) continue;

        // Alert if funding rate flipped negative
        if (entryFunding > 0 && currentRate.fundingRate <= 0) {
          const message = [
            `*Position Health Alert!*`,
            ``,
            `Delta-neutral position ${pos.id}:`,
            `${pos.token} funding rate flipped negative!`,
            `  Entry: +${entryFunding.toFixed(4)}%`,
            `  Current: ${currentRate.fundingRate.toFixed(4)}%`,
            ``,
            `Consider closing this position — you are now paying funding instead of earning it.`,
            `Use \`delta_neutral_close\` to exit.`,
          ].join('\n');

          await broadcastAlert('position_health', message);
          logger.warn('Position health: funding flipped for %s (user %s)', pos.id, pos.user_id);
        }
      }
    } catch (e: any) {
      logger.error('Position health monitor failed: %s', e.message);
    }
  });

  logger.info('Position health monitor started (every 5 minutes)');
}
