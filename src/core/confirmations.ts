/**
 * Confirmation gate — turns a destructive action into a two-phase RPC:
 *
 *   1. engine.action(args)            → returns { needsConfirmation: { token, preview, ttl } }
 *   2. engine.action(args, { token }) → consumes token, executes
 *
 * Tokens are single-use, time-limited, and tied to the args presented at creation —
 * a "bait-and-switch" attempt (confirm $1, replay with $1000) is rejected on consume.
 */

import crypto from 'crypto';
import { db } from './db';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CreateConfirmationOpts {
  userId: string;
  action: string;
  args: Record<string, unknown>;       // bound to the token; consume verifies match
  preview: Record<string, unknown>;    // user-facing summary
}

export interface CreatedConfirmation {
  token: string;
  expires_at: string;
}

export function createConfirmation(opts: CreateConfirmationOpts): CreatedConfirmation {
  const token = `cfm_${crypto.randomBytes(16).toString('hex')}`;
  const expires_at = new Date(Date.now() + TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO pending_confirmations (token, user_id, action, args_json, preview_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    token,
    opts.userId,
    opts.action,
    JSON.stringify(opts.args),
    JSON.stringify(opts.preview),
    expires_at,
  );
  return { token, expires_at };
}

export interface ConsumeConfirmationOpts {
  token: string;
  userId: string;
  action: string;
}

/**
 * Consume a token. Returns the original args if all guards pass; null otherwise.
 * Atomic via SQLite transaction — the read + UPDATE happen together so two
 * simultaneous consumes can't both succeed.
 */
export function consumeConfirmation(opts: ConsumeConfirmationOpts): Record<string, unknown> | null {
  const txn = db.transaction(() => {
    const row = db.prepare(`
      SELECT args_json FROM pending_confirmations
      WHERE token = ? AND user_id = ? AND action = ?
        AND consumed_at IS NULL
        AND datetime(expires_at) > datetime('now')
    `).get(opts.token, opts.userId, opts.action) as any;
    if (!row) return null;
    db.prepare(`UPDATE pending_confirmations SET consumed_at = CURRENT_TIMESTAMP WHERE token = ?`).run(
      opts.token,
    );
    return JSON.parse(row.args_json) as Record<string, unknown>;
  });
  return txn();
}

/**
 * Compare args presented at consume time against the args bound to the token.
 * Returns the list of differing field names (empty list = clean match).
 * Generic shallow compare — only checks the supplied "match" keys; lets the
 * engine choose which fields are bait-and-switch-sensitive.
 */
export function diffArgs(
  bound: Record<string, unknown>,
  presented: Record<string, unknown>,
  matchKeys: string[],
): string[] {
  const diff: string[] = [];
  for (const k of matchKeys) {
    if (JSON.stringify(bound[k]) !== JSON.stringify(presented[k])) diff.push(k);
  }
  return diff;
}
