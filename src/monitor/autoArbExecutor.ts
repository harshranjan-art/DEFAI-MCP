import cron from 'node-cron';
import * as dbOps from '../core/db';
import { dispatch as dispatchAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Lifecycle monitor for auto-arb sessions.
 * Checks every 10 seconds for expired or loss-limited sessions and stops them.
 * Actual trade execution is handled by arbWatcher (event-driven on opportunity detection).
 */
export function startAutoArbExecutor() {
  cron.schedule('*/10 * * * * *', async () => {
    const sessions = dbOps.getActiveAutoArbSessions();
    if (sessions.length === 0) return;

    for (const session of sessions) {
      const now = new Date();
      const expires = new Date(session.expires_at);

      // Check expiry
      if (now > expires) {
        dbOps.updateAutoArbSession(session.id, { status: 'stopped' });
        await dispatchAlert(
          session.user_id,
          'arb_opportunity',
          `Auto-arb session expired after ${session.trades_count} trades. ` +
          `Total P&L: $${session.total_pnl_usd.toFixed(4)}`,
        );
        logger.info('Auto-arb session %s expired', session.id);
        continue;
      }

      // Check loss limit
      if (session.total_pnl_usd < -session.max_loss_usd) {
        dbOps.updateAutoArbSession(session.id, { status: 'stopped' });
        await dispatchAlert(
          session.user_id,
          'arb_opportunity',
          `Auto-arb STOPPED — loss limit ($${session.max_loss_usd}) hit. ` +
          `P&L: $${session.total_pnl_usd.toFixed(4)} after ${session.trades_count} trades.`,
        );
        logger.warn('Auto-arb session %s stopped: loss limit reached', session.id);
      }
    }
  });

  logger.info('Auto-arb lifecycle monitor started (10s interval)');
}
