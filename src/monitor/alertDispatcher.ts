import { v4 as uuid } from 'uuid';
import * as dbOps from '../core/db';
import { logger } from '../utils/logger';

// Telegram bot reference — set during bot initialization
let botRef: any = null;

export function setBotRef(bot: any): void {
  botRef = bot;
}

/**
 * Dispatch an alert to a user.
 * 1. Check if user has an active alert config for this type
 * 2. If user has telegram_id → send via Telegram
 * 3. Otherwise → store as unread notification (dashboard polls /api/alerts/unread)
 * 4. Update last_triggered_at on the alert
 */
export async function dispatch(
  userId: string,
  alertType: string,
  message: string,
): Promise<void> {
  const user = dbOps.getUser(userId);
  if (!user) {
    logger.warn('Alert dispatch: user %s not found', userId);
    return;
  }

  // Check if user has an active alert for this type
  const alerts = dbOps.getAlerts(userId);
  const matching = alerts.find((a: any) => a.type === alertType && a.active);

  // Send via Telegram if linked
  if (user.telegram_id && botRef) {
    try {
      await botRef.telegram.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' });
      logger.info('Alert sent via Telegram to user %s (telegram_id: %d)', userId, user.telegram_id);
    } catch (e: any) {
      logger.error('Telegram alert failed for user %s: %s', userId, e.message);
    }
  }

  // Always store as notification (for dashboard)
  dbOps.insertNotification({
    id: `ntf_${uuid().slice(0, 8)}`,
    user_id: userId,
    alert_type: alertType,
    message,
  });

  // Update last_triggered_at if there was a matching alert config
  if (matching) {
    dbOps.updateAlertTriggered(matching.id);
  }

  logger.info('Alert dispatched: type=%s, user=%s, telegram=%s',
    alertType, userId, user.telegram_id ? 'yes' : 'no');
}

/**
 * Dispatch an alert to ALL users who have this alert type configured.
 * Used by watchers that broadcast (e.g., arb opportunities).
 */
export async function broadcastAlert(
  alertType: string,
  message: string,
): Promise<void> {
  // Get all users with active alerts of this type
  const rows = dbOps.db.prepare(
    'SELECT DISTINCT u.id FROM users u JOIN alerts a ON u.id = a.user_id WHERE a.type = ? AND a.active = 1'
  ).all(alertType) as any[];

  for (const row of rows) {
    await dispatch(row.id, alertType, message);
  }

  if (rows.length > 0) {
    logger.info('Broadcast alert: type=%s, sent to %d users', alertType, rows.length);
  }
}
