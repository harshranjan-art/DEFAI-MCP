import { z } from 'zod';
import {
  ClientOpIdSchema,
  ConfirmationTokenSchema,
  SlippageBpsSchema,
  UserIdSchema,
} from './common';

export const ArbExecuteInputSchema = z.object({
  userId: UserIdSchema,
  opportunityId: z.string().min(4).max(64).optional(),
  maxSlippageBps: SlippageBpsSchema.optional(),
  client_op_id: ClientOpIdSchema.optional(),
});

export type ArbExecuteInput = z.infer<typeof ArbExecuteInputSchema>;

export const ArbAutoStartInputSchema = z.object({
  userId: UserIdSchema,
  duration_minutes: z.number().int().min(1).max(1440), // 1 min to 24 h
  max_loss_usd: z.number().positive().max(10_000),
  max_slippage_bps: SlippageBpsSchema,
  client_op_id: ClientOpIdSchema.optional(),
  confirmation_token: ConfirmationTokenSchema.optional(),
});

export type ArbAutoStartInput = z.infer<typeof ArbAutoStartInputSchema>;
