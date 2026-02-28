import cron from 'node-cron';
import * as dbOps from '../core/db';
import * as arbScanner from '../core/strategy/arbScanner';
import { dispatch as dispatchAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

let running = false; // prevent overlapping executions

export function startAutoArbExecutor() {
  // Every 30 seconds — ASAP execution for active sessions
  cron.schedule('*/30 * * * * *', async () => {
    if (running) return; // skip if previous run still in progress
    running = true;

    try {
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
          continue;
        }

        // Scan and execute all viable opportunities in this cycle
        try {
          const opps = await arbScanner.scan();
          const viable = opps.filter(o => o.spreadBps > session.max_slippage_bps);

          if (viable.length === 0) continue;

          for (const opp of viable) {
            const result = await arbScanner.execute(
              session.user_id,
              opp.id,
              session.max_slippage_bps,
            );

            if (result.success && result.profitUsd !== undefined) {
              const newPnl = session.total_pnl_usd + result.profitUsd;
              const newCount = session.trades_count + 1;
              dbOps.updateAutoArbSession(session.id, {
                total_pnl_usd: newPnl,
                trades_count: newCount,
              });
              // Update local copy for the loss check on next opp in same cycle
              session.total_pnl_usd = newPnl;
              session.trades_count = newCount;

              logger.info(
                'Auto-arb trade #%d for session %s: profit $%s | cumulative P&L $%s',
                newCount, session.id, result.profitUsd.toFixed(4), newPnl.toFixed(4),
              );

              // Notify user of each executed trade
              const timeLeftMin = Math.max(0, Math.round((expires.getTime() - Date.now()) / 60000));
              await dispatchAlert(
                session.user_id,
                'arb_opportunity',
                `Auto-arb Trade #${newCount} executed\n\n${result.message}\n\nCumulative P&L: $${newPnl >= 0 ? '+' : ''}${newPnl.toFixed(4)} | Time left: ${timeLeftMin}m`,
              );

              // Stop if loss limit crossed mid-cycle
              if (newPnl < -session.max_loss_usd) {
                dbOps.updateAutoArbSession(session.id, { status: 'stopped' });
                await dispatchAlert(
                  session.user_id,
                  'arb_opportunity',
                  `Auto-arb STOPPED mid-cycle — loss limit hit. P&L: $${newPnl.toFixed(4)}`,
                );
                break;
              }
            }
          }
        } catch (e: any) {
          logger.error('Auto-arb execution error for session %s: %s', session.id, e.message);
        }
      }
    } finally {
      running = false;
    }
  });

  logger.info('Auto-arb executor started (30s interval)');
}
