import { z } from 'zod';
import { UserIdSchema } from './common';

export const RiskConfigPatchSchema = z.object({
  maxPositionUsd: z.number().positive().max(1_000_000).optional(),
  maxTotalExposureUsd: z.number().positive().max(10_000_000).optional(),
  maxSlippageBps: z.number().int().min(1).max(1000).optional(),
  allowedProtocols: z.array(z.string().min(2).max(32)).max(50).optional(),
  maxDeltaNeutralPositions: z.number().int().min(0).max(20).optional(),
});

export const ConfigureRiskInputSchema = z.object({
  userId: UserIdSchema,
  patch: RiskConfigPatchSchema,
});

export type ConfigureRiskInput = z.infer<typeof ConfigureRiskInputSchema>;
