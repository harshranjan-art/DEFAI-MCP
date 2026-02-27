import * as engine from '../../core/engine';
import type { DepositResult } from '../../core/strategy/types';

export function formatDepositResult(result: DepositResult): string {
  if (!result.success) {
    return `Deposit failed: ${result.message}`;
  }

  const isSimulated = !result.txHash || result.txHash.startsWith('0xsim_');
  const executionBadge = isSimulated
    ? `⚠️ SIMULATED — ${result.protocol} has no BSC Testnet contracts`
    : `✅ ON-CHAIN — real transaction on BSC Testnet`;

  const lines = [
    `Deposit successful! [${executionBadge}]`,
    ``,
    `Protocol: ${result.protocol}`,
    `Amount: ${result.amount} ${result.token}`,
    `APY: ${result.apy.toFixed(2)}%`,
    `Position ID: ${result.positionId}`,
  ];

  if (isSimulated) {
    lines.push(`Tx: SIMULATED — no real on-chain transaction. Use Venus to get a real BSCScan link.`);
  } else {
    lines.push(`Tx: ${result.txHash}`);
    lines.push(`BSCScan: https://testnet.bscscan.com/tx/${result.txHash}`);
  }

  if (result.alternatives.length > 0) {
    lines.push('', 'Other options considered:');
    for (const alt of result.alternatives) {
      const sim = alt.isSimulated ? ' (simulated)' : '';
      lines.push(`  - ${alt.protocol}: ${alt.apy.toFixed(2)}% APY${sim}`);
    }
  }

  return lines.join('\n');
}

export async function executeYieldDeposit(
  userId: string,
  token: string,
  amount: string,
  protocol?: string,
): Promise<string> {
  const result = await engine.yieldDeposit(userId, token, amount, protocol);
  return formatDepositResult(result);
}
