import * as engine from '../../core/engine';
import { formatEngineResult } from '../../core/format';

export async function executeSwapTokens(
  userId: string,
  fromToken: string,
  toToken: string,
  amount: string,
  opts?: { client_op_id?: string; confirmation_token?: string },
): Promise<string> {
  const result = await engine.swapTokens({
    userId,
    fromToken,
    toToken,
    amount,
    client_op_id: opts?.client_op_id,
    confirmation_token: opts?.confirmation_token,
  });
  return formatEngineResult(result, (data) => {
    const lines = [
      `Swap executed!`,
      `  ${data.amount} ${data.fromToken} → ${data.toToken}`,
      `  Protocol: ${data.protocol}`,
    ];
    if (data.txHash && !data.txHash.startsWith('0xsim_')) {
      lines.push(`  Tx: https://testnet.bscscan.com/tx/${data.txHash}`);
    } else if (data.txHash) {
      lines.push(`  Tx: ${data.txHash} (simulated)`);
    }
    return lines.join('\n');
  });
}
