/**
 * Langfuse tracer — LLM-aware observability for the agent loop.
 *
 * Disabled by default. Enabled when LANGFUSE_ENABLED=1 AND the secret +
 * public keys are present; otherwise every helper returns a no-op span so
 * call sites never need to branch on "is observability on?".
 *
 * Span hierarchy created per user turn:
 *
 *   bot.turn (root trace, has userId + user message)
 *   ├── planner.llm (Groq Llama-70B call, token usage + cost)
 *   ├── verifier (Groq Llama-8B call, token usage + cost) [when gated]
 *   ├── engine.<tool_name> (the actual engine method)
 *   │   └── http.<external_api> (price/yield fetches inside the tool)
 *   └── ...
 */

import crypto from 'crypto';
import { logger } from '../utils/logger';

// Lazy-require langfuse so missing env doesn't pull in the SDK at all.
type LangfuseClient = any;
let lf: LangfuseClient | null = null;
let initAttempted = false;

function isEnabled(): boolean {
  return (
    process.env.LANGFUSE_ENABLED === '1' &&
    !!process.env.LANGFUSE_PUBLIC_KEY &&
    !!process.env.LANGFUSE_SECRET_KEY
  );
}

function getClient(): LangfuseClient | null {
  if (initAttempted) return lf;
  initAttempted = true;
  if (!isEnabled()) return null;
  try {
    // Lazy-require so the import only fires when actually enabled.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Langfuse } = require('langfuse');
    lf = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
      flushAt: 5,
      flushInterval: 5_000,
    });
    logger.info({ host: process.env.LANGFUSE_HOST ?? 'cloud.langfuse.com' }, 'langfuse tracer initialized');
    return lf;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'langfuse init failed; falling back to no-op tracer');
    return null;
  }
}

export function newTraceId(): string {
  return `trc_${crypto.randomBytes(8).toString('hex')}`;
}

export interface TraceContext {
  trace_id: string;
  user_id?: string;
  session_id?: string;
  surface: 'bot' | 'mcp' | 'api';
  user_message?: string;
}

export interface SpanLike {
  end(output?: unknown, opts?: { status?: 'ok' | 'error'; error?: string }): void;
  child(name: string, input?: unknown): SpanLike;
  /** LLM-generation child: records model + token usage on end. */
  generation(name: string, opts: { model: string; input?: unknown }): GenerationSpanLike;
  durationMs(): number;
}

export interface GenerationSpanLike extends SpanLike {
  endWithUsage(opts: {
    output?: unknown;
    usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number };
    cost_usd?: number;
  }): void;
}

function noopSpan(start: number): SpanLike {
  return {
    end: () => {},
    child: () => noopSpan(Date.now()),
    generation: () => noopGenerationSpan(Date.now()),
    durationMs: () => Date.now() - start,
  };
}

function noopGenerationSpan(start: number): GenerationSpanLike {
  return {
    end: () => {},
    child: () => noopSpan(Date.now()),
    generation: () => noopGenerationSpan(Date.now()),
    durationMs: () => Date.now() - start,
    endWithUsage: () => {},
  };
}

export function startTrace(ctx: TraceContext): SpanLike {
  const start = Date.now();
  const client = getClient();
  if (!client) return noopSpan(start);

  try {
    const trace = client.trace({
      id: ctx.trace_id,
      userId: ctx.user_id,
      sessionId: ctx.session_id,
      name: `${ctx.surface}.turn`,
      input: ctx.user_message ? { message: ctx.user_message } : undefined,
      metadata: { surface: ctx.surface },
    });
    return wrap(trace, start);
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'langfuse trace creation failed');
    return noopSpan(start);
  }
}

function wrap(parent: any, start: number): SpanLike {
  let ended = false;
  return {
    end: (output, opts) => {
      if (ended) return;
      ended = true;
      try {
        if (typeof parent.update === 'function') {
          parent.update({
            output,
            level: opts?.status === 'error' ? 'ERROR' : 'DEFAULT',
            statusMessage: opts?.error,
          });
        }
        if (typeof parent.end === 'function') parent.end();
      } catch { /* never bubble observability errors */ }
    },
    child: (name, input) => {
      try {
        const sub = typeof parent.span === 'function' ? parent.span({ name, input }) : parent;
        return wrap(sub, Date.now());
      } catch {
        return noopSpan(Date.now());
      }
    },
    generation: (name, opts) => {
      try {
        const gen = typeof parent.generation === 'function'
          ? parent.generation({ name, model: opts.model, input: opts.input })
          : parent;
        return wrapGeneration(gen, Date.now());
      } catch {
        return noopGenerationSpan(Date.now());
      }
    },
    durationMs: () => Date.now() - start,
  };
}

function wrapGeneration(gen: any, start: number): GenerationSpanLike {
  let ended = false;
  return {
    end: (output, opts) => {
      if (ended) return;
      ended = true;
      try {
        if (typeof gen.update === 'function') {
          gen.update({ output, level: opts?.status === 'error' ? 'ERROR' : 'DEFAULT' });
        }
        if (typeof gen.end === 'function') gen.end();
      } catch {}
    },
    endWithUsage: (opts) => {
      if (ended) return;
      ended = true;
      try {
        if (typeof gen.update === 'function') {
          gen.update({
            output: opts.output,
            usage: {
              input: opts.usage.input_tokens,
              output: opts.usage.output_tokens,
              total: opts.usage.input_tokens + opts.usage.output_tokens,
              inputCached: opts.usage.cached_input_tokens ?? 0,
            },
          });
        }
        if (typeof gen.end === 'function') gen.end();
      } catch {}
    },
    child: () => noopSpan(Date.now()),
    generation: () => noopGenerationSpan(Date.now()),
    durationMs: () => Date.now() - start,
  };
}

/** Flush + close the tracer on shutdown. Safe to call even when disabled. */
export async function shutdownTracer(): Promise<void> {
  if (!lf) return;
  try {
    if (typeof lf.shutdownAsync === 'function') await lf.shutdownAsync();
    else if (typeof lf.shutdown === 'function') await lf.shutdown();
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'langfuse shutdown failed');
  }
}

/** Test-only: forget the cached client so isEnabled() re-evaluates. */
export function _resetForTest(): void {
  lf = null;
  initAttempted = false;
}
