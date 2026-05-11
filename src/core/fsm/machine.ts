/**
 * Generic finite state machine.
 *
 * Designed to drive lifecycles of entities that live in the DB (arb sessions,
 * delta-neutral positions, etc.). All transitions are persisted via a
 * caller-supplied hook so the machine can be re-hydrated on process restart.
 *
 * Why generic + caller-supplied persistence (rather than wired to a specific
 * table): different entities live in different tables. The machine doesn't
 * need to know what `entity_id` means — it just records the transition.
 */

import { logger } from '../../utils/logger';

export interface Transition<State extends string, Event extends string, Ctx> {
  from: State | State[];
  event: Event;
  to: State;
  guard?: (ctx: Ctx) => boolean;
  action?: (ctx: Ctx) => void | Promise<void>;
}

export interface MachineDef<State extends string, Event extends string, Ctx> {
  name: string;
  initial: State;
  finals: State[];
  transitions: Transition<State, Event, Ctx>[];
}

export type PersistTransitionFn<State extends string, Event extends string> = (params: {
  machine: string;
  entityId: string;
  fromState: State;
  toState: State;
  event: Event;
  metadata?: Record<string, unknown>;
}) => void;

export interface SendResult<State extends string> {
  state: State;
  transitioned: boolean;
  reason?: string;
}

export class Machine<S extends string, E extends string, C> {
  constructor(private def: MachineDef<S, E, C>, private persist: PersistTransitionFn<S, E>) {}

  /**
   * Attempt a transition. Returns the new state if a matching transition
   * with a passing guard exists; otherwise the current state with
   * transitioned:false.
   */
  async send(
    entityId: string,
    currentState: S,
    event: E,
    ctx: C,
    metadata?: Record<string, unknown>,
  ): Promise<SendResult<S>> {
    const candidates = this.def.transitions.filter((t) => {
      const fromMatch = Array.isArray(t.from) ? t.from.includes(currentState) : t.from === currentState;
      return fromMatch && t.event === event;
    });

    if (candidates.length === 0) {
      return { state: currentState, transitioned: false, reason: 'no matching transition' };
    }

    for (const t of candidates) {
      if (t.guard && !t.guard(ctx)) continue;
      try {
        if (t.action) await t.action(ctx);
      } catch (e: any) {
        logger.error(
          { machine: this.def.name, entityId, event, err: e?.message },
          'fsm action threw; transition aborted',
        );
        return { state: currentState, transitioned: false, reason: `action failed: ${e?.message}` };
      }
      this.persist({
        machine: this.def.name,
        entityId,
        fromState: currentState,
        toState: t.to,
        event,
        metadata,
      });
      return { state: t.to, transitioned: true };
    }

    return { state: currentState, transitioned: false, reason: 'all guards rejected' };
  }

  isFinal(state: S): boolean {
    return this.def.finals.includes(state);
  }

  initialState(): S {
    return this.def.initial;
  }

  name(): string {
    return this.def.name;
  }
}
