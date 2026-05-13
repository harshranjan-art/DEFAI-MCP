/**
 * Conversation summarizer — compresses older turns into a single context
 * block at the head of the history. Runs on the cheap fast-class model
 * (Llama-3.1-8B-Instant on Groq, Gemini 3 Flash on Vertex).
 *
 * Why: agentRouter's per-user history is capped at MAX_HISTORY messages
 * (Phase 0 — 10 turns, Phase 6.5 — 30 turns). Hard truncation drops
 * everything past the cap and loses user-stated preferences, pending
 * confirmations, and prior decisions. A summary preserves the load-bearing
 * facts at ~280 tokens for fractions of a cent per summarization.
 *
 * Fail-soft: if the LLM call fails, we return null and the caller falls
 * back to hard truncation. Observability picks up the warn.
 *
 * Provider-agnostic since Phase 7A. Routes through LLMProvider (Groq today,
 * Vertex after Phase 7B); model selection lives inside the provider.
 */

import { getLLMProvider } from '../llm';
import type { LLMProvider } from '../llm';
import { logger } from '../utils/logger';
import { recordCost } from '../observability/cost';

const SYSTEM_PROMPT = `You are a conversation summarizer for a DeFi trading assistant. Compress the user-assistant exchange into a brief context summary that preserves:
- the user's stated goals, risk preferences, and any explicit instructions
- decisions made and tools called (with amounts, tokens, addresses, outcomes)
- pending confirmations or next actions awaiting user input

Output: 4-8 bullet points, total <= 280 tokens. No prose preamble.`;

export interface SummarizerMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SummarizeOptions {
  /** Inject an LLMProvider stub for tests. */
  providerOverride?: LLMProvider;
  /** When set, fires cost-tracking with this trace_id + user_id. */
  trace_id?: string;
  user_id?: string;
}

/**
 * Summarize a list of older conversation messages. Returns null on any error
 * so callers can fall back to hard truncation; never throws.
 */
export async function summarizeMessages(
  messages: SummarizerMessage[],
  opts: SummarizeOptions = {},
): Promise<string | null> {
  if (messages.length === 0) return '';
  const provider = opts.providerOverride ?? getLLMProvider();

  const corpus = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

  try {
    const result = await provider.chat({
      task: 'summarizer',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: corpus },
      ],
      temperature: 0,
      maxTokens: 320,
    });
    const summary = result.content?.trim() ?? '';
    if (!summary) return null;

    if (opts.trace_id) {
      recordCost({
        trace_id: opts.trace_id,
        user_id: opts.user_id,
        model: result.model,
        task: 'summarizer',
        input_tokens: result.usage.input_tokens,
        input_cached_tokens: result.usage.cached_input_tokens,
        output_tokens: result.usage.output_tokens,
      });
    }

    return summary;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'summarizer call failed; falling back to truncation');
    return null;
  }
}
