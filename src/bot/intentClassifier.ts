/**
 * Intent classifier — 8B-Instant call that labels the user's incoming
 * message before the planner runs. Routing tier:
 *
 *   intent='read_only' + high confidence  → cheaper 70B planner variant
 *   intent='write' OR low confidence       → flagship 70B planner
 *   intent='meta'                          → cheaper 70B planner
 *   intent='ambiguous'                     → flagship 70B planner
 *
 * The classifier itself runs on Llama-3.1-8B-Instant (~$0.0001/turn).
 * Even if it routes incorrectly, the actual answer quality is gated by
 * the eval suite — see refactor-plan/phase-6-optimizations.md task 6.2.
 *
 * Fail-soft: classifier errors return ambiguous → flagship; we never let
 * an observability failure downgrade the planner.
 */

import Groq from 'groq-sdk';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { recordCost } from '../observability/cost';

export const INTENT_MODEL = 'llama-3.1-8b-instant';

const IntentSchema = z.object({
  intent: z.enum(['read_only', 'write', 'meta', 'ambiguous']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(120).optional(),
});

export type IntentVerdict = z.infer<typeof IntentSchema>;

const SYSTEM_PROMPT = `Classify the user's message for a DeFi trading assistant. Return JSON only.

Intents:
- read_only: balance / portfolio / trade history / market data / "what is X". No funds move.
- write: swap / send / deposit / withdraw / rotate / open or close position / start or stop arb session. Funds move.
- meta: configure risk / set alerts / link telegram. No funds move, but config changes.
- ambiguous: cannot tell without asking.

JSON schema (no other fields):
{"intent": "read_only"|"write"|"meta"|"ambiguous", "confidence": 0..1, "reason": "<=120 chars"}`;

const AMBIGUOUS_FALLBACK: IntentVerdict = {
  intent: 'ambiguous',
  confidence: 0,
  reason: 'classifier failed; defaulting to ambiguous',
};

export interface ClassifyOptions {
  /** Inject a Groq stub for tests. */
  groqOverride?: Pick<Groq, 'chat'>;
  trace_id?: string;
  user_id?: string;
}

let cachedGroq: Groq | null = null;
function getGroqClient(): Groq {
  if (cachedGroq) return cachedGroq;
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — intent classifier disabled');
  }
  cachedGroq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return cachedGroq;
}

export async function classifyIntent(message: string, opts: ClassifyOptions = {}): Promise<IntentVerdict> {
  if (!message || message.trim().length === 0) return AMBIGUOUS_FALLBACK;

  const client = opts.groqOverride ?? getGroqClient();

  let raw: string;
  try {
    const completion = await client.chat.completions.create({
      model: INTENT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message.slice(0, 1024) },
      ],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
    });
    raw = completion.choices?.[0]?.message?.content ?? '';

    if (opts.trace_id) {
      const usage = (completion as any).usage;
      if (usage) {
        recordCost({
          trace_id: opts.trace_id,
          user_id: opts.user_id,
          model: INTENT_MODEL,
          task: 'intent',
          input_tokens: usage.prompt_tokens ?? 0,
          input_cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
        });
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'intent classifier call failed; defaulting to ambiguous');
    return AMBIGUOUS_FALLBACK;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw }, 'intent classifier output not valid JSON');
    return AMBIGUOUS_FALLBACK;
  }
  const result = IntentSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues }, 'intent classifier output failed schema');
    return AMBIGUOUS_FALLBACK;
  }
  return result.data;
}

/**
 * Map a classified intent + confidence to the planner model to use.
 * Cheap variant only fires when we're confident the intent is read_only or
 * meta — anything ambiguous or write-y goes to the flagship model.
 */
export function pickPlannerModel(verdict: IntentVerdict): string {
  const CHEAP = 'llama-3.1-70b-versatile';
  const FLAGSHIP = 'llama-3.3-70b-versatile';
  if (verdict.confidence < 0.7) return FLAGSHIP;
  if (verdict.intent === 'read_only' || verdict.intent === 'meta') return CHEAP;
  return FLAGSHIP;
}
