/**
 * Arb-session FSM.
 *
 * States used today (Phase 2):
 *   SCANNING   — initial active state; cron is looking for opportunities
 *   EXECUTING  — mid-tick, executing trades for an opportunity
 *   STOPPED    — terminal; expired or user-stopped
 *   FAILED     — terminal; loss-limit hit
 *
 * States reserved for Phase 2.5 (when arb adapters become real and start
 * to actually fail mid-trade):
 *   COOLING    — backoff after a transient failure
 *   PAUSED     — user-paused, can resume
 */

import { Machine, MachineDef, PersistTransitionFn } from './machine';
import { db } from '../db';

export type ArbState = 'SCANNING' | 'EXECUTING' | 'COOLING' | 'PAUSED' | 'STOPPED' | 'FAILED';
export type ArbEvent =
  | 'opportunity_found'
  | 'execution_complete'
  | 'execution_failed'
  | 'expired'
  | 'loss_limit_hit'
  | 'user_paused'
  | 'user_resumed'
  | 'user_stopped'
  | 'cooling_done';

export interface ArbCtx {
  sessionId: string;
  pnlUsd: number;
  maxLossUsd: number;
  failureCount: number;
}

const def: MachineDef<ArbState, ArbEvent, ArbCtx> = {
  name: 'arb_session',
  initial: 'SCANNING',
  finals: ['STOPPED', 'FAILED'],
  transitions: [
    // Normal execution cycle
    { from: 'SCANNING',  event: 'opportunity_found',  to: 'EXECUTING' },
    { from: 'EXECUTING', event: 'execution_complete', to: 'SCANNING' },

    // Failure path (placeholder — Phase 2.5 plumbs failureCount + COOLING)
    {
      from: 'EXECUTING',
      event: 'execution_failed',
      to: 'COOLING',
      guard: (c) => c.failureCount < 5,
    },
    {
      from: 'EXECUTING',
      event: 'execution_failed',
      to: 'FAILED',
      guard: (c) => c.failureCount >= 5,
    },
    { from: 'COOLING',   event: 'cooling_done', to: 'SCANNING' },

    // Lifecycle (works from any non-terminal state)
    { from: ['SCANNING', 'EXECUTING', 'COOLING', 'PAUSED'], event: 'expired',         to: 'STOPPED' },
    { from: ['SCANNING', 'EXECUTING', 'COOLING'],            event: 'loss_limit_hit', to: 'FAILED'  },
    { from: ['SCANNING', 'EXECUTING', 'COOLING'],            event: 'user_paused',    to: 'PAUSED'  },
    { from: 'PAUSED',                                        event: 'user_resumed',   to: 'SCANNING'},
    { from: ['SCANNING', 'EXECUTING', 'COOLING', 'PAUSED'], event: 'user_stopped',   to: 'STOPPED' },
  ],
};

const persist: PersistTransitionFn<ArbState, ArbEvent> = (params) => {
  db.prepare(`
    INSERT INTO state_transitions (machine, entity_id, from_state, to_state, event, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.machine,
    params.entityId,
    params.fromState,
    params.toState,
    params.event,
    params.metadata ? JSON.stringify(params.metadata) : null,
  );
  // Also update the canonical state on the entity row + keep legacy `status` in sync.
  const legacyStatus = params.toState === 'STOPPED' || params.toState === 'FAILED' ? 'stopped' : 'active';
  db.prepare(`UPDATE auto_arb_sessions SET current_state = ?, status = ? WHERE id = ?`).run(
    params.toState,
    legacyStatus,
    params.entityId,
  );
};

export const arbMachine = new Machine(def, persist);

/**
 * Read the FSM state of a session. Falls back to deriving from legacy `status`
 * for sessions that pre-date migration 005 (the migration backfills, but this
 * is a belt-and-suspenders guard).
 */
export function getArbSessionState(row: { current_state?: string | null; status?: string }): ArbState {
  if (row.current_state) return row.current_state as ArbState;
  return row.status === 'active' ? 'SCANNING' : 'STOPPED';
}
