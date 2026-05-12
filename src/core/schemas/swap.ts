import { z } from 'zod';
import {
  AmountSchema,
  ClientOpIdSchema,
  ConfirmationTokenSchema,
  TokenSymbolSchema,
  UserIdSchema,
} from './common';

export const SwapInputSchema = z
  .object({
    userId: UserIdSchema,
    fromToken: TokenSymbolSchema,
    toToken: TokenSymbolSchema,
    amount: AmountSchema,
    client_op_id: ClientOpIdSchema.optional(),
    confirmation_token: ConfirmationTokenSchema.optional(),
  })
  .refine((d) => d.fromToken !== d.toToken, {
    message: 'fromToken must differ from toToken',
    path: ['toToken'],
  });

export type SwapInput = z.infer<typeof SwapInputSchema>;
