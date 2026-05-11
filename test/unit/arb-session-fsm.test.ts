import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/core/db';
import { arbMachine, getArbSessionState, ArbCtx } from '../../src/core/fsm/arbSession';

const TEST_USER = 'arb-fsm-test-user';

function ctx(over: Partial<ArbCtx> = {}): ArbCtx {
  return {
    sessionId: 'unused',
    pnlUsd: 0,
    maxLossUsd: 100,
    failureCount: 0,
    ...over,
  };
}

function insertSession(id: string, initialState = 'SCANNING'): void {
  db.prepare(
    `INSERT INTO auto_arb_sessions (id, user_id, expires_at, max_loss_usd, max_slippage_bps, status, current_state)
     VALUES (?, ?, datetime('now', '+1 hour'), 100, 50, ?, ?)`,
  ).run(id, TEST_USER, initialState === 'STOPPED' || initialState === 'FAILED' ? 'stopped' : 'active', initialState);
}

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, encrypted_private_key, smart_account_address)
     VALUES (?, 'fake', '0x0000000000000000000000000000000000000000')`,
  ).run(TEST_USER);
});

beforeEach(() => {
  db.prepare(`DELETE FROM auto_arb_sessions WHERE user_id = ?`).run(TEST_USER);
  db.prepare(`DELETE FROM state_transitions WHERE machine = 'arb_session'`).run();
});

describe('arb-session FSM transitions', () => {
  it('SCANNING -> EXECUTING on opportunity_found', async () => {
    insertSession('s1');
    const r = await arbMachine.send('s1', 'SCANNING', 'opportunity_found', ctx({ sessionId: 's1' }));
    expect(r.transitioned).toBe(true);
    expect(r.state).toBe('EXECUTING');
    const row = db.prepare(`SELECT * FROM auto_arb_sessions WHERE id = ?`).get('s1') as any;
    expect(row.current_state).toBe('EXECUTING');
  });

  it('EXECUTING -> SCANNING on execution_complete (full round-trip)', async () => {
    insertSession('s2', 'EXECUTING');
    const r = await arbMachine.send('s2', 'EXECUTING', 'execution_complete', ctx({ sessionId: 's2' }));
    expect(r.state).toBe('SCANNING');
  });

  it('any non-terminal -> STOPPED on expired', async () => {
    for (const s of ['SCANNING', 'EXECUTING', 'COOLING'] as const) {
      const id = `exp_${s}`;
      insertSession(id, s);
      const r = await arbMachine.send(id, s, 'expired', ctx({ sessionId: id }));
      expect(r.state).toBe('STOPPED');
    }
  });

  it('SCANNING -> FAILED on loss_limit_hit', async () => {
    insertSession('s3');
    const r = await arbMachine.send('s3', 'SCANNING', 'loss_limit_hit', ctx({ sessionId: 's3', pnlUsd: -200, maxLossUsd: 100 }));
    expect(r.state).toBe('FAILED');
    const row = db.prepare(`SELECT * FROM auto_arb_sessions WHERE id = ?`).get('s3') as any;
    expect(row.status).toBe('stopped'); // legacy status synced to terminal
  });

  it('SCANNING -> STOPPED on user_stopped', async () => {
    insertSession('s4');
    const r = await arbMachine.send('s4', 'SCANNING', 'user_stopped', ctx({ sessionId: 's4' }));
    expect(r.state).toBe('STOPPED');
  });

  it('execution_failed routes to COOLING below failure threshold', async () => {
    insertSession('s5', 'EXECUTING');
    const r = await arbMachine.send('s5', 'EXECUTING', 'execution_failed', ctx({ sessionId: 's5', failureCount: 1 }));
    expect(r.state).toBe('COOLING');
  });

  it('execution_failed routes to FAILED at or above the threshold', async () => {
    insertSession('s6', 'EXECUTING');
    const r = await arbMachine.send('s6', 'EXECUTING', 'execution_failed', ctx({ sessionId: 's6', failureCount: 5 }));
    expect(r.state).toBe('FAILED');
  });

  it('rejects nonsense transitions (e.g. opportunity_found from STOPPED)', async () => {
    insertSession('s7', 'STOPPED');
    const r = await arbMachine.send('s7', 'STOPPED', 'opportunity_found', ctx({ sessionId: 's7' }));
    expect(r.transitioned).toBe(false);
    expect(r.state).toBe('STOPPED');
  });

  it('persists each transition to state_transitions table', async () => {
    insertSession('s8');
    await arbMachine.send('s8', 'SCANNING', 'opportunity_found', ctx({ sessionId: 's8' }));
    await arbMachine.send('s8', 'EXECUTING', 'execution_complete', ctx({ sessionId: 's8' }));
    const transitions = db
      .prepare(`SELECT * FROM state_transitions WHERE machine = 'arb_session' AND entity_id = ? ORDER BY id`)
      .all('s8') as any[];
    expect(transitions).toHaveLength(2);
    expect(transitions[0].from_state).toBe('SCANNING');
    expect(transitions[0].to_state).toBe('EXECUTING');
    expect(transitions[0].event).toBe('opportunity_found');
    expect(transitions[1].from_state).toBe('EXECUTING');
    expect(transitions[1].to_state).toBe('SCANNING');
  });
});

describe('getArbSessionState (legacy compatibility)', () => {
  it('prefers current_state when present', () => {
    expect(getArbSessionState({ current_state: 'SCANNING', status: 'stopped' })).toBe('SCANNING');
  });

  it('derives SCANNING from legacy status=active', () => {
    expect(getArbSessionState({ current_state: null, status: 'active' })).toBe('SCANNING');
  });

  it('derives STOPPED from legacy status=stopped', () => {
    expect(getArbSessionState({ current_state: null, status: 'stopped' })).toBe('STOPPED');
  });
});
