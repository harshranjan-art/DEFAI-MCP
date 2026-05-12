import { describe, it, expect } from 'vitest';
import { SwapInputSchema } from '../../src/core/schemas/swap';

const VALID_USER_ID = '11111111-1111-4111-8111-111111111111';

describe('SwapInputSchema', () => {
  function base() {
    return {
      userId: VALID_USER_ID,
      fromToken: 'BNB',
      toToken: 'USDT',
      amount: '1.0',
    };
  }

  it('accepts a valid input', () => {
    const r = SwapInputSchema.safeParse(base());
    expect(r.success).toBe(true);
  });

  it('rejects scientific notation in amount', () => {
    const r = SwapInputSchema.safeParse({ ...base(), amount: '5e3' });
    expect(r.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const r = SwapInputSchema.safeParse({ ...base(), amount: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects negative-looking amount', () => {
    const r = SwapInputSchema.safeParse({ ...base(), amount: '-1' });
    expect(r.success).toBe(false);
  });

  it('rejects unreasonably large amount', () => {
    const r = SwapInputSchema.safeParse({ ...base(), amount: '5000000' });
    expect(r.success).toBe(false);
  });

  it('rejects identical from/to tokens', () => {
    const r = SwapInputSchema.safeParse({ ...base(), toToken: 'BNB' });
    expect(r.success).toBe(false);
  });

  it('rejects lowercase token symbols (must be uppercase)', () => {
    const r = SwapInputSchema.safeParse({ ...base(), fromToken: 'bnb' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid userId (not a uuid)', () => {
    const r = SwapInputSchema.safeParse({ ...base(), userId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('accepts optional client_op_id', () => {
    const r = SwapInputSchema.safeParse({ ...base(), client_op_id: 'op_abc-123_xyz' });
    expect(r.success).toBe(true);
  });

  it('rejects malformed confirmation_token', () => {
    const r = SwapInputSchema.safeParse({ ...base(), confirmation_token: 'bad-prefix' });
    expect(r.success).toBe(false);
  });

  it('accepts well-formed confirmation_token', () => {
    const r = SwapInputSchema.safeParse({
      ...base(),
      confirmation_token: 'cfm_' + 'a'.repeat(32),
    });
    expect(r.success).toBe(true);
  });

  it('returns a structured error path on failure', () => {
    const r = SwapInputSchema.safeParse({ ...base(), amount: '1e5' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toContain('amount');
    }
  });
});
