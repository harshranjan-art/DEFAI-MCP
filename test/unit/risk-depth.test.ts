import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/core/db';
import { check, configure, type RiskConfig } from '../../src/core/riskManager';

const TEST_USER = 'risk-depth-user';

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

beforeEach(() => {
  // Reset state that affects the new risk-depth checks
  db.prepare(`DELETE FROM trades WHERE user_id = ?`).run(TEST_USER);
  db.prepare(`DELETE FROM positions WHERE user_id = ?`).run(TEST_USER);
  db.prepare(`DELETE FROM market_snapshots WHERE token IN ('BNB','VOLTEST')`).run();
  // Reset risk config to a known baseline
  configure(TEST_USER, {
    maxPositionUsd: 10_000,
    maxTotalExposureUsd: 100_000,
    dailyLossCapUsd: 500,
    sendAddressAllowlist: [],
    sendAddressAllowlistEnforced: true,
    volTargetPercent: 0.30,
    cooldownLossThresholdUsd: 50,
    cooldownMinutes: 15,
  } as Partial<RiskConfig>);
});

describe('risk: send-tokens allowlist (default-deny)', () => {
  it('rejects sends when allowlist is enforced and empty', () => {
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 10,
      token: 'USDT',
      toAddress: '0x1111111111111111111111111111111111111111',
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('sends are blocked by default');
  });

  it('rejects sends to addresses not on the allowlist', () => {
    configure(TEST_USER, {
      sendAddressAllowlist: ['0xAAAA111111111111111111111111111111111111'],
    });
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 10,
      token: 'USDT',
      toAddress: '0xBBBB222222222222222222222222222222222222',
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('not in your send allowlist');
  });

  it('allows sends to addresses on the allowlist (case-insensitive)', () => {
    configure(TEST_USER, {
      sendAddressAllowlist: ['0xAAAA111111111111111111111111111111111111'],
    });
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 10,
      token: 'USDT',
      toAddress: '0xaaaa111111111111111111111111111111111111',
    });
    expect(r.allowed).toBe(true);
  });

  it('allows sends when allowlist enforcement is disabled', () => {
    configure(TEST_USER, {
      sendAddressAllowlistEnforced: false,
    });
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 10,
      token: 'USDT',
      toAddress: '0x9999999999999999999999999999999999999999',
    });
    expect(r.allowed).toBe(true);
  });
});

describe('risk: daily loss cap', () => {
  it('does not block when daily PnL is positive', () => {
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '1', '2', 100)
    `).run('trd_p1', TEST_USER); // (2-1)*100 = +100
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 100, token: 'BNB' });
    expect(r.allowed).toBe(true);
  });

  it('blocks when daily realized loss reaches the cap', () => {
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '10', '0', 100)
    `).run('trd_l1', TEST_USER); // (0-10)*100 = -1000 → exceeds $500 cap
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 100, token: 'BNB' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Daily loss cap reached');
  });

  it('does not block send actions even when daily-loss cap is hit', () => {
    configure(TEST_USER, { sendAddressAllowlistEnforced: false });
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '10', '0', 100)
    `).run('trd_l2', TEST_USER);
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 5,
      token: 'USDT',
      toAddress: '0x9999999999999999999999999999999999999999',
    });
    // send still allowed because user might want to withdraw funds after a bad day
    expect(r.allowed).toBe(true);
  });
});

describe('risk: cooldown after a loss', () => {
  it('blocks when a recent loss exceeds the cooldown threshold', () => {
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd, executed_at)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '10', '0', 100, datetime('now', '-5 minutes'))
    `).run('trd_c1', TEST_USER); // -1000 loss within last 15 min
    configure(TEST_USER, { dailyLossCapUsd: 0 }); // disable daily-cap so cooldown is the only thing blocking
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 50, token: 'BNB' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Cooldown active');
  });

  it('does not block when the recent loss is below the threshold', () => {
    configure(TEST_USER, { dailyLossCapUsd: 0, cooldownLossThresholdUsd: 200, cooldownMinutes: 15 });
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd, executed_at)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '1', '0', 100, datetime('now', '-5 minutes'))
    `).run('trd_c2', TEST_USER); // -100 loss, below 200 threshold
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 50, token: 'BNB' });
    expect(r.allowed).toBe(true);
  });

  it('does not block when the loss is older than cooldown window', () => {
    configure(TEST_USER, { dailyLossCapUsd: 0, cooldownLossThresholdUsd: 50, cooldownMinutes: 15 });
    db.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, tx_hash, from_amount, to_amount, price_usd, executed_at)
      VALUES (?, ?, 'swap', 'PancakeSwap', '0xa', '10', '0', 100, datetime('now', '-30 minutes'))
    `).run('trd_c3', TEST_USER); // -1000, but outside the 15-min window
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 50, token: 'BNB' });
    expect(r.allowed).toBe(true);
  });
});

describe('risk: volatility-adjusted position sizing', () => {
  it('rejects oversize deposits when asset vol exceeds target', () => {
    // Seed enough varied prices to compute non-default vol
    const prices = Array.from({ length: 30 }, (_, i) => 100 + 50 * Math.sin(i)); // ±50% swings
    for (let i = 0; i < prices.length; i++) {
      db.prepare(`
        INSERT INTO market_snapshots (protocol, token, price_usd, recorded_at)
        VALUES ('test', 'BNB', ?, datetime('now', ?))
      `).run(prices[i], `-${(prices.length - i) * 5} minutes`);
    }
    configure(TEST_USER, {
      maxPositionUsd: 10_000,
      volTargetPercent: 0.30,
      dailyLossCapUsd: 0,
      cooldownLossThresholdUsd: 0,
    });
    // High-vol BNB → adjusted cap should be a fraction of maxPositionUsd.
    // Asking for the full 10k should fail.
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 10_000, token: 'BNB' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('vol-adjusted cap');
  });

  it('does not block when the amount is within the vol-adjusted cap', () => {
    // Same high-vol seeding, but ask for a tiny amount.
    const prices = Array.from({ length: 30 }, (_, i) => 100 + 50 * Math.sin(i));
    for (let i = 0; i < prices.length; i++) {
      db.prepare(`
        INSERT INTO market_snapshots (protocol, token, price_usd, recorded_at)
        VALUES ('test', 'BNB', ?, datetime('now', ?))
      `).run(prices[i], `-${(prices.length - i) * 5} minutes`);
    }
    configure(TEST_USER, {
      maxPositionUsd: 10_000,
      volTargetPercent: 0.30,
      dailyLossCapUsd: 0,
      cooldownLossThresholdUsd: 0,
    });
    const r = check(TEST_USER, { type: 'deposit', amountUsd: 1, token: 'BNB' });
    expect(r.allowed).toBe(true);
  });

  it('does not apply vol adjustment for type=send (out of scope)', () => {
    configure(TEST_USER, {
      sendAddressAllowlistEnforced: false,
      maxPositionUsd: 100,
      volTargetPercent: 0.30,
    });
    // Even if vol were sky-high, sends shouldn't be blocked by vol-adjustment.
    const r = check(TEST_USER, {
      type: 'send',
      amountUsd: 50,
      token: 'BNB',
      toAddress: '0x9999999999999999999999999999999999999999',
    });
    expect(r.allowed).toBe(true);
  });
});
