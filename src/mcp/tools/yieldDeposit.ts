import * as engine from '../../core/engine';
import { formatEngineResult } from '../../core/format';
import type { DepositResult } from '../../core/strategy/types';

/**
 * Legacy formatter for callers still on the old DepositResult shape (yieldRotate).
 * Phase 1's refactored yield_deposit goes through formatEngineResult; this helper
 * stays around until yield_rotate is refactored too.
 */
export function formatDepositResult(result: DepositResult): string {
  if (!result.success) {
    return `Deposit failed: ${result.message}`;
  }
  const isSimulated = !result.txHash || result.txHash.startsWith('0xsim_');
  const executionBadge = isSimulated
    ? `SIMULATED — ${result.protocol} has no BSC Testnet contracts`
    : `ON-CHAIN — real transaction on BSC Testnet`;

  const lines = [
    `Deposit successful! [${executionBadge}]`,
    ``,
    `Protocol: ${result.protocol}`,
    `Amount: ${result.amount} ${result.token}`,
    `APY: ${result.apy.toFixed(2)}%`,
    `Position ID: ${result.positionId}`,
  ];
  if (isSimulated) {
    lines.push(`Tx: SIMULATED — no real on-chain transaction.`);
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
  opts?: { client_op_id?: string; confirmation_token?: string },
): Promise<string> {
  const result = await engine.yieldDeposit({
    userId,
    token,
    amount,
    protocol,
    client_op_id: opts?.client_op_id,
    confirmation_token: opts?.confirmation_token,
  });
  return formatEngineResult(result, (data) => {
    const isSimulated = !data.txHash || data.txHash.startsWith('0xsim_');
    const executionBadge = isSimulated
      ? `SIMULATED — ${data.protocol} has no BSC Testnet contracts`
      : `ON-CHAIN — real transaction on BSC Testnet`;

    const lines = [
      `Deposit successful! [${executionBadge}]`,
      ``,
      `Protocol: ${data.protocol}`,
      `Amount: ${data.amount} ${data.token}`,
      `APY: ${data.apy.toFixed(2)}%`,
      `Position ID: ${data.positionId}`,
    ];

    if (isSimulated) {
      lines.push(`Tx: SIMULATED — no real on-chain transaction. Use Venus to get a real BSCScan link.`);
    } else {
      lines.push(`Tx: ${data.txHash}`);
      lines.push(`BSCScan: https://testnet.bscscan.com/tx/${data.txHash}`);
    }

    if (data.alternatives.length > 0) {
      lines.push('', 'Other options considered:');
      for (const alt of data.alternatives) {
        const sim = alt.isSimulated ? ' (simulated)' : '';
        lines.push(`  - ${alt.protocol}: ${alt.apy.toFixed(2)}% APY${sim}`);
      }
    }

    return lines.join('\n');
  });
}
