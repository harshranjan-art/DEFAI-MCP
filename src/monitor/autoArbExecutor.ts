import cron from 'node-cron';
import * as dbOps from '../core/db';
import { arbMachine, getArbSessionState, ArbCtx } from '../core/fsm/arbSession';
import { dispatch as dispatchAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Lifecycle monitor for auto-arb sessions.
 * Every 10 seconds: scan active sessions, fire `expired` or `loss_limit_hit`
 * events into the FSM. State transitions + DB writes happen atomically inside
 * arbMachine.send. Actual trade execution is handled by arbWatcher (event-
 * driven on opportunity detection).
 */
export function startAutoArbExecutor() {
  cron.schedule('*/10 * * * * *', async () => {
    const sessions = dbOps.getActiveAutoArbSessions();
    if (sessions.length === 0) return;

    for (const session of sessions) {
      const currentState = getArbSessionState(session);
      const ctx: ArbCtx = {
        sessionId: session.id,
        pnlUsd: session.total_pnl_usd,
        maxLossUsd: session.max_loss_usd,
        failureCount: session.failure_count || 0,
      };

      // 1. Expiry trumps everything — terminal STOPPED.
      const expires = new Date(session.expires_at);
      if (new Date() > expires) {
        const r = await arbMachine.send(session.id, currentState, 'expired', ctx);
        if (r.transitioned) {
          await dispatchAlert(
            session.user_id,
            'arb_opportunity',
            `Auto-arb session expired after ${session.trades_count} trades. ` +
              `Total P&L: $${session.total_pnl_usd.toFixed(4)}`,
          );
          logger.info({ sessionId: session.id, prev: currentState }, 'auto-arb session expired');
        }
        continue;
      }

      // 2. Loss limit — terminal FAILED.
      if (session.total_pnl_usd < -session.max_loss_usd) {
        const r = await arbMachine.send(session.id, currentState, 'loss_limit_hit', ctx);
        if (r.transitioned) {
          await dispatchAlert(
            session.user_id,
            'arb_opportunity',
            `Auto-arb STOPPED — loss limit ($${session.max_loss_usd}) hit. ` +
              `P&L: $${session.total_pnl_usd.toFixed(4)} after ${session.trades_count} trades.`,
          );
          logger.warn({ sessionId: session.id, prev: currentState }, 'auto-arb session loss-limit hit');
        }
      }
    }
  });

  logger.info('Auto-arb lifecycle monitor started (10s interval, FSM-driven)');
}
