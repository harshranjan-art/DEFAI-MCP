import { z } from 'zod';
import { UserIdSchema } from './common';

export const AlertTypeSchema = z.enum(['apy_drop', 'arb_opportunity', 'position_health']);

export const SetAlertInputSchema = z.object({
  userId: UserIdSchema,
  alertType: AlertTypeSchema,
  active: z.boolean(),
  threshold: z.number().nonnegative().max(1_000_000).optional(),
});

export type SetAlertInput = z.infer<typeof SetAlertInputSchema>;
