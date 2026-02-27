import * as engine from '../../core/engine';

export async function executeDeltaNeutralOpen(
  userId: string,
  token: string,
  notionalUsd: string,
  maxFundingRate?: number,
): Promise<string> {
  const result = await engine.deltaNeutralOpen(userId, token, notionalUsd, maxFundingRate);
  return result.message;
}

export async function executeDeltaNeutralClose(
  userId: string,
  positionId: string,
): Promise<string> {
  const result = await engine.deltaNeutralClose(userId, positionId);
  return result.message;
}
