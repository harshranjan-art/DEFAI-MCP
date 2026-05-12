import { z } from 'zod';
import {
  AmountSchema,
  ClientOpIdSchema,
  ConfirmationTokenSchema,
  TokenSymbolSchema,
  UserIdSchema,
} from './common';

export const YieldDepositInputSchema = z.object({
  userId: UserIdSchema,
  token: TokenSymbolSchema,
  amount: AmountSchema,
  protocol: z.string().min(2).max(32).optional(),
  client_op_id: ClientOpIdSchema.optional(),
  confirmation_token: ConfirmationTokenSchema.optional(),
});

export type YieldDepositInput = z.infer<typeof YieldDepositInputSchema>;

export const YieldRotateInputSchema = z.object({
  userId: UserIdSchema,
  positionId: z.string().regex(/^pos_[a-f0-9]{8}$/, 'invalid position id'),
  minImprovementBps: z.number().int().min(1).max(10_000).optional(),
  client_op_id: ClientOpIdSchema.optional(),
  confirmation_token: ConfirmationTokenSchema.optional(),
});

export type YieldRotateInput = z.infer<typeof YieldRotateInputSchema>;
