/**
 * Mock helpers for the eval suite.
 *
 * - mockFetch: install a per-URL response map so eval cases run deterministically
 *   without hitting CoinGecko / DexScreener / etc.
 * - mockGroq: stub the Groq SDK client so the agent's planner returns a
 *   canned tool_call. Used in tests; production `npm run eval` uses real Groq.
 */

import { vi } from 'vitest';

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
 * Build a stub Groq client that returns a canned response for the next
 * chat.completions.create call. Used in tests of the runner + judge.
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
