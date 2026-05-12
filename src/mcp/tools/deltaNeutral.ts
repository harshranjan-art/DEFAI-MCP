import * as engine from '../../core/engine';
import { formatEngineResult } from '../../core/format';

export async function executeDeltaNeutralOpen(
  userId: string,
  token: string,
  notionalUsd: string,
  maxFundingRate?: number,
  opts?: { client_op_id?: string; confirmation_token?: string },
): Promise<string> {
  const result = await engine.deltaNeutralOpen({
    userId,
    token,
    notionalUsd,
    maxFundingRate,
    client_op_id: opts?.client_op_id,
    confirmation_token: opts?.confirmation_token,
  });
  return formatEngineResult(result, (data) => {
    const lines = [data.message];
    if (data.positionId) lines.push(`Position ID: ${data.positionId}`);
    if (data.txHash) lines.push(`Tx: ${data.txHash}`);
    return lines.join('\n');
  });
}

export async function executeDeltaNeutralClose(
  userId: string,
  positionId: string,
): Promise<string> {
  const result = await engine.deltaNeutralClose(userId, positionId);
  return result.message;
}
