/**
 * Mock helpers for the eval suite and unit tests.
 *
 * - mockFetch: install a per-URL response map so eval cases run deterministically
 *   without hitting CoinGecko / DexScreener / etc.
 * - stubProvider: return a fake LLMProvider that yields a canned response.
 *   Replaces the Phase 6.5-era `stubGroq` (kept for backward compat below).
 */

import { vi } from 'vitest';
import type { LLMProvider, LLMTask } from '../../src/llm';

export interface FetchHandler {
  (url: string): unknown | undefined;
}

let originalFetch: typeof global.fetch | undefined;

export function mockFetch(handlers: FetchHandler[]): void {
  if (!originalFetch) originalFetch = global.fetch;
  global.fetch = vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    for (const h of handlers) {
      const result = h(url);
      if (result !== undefined) {
        return new Response(typeof result === 'string' ? result : JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`mockFetch: no handler matched url=${url}`);
  }) as any;
}

export function restoreFetch(): void {
  if (originalFetch) {
    global.fetch = originalFetch;
    originalFetch = undefined;
  }
}

/**
 * Build a stub LLMProvider that returns a canned response. Used in every
 * unit test of code that hits an LLM.
 *
 * Behavior:
 *   - If `toolCall` is set: the response has one tool_call, content=null.
 *   - Otherwise: content=`content` (default ''), no tool_calls.
 *   - Usage fields default to 0 — pass `usage` to exercise cost tracking.
 *   - `throwError` makes `chat()` reject with `new Error(throwError)`.
 *
 * The provider's `name` defaults to 'groq' (so cost-tracking and routing
 * logic see a Groq-shaped world). Pass `name:'vertex'` to test the Vertex
 * branch of provider-aware code (e.g. pickPlannerModel).
 */
export interface ProviderStubOptions {
  toolCall?: { name: string; arguments: Record<string, unknown> };
  content?: string;
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  throwError?: string;
  model?: string;
  name?: 'groq' | 'vertex';
}

export function stubProvider(opts: ProviderStubOptions = {}): LLMProvider {
  const model = opts.model ?? 'test-stub';
  const name = opts.name ?? 'groq';
  return {
    name,
    modelFor: (_task: LLMTask) => model,
    chat: vi.fn(async () => {
      if (opts.throwError) throw new Error(opts.throwError);
      return {
        content: opts.toolCall ? null : opts.content ?? '',
        tool_calls: opts.toolCall
          ? [{ name: opts.toolCall.name, arguments: JSON.stringify(opts.toolCall.arguments) }]
          : [],
        usage: {
          input_tokens: opts.usage?.input_tokens ?? 0,
          cached_input_tokens: opts.usage?.cached_input_tokens ?? 0,
          output_tokens: opts.usage?.output_tokens ?? 0,
        },
        model,
      };
    }),
  };
}

/**
 * @deprecated Use `stubProvider()` instead — the LLMProvider abstraction
 * (Phase 7A) replaces direct Groq SDK stubbing. Kept here only so any
 * out-of-tree code that imported this helper doesn't break.
 */
export interface GroqStubOptions {
  toolCall?: { name: string; arguments: Record<string, unknown> };
  content?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens: number } };
}

export function stubGroq(opts: GroqStubOptions): any {
  const message: any = opts.toolCall
    ? {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_test',
            type: 'function',
            function: {
              name: opts.toolCall.name,
              arguments: JSON.stringify(opts.toolCall.arguments),
            },
          },
        ],
      }
    : { role: 'assistant', content: opts.content ?? '' };

  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message }],
          usage: opts.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
        })),
      },
    },
  };
}
