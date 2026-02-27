import * as engine from '../../core/engine';

export function executeSetAlert(
  userId: string,
  alertType: string,
  active: boolean,
  threshold?: number,
): string {
  const result = engine.setAlert(userId, alertType, active, threshold);
  return result.message;
}

export function executeGetAlerts(userId: string): string {
  const alerts = engine.getAlerts(userId);

  if (alerts.length === 0) {
    return [
      `No alerts configured. Available alert types:`,
      `  apy_drop — alert when yield APY drops significantly`,
      `  arb_opportunity — alert when profitable arbitrage found`,
      `  position_health — alert when delta-neutral funding rate flips`,
      ``,
      `Use set_alerts to enable them.`,
    ].join('\n');
  }

  const lines = [`Active Alerts:`, ''];
  for (const a of alerts) {
    const status = a.active ? 'ON' : 'OFF';
    const threshold = a.threshold ? ` (threshold: ${a.threshold})` : '';
    const lastTriggered = a.last_triggered_at ? ` — last: ${a.last_triggered_at}` : '';
    lines.push(`  [${status}] ${a.type}${threshold}${lastTriggered}`);
  }

  return lines.join('\n');
}
