import { z } from 'zod';
import { isAddress } from 'viem';

/**
 * UUID v4 string (also accepts our internal `op_<uuid>` and `pos_<8>` shorthands
 * for trace/idempotency ids — practical relaxation for a single-process system).
 */
export const ClientOpIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_\-]+$/, 'client_op_id must be alphanumeric with -_');

/** Confirmation token shape — see confirmations.ts. */
export const ConfirmationTokenSchema = z
  .string()
  .regex(/^cfm_[a-f0-9]{32}$/, 'invalid confirmation_token');

/**
 * 2-10 char uppercase token symbol. Adapters validate against their own allowlists
 * downstream; this is just a syntactic gate.
 */
export const TokenSymbolSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,10}$/, 'token symbol must be 2-10 uppercase alphanumeric chars');

/**
 * Decimal-string amount. Rejects scientific notation, negatives, zero, and absurdly
 * large numbers that almost certainly indicate hallucination.
 */
export const AmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'amount must be a decimal string (no scientific notation)')
  .refine((s) => parseFloat(s) > 0, 'amount must be positive')
  .refine((s) => parseFloat(s) < 1_000_000, 'amount unreasonably large (>1,000,000)');

/** EVM address (20 bytes, hex). Uses viem's isAddress to keep behavior consistent with the engine. */
export const AddressSchema = z
  .string()
  .refine((s) => isAddress(s), 'must be a valid 20-byte hex address');

/** UUID v4 user_id from the DB. */
export const UserIdSchema = z.string().uuid();

export const SlippageBpsSchema = z.number().int().min(1).max(1000);
