import * as engine from '../../core/engine';

export function executeRiskConfig(
  userId: string,
  updates?: {
    max_position_usd?: number;
    max_total_exposure_usd?: number;
    max_slippage_bps?: number;
    allowed_protocols?: string[];
    max_delta_neutral_positions?: number;
  },
): string {
  if (!updates || Object.keys(updates).length === 0) {
    // Read-only mode — show current config
    const config = engine.getRiskConfig(userId);
    return [
      `Risk Configuration:`,
      `  Max position size: $${config.maxPositionUsd}`,
      `  Max total exposure: $${config.maxTotalExposureUsd}`,
      `  Max slippage: ${config.maxSlippageBps} bps`,
      `  Allowed protocols: ${config.allowedProtocols.length > 0 ? config.allowedProtocols.join(', ') : 'all'}`,
      `  Max delta-neutral positions: ${config.maxDeltaNeutralPositions}`,
    ].join('\n');
  }

  // Map snake_case params to camelCase
  const mapped: Record<string, any> = {};
  if (updates.max_position_usd !== undefined) mapped.maxPositionUsd = updates.max_position_usd;
  if (updates.max_total_exposure_usd !== undefined) mapped.maxTotalExposureUsd = updates.max_total_exposure_usd;
  if (updates.max_slippage_bps !== undefined) mapped.maxSlippageBps = updates.max_slippage_bps;
  if (updates.allowed_protocols !== undefined) mapped.allowedProtocols = updates.allowed_protocols;
  if (updates.max_delta_neutral_positions !== undefined) mapped.maxDeltaNeutralPositions = updates.max_delta_neutral_positions;

  const config = engine.configureRisk(userId, mapped);

  return [
    `Risk configuration updated!`,
    `  Max position size: $${config.maxPositionUsd}`,
    `  Max total exposure: $${config.maxTotalExposureUsd}`,
    `  Max slippage: ${config.maxSlippageBps} bps`,
    `  Allowed protocols: ${config.allowedProtocols.length > 0 ? config.allowedProtocols.join(', ') : 'all'}`,
    `  Max delta-neutral positions: ${config.maxDeltaNeutralPositions}`,
  ].join('\n');
}
