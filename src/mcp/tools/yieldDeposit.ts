import * as engine from '../../core/engine';
import type { DepositResult } from '../../core/strategy/types';

export function formatDepositResult(result: DepositResult): string {
  if (!result.success) {
    return `Deposit failed: ${result.message}`;
  }

  const lines = [
    `Deposit successful!`,
    ``,
    `Protocol: ${result.protocol}`,
    `Amount: ${result.amount} ${result.token}`,
    `APY: ${result.apy.toFixed(2)}%`,
    `Position ID: ${result.positionId}`,
    `Tx: ${result.txHash}`,
  ];

  if (result.txHash && !result.txHash.startsWith('0xsim_')) {
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
