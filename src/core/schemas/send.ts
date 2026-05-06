import { z } from 'zod';
import {
  AddressSchema,
  AmountSchema,
  ClientOpIdSchema,
  ConfirmationTokenSchema,
  TokenSymbolSchema,
  UserIdSchema,
} from './common';

export const SendInputSchema = z.object({
  userId: UserIdSchema,
  token: TokenSymbolSchema,
  amount: AmountSchema,
  toAddress: AddressSchema,
  client_op_id: ClientOpIdSchema.optional(),
  confirmation_token: ConfirmationTokenSchema.optional(),
});

export type SendInput = z.infer<typeof SendInputSchema>;
