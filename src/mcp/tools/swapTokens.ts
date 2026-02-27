import * as engine from '../../core/engine';

export async function executeSwapTokens(
  userId: string,
  fromToken: string,
  toToken: string,
  amount: string,
): Promise<string> {
  const result = await engine.swapTokens(userId, fromToken, toToken, amount);

  if (!result.success) {
    return `Swap failed: ${result.message}`;
  }

  const lines = [
    `Swap executed!`,
    `  ${amount} ${fromToken} → ${toToken}`,
    `  Protocol: ${result.protocol}`,
  ];

  if (result.txHash && !result.txHash.startsWith('0xsim_')) {
    lines.push(`  Tx: https://testnet.bscscan.com/tx/${result.txHash}`);
  } else if (result.txHash) {
    lines.push(`  Tx: ${result.txHash} (simulated)`);
  }

  if (result.effectivePrice) {
    lines.push(`  Effective price: $${result.effectivePrice.toFixed(4)}`);
  }

  return lines.join('\n');
}
