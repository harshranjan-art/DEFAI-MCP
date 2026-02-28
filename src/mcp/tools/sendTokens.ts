import * as engine from '../../core/engine';

export async function executeSendTokens(
  userId: string,
  token: string,
  amount: string,
  toAddress: string,
): Promise<string> {
  const result = await engine.sendTokens(userId, token, amount, toAddress);

  if (!result.success) {
    return `Transfer failed: ${result.message}`;
  }

  const lines = [
    `Transfer sent!`,
    `  ${amount} ${token.toUpperCase()} → ${toAddress}`,
  ];

  if (result.txHash && !result.txHash.startsWith('0xsim_')) {
    lines.push(`  Tx: ${result.explorerUrl}`);
  } else if (result.txHash) {
    lines.push(`  Tx: ${result.txHash} (simulated)`);
  }

  return lines.join('\n');
}
