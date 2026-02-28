import cron from 'node-cron';
import * as dbOps from '../core/db';
import * as arbScanner from '../core/strategy/arbScanner';
import { broadcastAlert, dispatch as dispatchAlert } from './alertDispatcher';
import { logger } from '../utils/logger';

/**
 * Cron job: scan for arbitrage opportunities every 30 seconds.
 *
 * Two behaviours per tick:
 * 1. EXECUTE — for every user with an active arb session, immediately execute
 *    all viable opportunities found in this scan (event-driven execution).
 * 2. ALERT  — broadcast a passive notification to users who have arb alerts
 *    configured but no active session (rate-limited to once per 2 minutes).
 */

let lastBroadcastAt = 0; // timestamp ms — throttle passive alerts to 2 min
const BROADCAST_INTERVAL_MS = 2 * 60 * 1000;

export function startArbWatcher(): void {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const opps = await arbScanner.scan('BNB', 'USDT', '1');
      const viable = opps.filter(o => o.viable);

      if (viable.length === 0) return;

      // ── 1. Execute immediately for all active sessions ───────────────────
      const sessions = dbOps.getActiveAutoArbSessions();

      for (const session of sessions) {
        const now = new Date();
        const expires = new Date(session.expires_at);

        // Skip expired or loss-limited sessions (executor cron will clean these up)
        if (now > expires || session.total_pnl_usd < -session.max_loss_usd) continue;

        const sessionViable = viable.filter(o => o.spreadBps > session.max_slippage_bps);
        if (sessionViable.length === 0) continue;

        for (const opp of sessionViable) {
          try {
            const result = await arbScanner.execute(session.user_id, opp.id, session.max_slippage_bps);

            if (result.success && result.profitUsd !== undefined) {
              const newPnl = session.total_pnl_usd + result.profitUsd;
              const newCount = session.trades_count + 1;

              dbOps.updateAutoArbSession(session.id, {
                total_pnl_usd: newPnl,
                trades_count: newCount,
              });
              session.total_pnl_usd = newPnl;
              session.trades_count = newCount;

              logger.info(
                'Watcher-triggered arb trade #%d for session %s: profit $%s',
                newCount, session.id, result.profitUsd.toFixed(4),
              );

              const timeLeftMin = Math.max(0, Math.round((expires.getTime() - Date.now()) / 60000));
              await dispatchAlert(
                session.user_id,
                'arb_opportunity',
                `Auto-arb Trade #${newCount} executed\n\n${result.message}\n\nCumulative P&L: $${newPnl >= 0 ? '+' : ''}${newPnl.toFixed(4)} | Time left: ${timeLeftMin}m`,
              );

              // Stop session mid-cycle if loss limit crossed
              if (newPnl < -session.max_loss_usd) {
                dbOps.updateAutoArbSession(session.id, { status: 'stopped' });
                await dispatchAlert(
                  session.user_id,
                  'arb_opportunity',
                  `Auto-arb STOPPED — loss limit hit. P&L: $${newPnl.toFixed(4)}`,
                );
                break;
              }
            }
          } catch (e: any) {
            logger.error('Watcher execute error (session %s): %s', session.id, e.message);
          }
        }
      }

      // ── 2. Broadcast passive alert (throttled to once per 2 min) ─────────
      const now = Date.now();
      if (now - lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
        const best = viable[0];
        const message = [
          `Arbitrage Alert!`,
          ``,
          `${best.token}: ${best.buyDex} -> ${best.sellDex}`,
          `Spread: ${best.spreadBps} bps (${(best.spreadBps / 100).toFixed(2)}%)`,
          `Est. profit: $${best.estimatedProfitUsd.toFixed(4)} per unit`,
          ``,
          `Use arb_execute to act on this opportunity.`,
        ].join('\n');

        await broadcastAlert('arb_opportunity', message);
        lastBroadcastAt = now;
      }
    } catch (e: any) {
      logger.error('Arb watcher failed: %s', e.message);
    }
  });

  logger.info('Arb watcher started (30s scan, execute on detection, 2min passive alerts)');
}
