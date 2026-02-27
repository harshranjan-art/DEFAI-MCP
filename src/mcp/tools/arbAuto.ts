import * as dbOps from '../../core/db';
import { v4 as uuid } from 'uuid';

export function executeArbAutoStart(
  userId: string,
  durationHours: number,
  maxLossUsd: number,
  maxSlippageBps: number = 50,
): string {
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  const sessionId = uuid();

  dbOps.insertAutoArbSession({
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt.toISOString(),
    max_loss_usd: maxLossUsd,
    max_slippage_bps: maxSlippageBps,
  });

  return [
    `Auto-arb session started!`,
    ``,
    `Session ID: ${sessionId}`,
    `Duration: ${durationHours}h (expires ${expiresAt.toLocaleTimeString()})`,
    `Max loss limit: $${maxLossUsd}`,
    `Slippage tolerance: ${maxSlippageBps} bps`,
    ``,
    `The executor scans every 30 seconds and trades all viable opportunities.`,
    `It stops automatically when: time expires OR cumulative loss exceeds $${maxLossUsd}.`,
    `All trades are logged — check trade_history to review.`,
    `Use arb_auto_status to check progress, arb_auto_stop to cancel early.`,
  ].join('\n');
}

export function executeArbAutoStop(userId: string): string {
  const session = dbOps.getAutoArbSession(userId);
  if (!session || session.status !== 'active') {
    return 'No active auto-arb session found.';
  }

  dbOps.stopAutoArbSession(userId);

  return [
    `Auto-arb session stopped.`,
    ``,
    `Trades executed: ${session.trades_count}`,
    `Total P&L: $${session.total_pnl_usd.toFixed(4)}`,
    `Started: ${session.started_at}`,
    `Stopped: ${new Date().toISOString()}`,
  ].join('\n');
}

export function executeArbAutoStatus(userId: string): string {
  const session = dbOps.getAutoArbSession(userId);
  if (!session) {
    return 'No auto-arb sessions found. Use arb_auto_start to begin.';
  }

  const expires = new Date(session.expires_at);
  const now = new Date();
  const remaining = Math.max(0, (expires.getTime() - now.getTime()) / 1000 / 60);

  const statusEmoji = session.status === 'active' ? '🟢' : session.status === 'expired' ? '⏱️' : '🔴';

  return [
    `Auto-arb Session Status`,
    ``,
    `Status: ${statusEmoji} ${session.status.toUpperCase()}`,
    `Session ID: ${session.id}`,
    `Started: ${session.started_at}`,
    `Expires: ${session.expires_at}`,
    session.status === 'active' ? `Time remaining: ${remaining.toFixed(0)} minutes` : '',
    ``,
    `Trades executed: ${session.trades_count}`,
    `Total P&L: $${Number(session.total_pnl_usd).toFixed(4)}`,
    `Loss limit: $${session.max_loss_usd}`,
    `Slippage tolerance: ${session.max_slippage_bps} bps`,
  ].filter(l => l !== '').join('\n');
}
