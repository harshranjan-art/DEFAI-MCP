import * as engine from '../../core/engine';
import { formatDepositResult } from './yieldDeposit';

export async function executeYieldRotate(
  userId: string,
  positionId: string,
  minImprovementBps?: number,
): Promise<string> {
  // First check if rotation makes sense
  const plan = await engine.checkRotation(positionId, minImprovementBps);

  if (!plan) {
    return 'No profitable rotation found — current position is already at the best available APY (or improvement below threshold).';
  }

  const lines = [
    `Rotation plan found:`,
    `  Current: ${plan.currentProtocol} at ${plan.currentApy.toFixed(2)}% APY`,
    `  Target: ${plan.targetProtocol} at ${plan.targetApy.toFixed(2)}% APY`,
    `  Improvement: ${plan.improvementBps} bps (${plan.netBenefit})`,
    `  Gas cost: ${plan.estimatedGasCost}`,
    ``,
    `Executing rotation...`,
  ];

  const result = await engine.yieldRotate(userId, positionId, minImprovementBps);
  lines.push('', formatDepositResult(result));

  return lines.join('\n');
}
