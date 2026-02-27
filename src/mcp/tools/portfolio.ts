import * as engine from '../../core/engine';

export function executePortfolio(userId: string): string {
  const portfolio = engine.getPortfolio(userId);

  if (portfolio.positions.length === 0) {
    return [
      `Portfolio — ${portfolio.smartAccountAddress || 'No smart account'}`,
      ``,
      `No active positions.`,
      `Use yield_deposit to start earning yield on your tokens.`,
      portfolio.smartAccountAddress
        ? `BSCScan: https://testnet.bscscan.com/address/${portfolio.smartAccountAddress}`
        : '',
    ].filter(Boolean).join('\n');
  }

  const lines = [
    `Portfolio Summary`,
    `Smart Account: ${portfolio.smartAccountAddress}`,
    `Total Value: $${portfolio.totalValueUsd.toFixed(2)}`,
    `Yield Earned: $${portfolio.yieldEarned.toFixed(2)}`,
    `Arb Profits: $${portfolio.arbProfits.toFixed(2)}`,
    ``,
    `Active Positions (${portfolio.positions.length}):`,
  ];

  for (const p of portfolio.positions) {
    const sim = p.metadata?.isSimulated ? ' [simulated]' : '';
    lines.push(`  ${p.id}: ${p.amount} ${p.token} on ${p.protocol} (${p.entry_apy?.toFixed(2) || '?'}% APY)${sim}`);
    if (p.tx_hash && !p.tx_hash.startsWith('0xsim_')) {
      lines.push(`    Tx: https://testnet.bscscan.com/tx/${p.tx_hash}`);
    }
    lines.push(`    Opened: ${p.opened_at}`);
  }

  lines.push(``, `BSCScan: https://testnet.bscscan.com/address/${portfolio.smartAccountAddress}`);

  return lines.join('\n');
}
