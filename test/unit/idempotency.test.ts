import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/core/db';
import { checkTrade, checkPosition, newClientOpId } from '../../src/core/idempotency';

const TEST_USER = 'idempotest-user-1';

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

describe('idempotency.newClientOpId', () => {
  it('generates a syntactically valid id', () => {
    const id = newClientOpId();
    expect(id).toMatch(/^op_[A-Za-z0-9_\-]+$/);
    expect(id.length).toBeGreaterThan(8);
  });

  it('generates distinct ids on successive calls', () => {
    const a = newClientOpId();
    const b = newClientOpId();
    expect(a).not.toBe(b);
  });
});

describe('idempotency.checkTrade', () => {
  it('returns hit:false when no client_op_id is given', () => {
    expect(checkTrade(undefined)).toEqual({ hit: false });
  });

  it('returns hit:false when no row exists for the id', () => {
    expect(checkTrade(newClientOpId())).toEqual({ hit: false });
  });

  it('returns hit:true with the original row after a matching insert', () => {
    const opId = newClientOpId();
    db.prepare(
      `INSERT INTO trades (id, user_id, type, protocol, tx_hash, client_op_id)
       VALUES (?, ?, 'swap', 'PancakeSwap', '0xabc', ?)`,
    ).run('trd_dedup1', TEST_USER, opId);
    const r = checkTrade(opId);
    expect(r.hit).toBe(true);
    if (r.hit) {
      expect(r.original.tx_hash).toBe('0xabc');
      expect(r.original.client_op_id).toBe(opId);
    }
  });

  it('the partial UNIQUE index rejects a second insert with the same client_op_id', () => {
    const opId = newClientOpId();
    db.prepare(
      `INSERT INTO trades (id, user_id, type, protocol, tx_hash, client_op_id)
       VALUES (?, ?, 'swap', 'PancakeSwap', '0xabc', ?)`,
    ).run('trd_dup_a', TEST_USER, opId);

    expect(() =>
      db.prepare(
        `INSERT INTO trades (id, user_id, type, protocol, tx_hash, client_op_id)
         VALUES (?, ?, 'swap', 'PancakeSwap', '0xdef', ?)`,
      ).run('trd_dup_b', TEST_USER, opId),
    ).toThrow(/UNIQUE constraint/);
  });

  it('multiple rows with NULL client_op_id are allowed (partial-index behavior)', () => {
    db.prepare(
      `INSERT INTO trades (id, user_id, type, protocol, tx_hash)
       VALUES (?, ?, 'swap', 'PancakeSwap', '0x000')`,
    ).run('trd_null_a', TEST_USER);
    db.prepare(
      `INSERT INTO trades (id, user_id, type, protocol, tx_hash)
       VALUES (?, ?, 'swap', 'PancakeSwap', '0x001')`,
    ).run('trd_null_b', TEST_USER);
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM trades WHERE client_op_id IS NULL AND user_id = ?`)
      .get(TEST_USER) as any;
    expect(count.n).toBeGreaterThanOrEqual(2);
  });
});

describe('idempotency.checkPosition', () => {
  it('returns hit:false when no row exists', () => {
    expect(checkPosition(newClientOpId())).toEqual({ hit: false });
  });

  it('returns hit:true after matching insert', () => {
    const opId = newClientOpId();
    db.prepare(
      `INSERT INTO positions (id, user_id, type, protocol, token, amount, client_op_id)
       VALUES (?, ?, 'yield', 'Venus', 'BNB', '0.1', ?)`,
    ).run('pos_dedup1', TEST_USER, opId);
    const r = checkPosition(opId);
    expect(r.hit).toBe(true);
  });
});
