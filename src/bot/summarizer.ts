/**
 * Conversation summarizer — compresses older turns into a single context
 * block at the head of the history. Runs on the cheap 8B model.
 *
 * Why: agentRouter's per-user history is capped at MAX_HISTORY messages
 * (Phase 0 — 10 turns). Hard truncation drops everything past the cap and
 * loses user-stated preferences, pending confirmations, and prior decisions.
 * A summary preserves the load-bearing facts at ~280 tokens for ~$0.000015
 * per summarization (Llama-3.1-8B-Instant at 2026 pricing).
 *
 * Fail-soft: if the summarizer Groq call fails, we return null and the
 * caller falls back to hard truncation. Observability picks up the warn.
 */

import Groq from 'groq-sdk';
import { logger } from '../utils/logger';
import { recordCost } from '../observability/cost';

export const SUMMARIZER_MODEL = 'llama-3.1-8b-instant';

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
  /** Inject a Groq stub for tests. */
  groqOverride?: Pick<Groq, 'chat'>;
  /** When set, fires cost-tracking with this trace_id + user_id. */
  trace_id?: string;
  user_id?: string;
}

let cachedGroq: Groq | null = null;
function getGroqClient(): Groq {
  if (cachedGroq) return cachedGroq;
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — summarizer disabled');
  }
  cachedGroq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return cachedGroq;
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
  const client = opts.groqOverride ?? getGroqClient();

  const corpus = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

  try {
    const completion = await client.chat.completions.create({
      model: SUMMARIZER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: corpus },
      ],
      temperature: 0,
      max_tokens: 320,
    });
    const summary = completion.choices?.[0]?.message?.content?.trim() ?? '';
    if (!summary) return null;

    if (opts.trace_id) {
      const usage = (completion as any).usage;
      if (usage) {
        recordCost({
          trace_id: opts.trace_id,
          user_id: opts.user_id,
          model: SUMMARIZER_MODEL,
          task: 'summarizer',
          input_tokens: usage.prompt_tokens ?? 0,
          input_cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
        });
      }
    }

    return summary;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'summarizer call failed; falling back to truncation');
    return null;
  }
}
