import { z } from 'zod';
import {
  ClientOpIdSchema,
  ConfirmationTokenSchema,
  TokenSymbolSchema,
  UserIdSchema,
} from './common';

export const DeltaOpenInputSchema = z.object({
  userId: UserIdSchema,
  token: TokenSymbolSchema,
  notionalUsd: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'notionalUsd must be a decimal string')
    .refine((s) => parseFloat(s) > 0, 'notionalUsd must be positive')
    .refine((s) => parseFloat(s) <= 100_000, 'notionalUsd capped at 100,000 USD'),
  maxFundingRate: z.number().min(-1).max(1).optional(),
  client_op_id: ClientOpIdSchema.optional(),
  confirmation_token: ConfirmationTokenSchema.optional(),
});

export type DeltaOpenInput = z.infer<typeof DeltaOpenInputSchema>;

export const DeltaCloseInputSchema = z.object({
  userId: UserIdSchema,
  positionId: z.string().regex(/^pos_[a-f0-9]{8}$/, 'invalid position id'),
  client_op_id: ClientOpIdSchema.optional(),
});

export type DeltaCloseInput = z.infer<typeof DeltaCloseInputSchema>;
