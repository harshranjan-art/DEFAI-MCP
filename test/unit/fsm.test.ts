import { describe, it, expect, vi } from 'vitest';
import { Machine, MachineDef } from '../../src/core/fsm/machine';

type State = 'A' | 'B' | 'C' | 'TERMINAL';
type Event = 'go' | 'back' | 'finish' | 'gated';

function makeMachine(persist = vi.fn()) {
  const def: MachineDef<State, Event, { allow: boolean }> = {
    name: 'test',
    initial: 'A',
    finals: ['TERMINAL'],
    transitions: [
      { from: 'A', event: 'go', to: 'B' },
      { from: 'B', event: 'go', to: 'C' },
      { from: 'B', event: 'back', to: 'A' },
      { from: ['A', 'B', 'C'], event: 'finish', to: 'TERMINAL' },
      { from: 'A', event: 'gated', to: 'C', guard: (ctx) => ctx.allow },
    ],
  };
  return { m: new Machine(def, persist), persist };
}

describe('Machine', () => {
  it('advances on a matching transition and persists', async () => {
    const { m, persist } = makeMachine();
    const r = await m.send('e1', 'A', 'go', { allow: true });
    expect(r.transitioned).toBe(true);
    expect(r.state).toBe('B');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      machine: 'test',
      entityId: 'e1',
      fromState: 'A',
      toState: 'B',
      event: 'go',
      metadata: undefined,
    });
  });

  it('returns transitioned:false on unknown event from current state', async () => {
    const { m, persist } = makeMachine();
    const r = await m.send('e1', 'A', 'back', { allow: true });
    expect(r.transitioned).toBe(false);
    expect(r.state).toBe('A');
    expect(persist).not.toHaveBeenCalled();
  });

  it('honors guards: rejects when guard returns false', async () => {
    const { m, persist } = makeMachine();
    const r = await m.send('e1', 'A', 'gated', { allow: false });
    expect(r.transitioned).toBe(false);
    expect(r.state).toBe('A');
    expect(r.reason).toBe('all guards rejected');
    expect(persist).not.toHaveBeenCalled();
  });

  it('honors guards: allows when guard returns true', async () => {
    const { m } = makeMachine();
    const r = await m.send('e1', 'A', 'gated', { allow: true });
    expect(r.transitioned).toBe(true);
    expect(r.state).toBe('C');
  });

  it('supports multi-from transitions', async () => {
    const { m, persist } = makeMachine();
    expect((await m.send('e1', 'A', 'finish', { allow: true })).state).toBe('TERMINAL');
    expect((await m.send('e2', 'B', 'finish', { allow: true })).state).toBe('TERMINAL');
    expect((await m.send('e3', 'C', 'finish', { allow: true })).state).toBe('TERMINAL');
    expect(persist).toHaveBeenCalledTimes(3);
  });

  it('isFinal returns true only for terminal states', () => {
    const { m } = makeMachine();
    expect(m.isFinal('TERMINAL')).toBe(true);
    expect(m.isFinal('A')).toBe(false);
    expect(m.isFinal('B')).toBe(false);
  });

  it('exposes the initial state and name', () => {
    const { m } = makeMachine();
    expect(m.initialState()).toBe('A');
    expect(m.name()).toBe('test');
  });

  it('aborts the transition (and does not persist) if action throws', async () => {
    const persist = vi.fn();
    const def: MachineDef<State, Event, { allow: boolean }> = {
      name: 'with-action',
      initial: 'A',
      finals: ['TERMINAL'],
      transitions: [
        {
          from: 'A',
          event: 'go',
          to: 'B',
          action: () => { throw new Error('side-effect failed'); },
        },
      ],
    };
    const m = new Machine(def, persist);
    const r = await m.send('e1', 'A', 'go', { allow: true });
    expect(r.transitioned).toBe(false);
    expect(r.state).toBe('A');
    expect(r.reason).toContain('action failed');
    expect(persist).not.toHaveBeenCalled();
  });
});
