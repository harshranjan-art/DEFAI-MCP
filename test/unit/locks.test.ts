import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/core/db';
import {
  acquireUserLock,
  releaseUserLock,
  withUserLock,
  LockContentionError,
} from '../../src/core/locks';

const TEST_USER = 'lock-test-user';

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

beforeEach(() => {
  db.prepare(`DELETE FROM user_locks WHERE user_id = ?`).run(TEST_USER);
});

describe('acquireUserLock', () => {
  it('returns acquired:true when nothing holds the lock', () => {
    const r = acquireUserLock(TEST_USER, 'holder-a');
    expect(r.acquired).toBe(true);
    expect(r.expires_at).toBeDefined();
  });

  it('returns acquired:false when a fresh lock is held by another holder', () => {
    acquireUserLock(TEST_USER, 'holder-a', 30_000);
    const r = acquireUserLock(TEST_USER, 'holder-b', 30_000);
    expect(r.acquired).toBe(false);
    expect(r.held_by).toBe('holder-a');
  });

  it('grants the lock when the prior holder has expired', () => {
    acquireUserLock(TEST_USER, 'holder-a', 30_000);
    // Backdate the existing lock to simulate TTL elapsed.
    db.prepare(`UPDATE user_locks SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?`).run(TEST_USER);
    const r = acquireUserLock(TEST_USER, 'holder-b');
    expect(r.acquired).toBe(true);
  });

  it('treats the same holder re-acquiring while live as contention (caller intent unclear)', () => {
    acquireUserLock(TEST_USER, 'holder-a', 30_000);
    const r = acquireUserLock(TEST_USER, 'holder-a');
    // We deliberately report contention rather than silently reissue —
    // the caller can decide what to do (treat as success or as a bug).
    expect(r.acquired).toBe(false);
  });

  it('overwrites holder + acquired_at on TTL-based grant', () => {
    acquireUserLock(TEST_USER, 'holder-a', 30_000);
    db.prepare(`UPDATE user_locks SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?`).run(TEST_USER);
    acquireUserLock(TEST_USER, 'holder-b');
    const row = db.prepare(`SELECT held_by FROM user_locks WHERE user_id = ?`).get(TEST_USER) as any;
    expect(row.held_by).toBe('holder-b');
  });
});

describe('releaseUserLock', () => {
  it('releases the lock if held by the matching holder', () => {
    acquireUserLock(TEST_USER, 'holder-a');
    expect(releaseUserLock(TEST_USER, 'holder-a')).toBe(true);
    expect(db.prepare(`SELECT * FROM user_locks WHERE user_id = ?`).get(TEST_USER)).toBeUndefined();
  });

  it('no-ops when the lock is held by someone else', () => {
    acquireUserLock(TEST_USER, 'holder-a');
    expect(releaseUserLock(TEST_USER, 'holder-b')).toBe(false);
    // Lock still exists.
    expect(db.prepare(`SELECT * FROM user_locks WHERE user_id = ?`).get(TEST_USER)).toBeDefined();
  });

  it('no-ops when no lock exists', () => {
    expect(releaseUserLock(TEST_USER, 'whoever')).toBe(false);
  });
});

describe('withUserLock', () => {
  it('runs fn and releases the lock on success', async () => {
    let ran = false;
    const result = await withUserLock(TEST_USER, 'holder-a', async () => {
      ran = true;
      return 'done';
    });
    expect(ran).toBe(true);
    expect(result).toBe('done');
    expect(db.prepare(`SELECT * FROM user_locks WHERE user_id = ?`).get(TEST_USER)).toBeUndefined();
  });

  it('releases the lock even if fn throws', async () => {
    await expect(
      withUserLock(TEST_USER, 'holder-a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(db.prepare(`SELECT * FROM user_locks WHERE user_id = ?`).get(TEST_USER)).toBeUndefined();
  });

  it('throws LockContentionError when the lock is held by another holder', async () => {
    acquireUserLock(TEST_USER, 'holder-a', 30_000);
    await expect(withUserLock(TEST_USER, 'holder-b', async () => 'never')).rejects.toBeInstanceOf(LockContentionError);
  });
});
