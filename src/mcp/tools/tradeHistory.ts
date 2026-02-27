import * as engine from '../../core/engine';

export function executeTradeHistory(userId: string, limit?: number, type?: string): string {
  const trades = engine.getTradeHistory(userId, { limit: limit || 20, type });

  if (trades.length === 0) {
    return 'No trades found. Execute a deposit, swap, or arb to see trade history.';
  }

  const lines = [
    `Trade History (${trades.length} trades${type ? `, type: ${type}` : ''}):`,
    '',
  ];

  for (const t of trades) {
    const parts = [`${t.executed_at} | ${t.type.toUpperCase()} | ${t.protocol}`];

    if (t.from_token && t.from_amount) {
      parts.push(`${t.from_amount} ${t.from_token}`);
    }
    if (t.to_token && t.to_amount) {
      parts.push(`→ ${t.to_amount} ${t.to_token}`);
    }

    lines.push(parts.join(' | '));

    if (t.tx_hash && !t.tx_hash.startsWith('0xsim_')) {
      lines.push(`  Tx: https://testnet.bscscan.com/tx/${t.tx_hash}`);
    }
    if (t.position_id) {
      lines.push(`  Position: ${t.position_id}`);
    }
  }

  return lines.join('\n');
}
