import * as engine from '../../core/engine';
import { formatEngineResult } from '../../core/format';

export async function executeSendTokens(
  userId: string,
  token: string,
  amount: string,
  toAddress: string,
  opts?: { client_op_id?: string; confirmation_token?: string },
): Promise<string> {
  const result = await engine.sendTokens({
    userId,
    token,
    amount,
    toAddress,
    client_op_id: opts?.client_op_id,
    confirmation_token: opts?.confirmation_token,
  });
  return formatEngineResult(result, (data) => {
    const lines = [
      `Transfer sent!`,
      `  ${data.amount} ${data.token} → ${data.toAddress}`,
    ];
    if (data.txHash && !data.txHash.startsWith('0xsim_')) {
      lines.push(`  Tx: ${data.explorerUrl}`);
    } else if (data.txHash) {
      lines.push(`  Tx: ${data.txHash} (simulated)`);
    }
    return lines.join('\n');
  });
}
