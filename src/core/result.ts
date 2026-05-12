/**
 * EngineResult — single discriminated-union return type for every engine method.
 * Transports (bot, MCP, API) format these uniformly. New failure modes get added
 * here, not invented per-method.
 */

export type EngineResult<T> =
  | { ok: true; data: T; trace_id: string }
  | { ok: false; error: EngineError; trace_id: string }
  | { ok: false; needsConfirmation: ConfirmationRequest; trace_id: string };

export type EngineErrorCode =
  | 'VALIDATION_ERROR'        // zod failure
  | 'PERMISSION_DENIED'       // risk manager rejected
  | 'WALLET_INACTIVE'         // session not activated
  | 'PROTOCOL_UNAVAILABLE'    // adapter / circuit-breaker (Phase 2)
  | 'INSUFFICIENT_BALANCE'
  | 'EXTERNAL_API_FAILURE'
  | 'IDEMPOTENCY_REPLAY'      // duplicate client_op_id; original returned as details
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface EngineError {
  code: EngineErrorCode;
  message: string;            // human-readable, fed back to LLM context
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ConfirmationRequest {
  action: string;
  preview: Record<string, unknown>;
  confirmation_token: string;
  expires_at: string;         // ISO timestamp
}

export function newTraceId(): string {
  // Lightweight trace id for now; Phase 4 swaps to Langfuse-issued ids.
  return `trc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function ok<T>(data: T, trace_id: string): EngineResult<T> {
  return { ok: true, data, trace_id };
}

export function err(
  code: EngineErrorCode,
  message: string,
  trace_id: string,
  opts?: { retryable?: boolean; details?: Record<string, unknown> },
): EngineResult<never> {
  return {
    ok: false,
    error: { code, message, retryable: opts?.retryable ?? false, details: opts?.details },
    trace_id,
  };
}

export function needsConfirmation(
  req: ConfirmationRequest,
  trace_id: string,
): EngineResult<never> {
  return { ok: false, needsConfirmation: req, trace_id };
}

export function isOk<T>(r: EngineResult<T>): r is { ok: true; data: T; trace_id: string } {
  return r.ok === true;
}

export function isNeedsConfirmation<T>(
  r: EngineResult<T>,
): r is { ok: false; needsConfirmation: ConfirmationRequest; trace_id: string } {
  return r.ok === false && 'needsConfirmation' in r;
}

export function isError<T>(
  r: EngineResult<T>,
): r is { ok: false; error: EngineError; trace_id: string } {
  return r.ok === false && 'error' in r;
}
