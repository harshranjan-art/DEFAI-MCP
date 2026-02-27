import * as engine from '../../core/engine';

export async function executeArbExecute(
  userId: string,
  opportunityId?: string,
  maxSlippageBps?: number,
): Promise<string> {
  const result = await engine.arbExecute(userId, opportunityId, maxSlippageBps);

  if (!result.success) {
    return result.message;
  }

  return result.message;
}
