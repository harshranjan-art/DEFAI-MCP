import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/core/db';
import { createConfirmation, consumeConfirmation, diffArgs } from '../../src/core/confirmations';

const TEST_USER = 'confirm-test-user';

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

describe('createConfirmation', () => {
  it('returns a token with the expected prefix and length', () => {
    const { token, expires_at } = createConfirmation({
      userId: TEST_USER,
      action: 'swap_tokens',
      args: { amount: '1' },
      preview: { what: 'swap' },
    });
    expect(token).toMatch(/^cfm_[a-f0-9]{32}$/);
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('persists the row to pending_confirmations', () => {
    const { token } = createConfirmation({
      userId: TEST_USER,
      action: 'swap_tokens',
      args: { amount: '2' },
      preview: { what: 'swap' },
    });
    const row = db.prepare(`SELECT * FROM pending_confirmations WHERE token = ?`).get(token) as any;
    expect(row).toBeDefined();
    expect(row.user_id).toBe(TEST_USER);
    expect(row.action).toBe('swap_tokens');
    expect(row.consumed_at).toBeNull();
  });
});

describe('consumeConfirmation', () => {
  it('returns the bound args on first consume', () => {
    const args = { amount: '5', token: 'BNB' };
    const { token } = createConfirmation({ userId: TEST_USER, action: 'swap_tokens', args, preview: {} });
    const consumed = consumeConfirmation({ token, userId: TEST_USER, action: 'swap_tokens' });
    expect(consumed).toEqual(args);
  });

  it('rejects a second consume of the same token (single-use)', () => {
    const { token } = createConfirmation({ userId: TEST_USER, action: 'swap_tokens', args: { amount: '7' }, preview: {} });
    expect(consumeConfirmation({ token, userId: TEST_USER, action: 'swap_tokens' })).not.toBeNull();
    expect(consumeConfirmation({ token, userId: TEST_USER, action: 'swap_tokens' })).toBeNull();
  });

  it('rejects with mismatched user_id', () => {
    const { token } = createConfirmation({ userId: TEST_USER, action: 'swap_tokens', args: { amount: '3' }, preview: {} });
    expect(consumeConfirmation({ token, userId: 'someone-else', action: 'swap_tokens' })).toBeNull();
  });

  it('rejects with mismatched action', () => {
    const { token } = createConfirmation({ userId: TEST_USER, action: 'swap_tokens', args: { amount: '4' }, preview: {} });
    expect(consumeConfirmation({ token, userId: TEST_USER, action: 'send_tokens' })).toBeNull();
  });

  it('rejects an unknown token', () => {
    expect(consumeConfirmation({ token: 'cfm_' + '0'.repeat(32), userId: TEST_USER, action: 'swap_tokens' })).toBeNull();
  });

  it('rejects an expired token', () => {
    const { token } = createConfirmation({ userId: TEST_USER, action: 'swap_tokens', args: { amount: '8' }, preview: {} });
    // Backdate expiry to simulate TTL elapse
    db.prepare(`UPDATE pending_confirmations SET expires_at = datetime('now', '-1 minute') WHERE token = ?`).run(token);
    expect(consumeConfirmation({ token, userId: TEST_USER, action: 'swap_tokens' })).toBeNull();
  });
});

describe('diffArgs (bait-and-switch detection)', () => {
  it('returns empty list when match keys are equal', () => {
    expect(diffArgs({ a: 1, b: 2 }, { a: 1, b: 2 }, ['a', 'b'])).toEqual([]);
  });

  it('flags the keys that drifted', () => {
    expect(diffArgs({ a: 1, b: 2 }, { a: 1, b: 999 }, ['a', 'b'])).toEqual(['b']);
  });

  it('only checks listed match keys', () => {
    expect(diffArgs({ a: 1, b: 2 }, { a: 1, b: 999 }, ['a'])).toEqual([]);
  });

  it('handles nested objects via deep JSON compare', () => {
    expect(diffArgs({ x: { y: 1 } }, { x: { y: 1 } }, ['x'])).toEqual([]);
    expect(diffArgs({ x: { y: 1 } }, { x: { y: 2 } }, ['x'])).toEqual(['x']);
  });
});
