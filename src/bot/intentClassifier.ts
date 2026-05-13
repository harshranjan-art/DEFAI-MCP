/**
 * Intent classifier — fast small-model call that labels the user's incoming
 * message before the planner runs. Routing tier:
 *
 *   intent='read_only' + high confidence  → cheap planner variant
 *   intent='write' OR low confidence       → flagship planner
 *   intent='meta'                          → cheap planner
 *   intent='ambiguous'                     → flagship planner
 *
 * The classifier runs on Llama-3.1-8B-Instant (Groq) or Gemini 3 Flash
 * (Vertex) — both ~$0.0001/turn. Even if it routes incorrectly, the actual
 * answer quality is gated by the eval suite — see refactor-plan/phase-6-optimizations.md task 6.2.
 *
 * Fail-soft: classifier errors return ambiguous → flagship; we never let
 * an observability failure downgrade the planner.
 *
 * Provider-agnostic since Phase 7A.
 */

import { z } from 'zod';
import { getLLMProvider } from '../llm';
import type { LLMProvider } from '../llm';
import { logger } from '../utils/logger';
import { recordCost } from '../observability/cost';

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
  /** Inject an LLMProvider stub for tests. */
  providerOverride?: LLMProvider;
  trace_id?: string;
  user_id?: string;
}

export async function classifyIntent(message: string, opts: ClassifyOptions = {}): Promise<IntentVerdict> {
  if (!message || message.trim().length === 0) return AMBIGUOUS_FALLBACK;

  const provider = opts.providerOverride ?? getLLMProvider();

  let raw: string;
  let resolvedModel: string;
  try {
    const result = await provider.chat({
      task: 'intent',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message.slice(0, 1024) },
      ],
      temperature: 0,
      maxTokens: 80,
      responseFormat: 'json_object',
    });
    raw = result.content ?? '';
    resolvedModel = result.model;

    if (opts.trace_id) {
      recordCost({
        trace_id: opts.trace_id,
        user_id: opts.user_id,
        model: result.model,
        task: 'intent',
        input_tokens: result.usage.input_tokens,
        input_cached_tokens: result.usage.cached_input_tokens,
        output_tokens: result.usage.output_tokens,
      });
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'intent classifier call failed; defaulting to ambiguous');
    return AMBIGUOUS_FALLBACK;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw, model: resolvedModel }, 'intent classifier output not valid JSON');
    return AMBIGUOUS_FALLBACK;
  }
  const result = IntentSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues, model: resolvedModel }, 'intent classifier output failed schema');
    return AMBIGUOUS_FALLBACK;
  }
  return result.data;
}

/**
 * Map a classified intent + confidence to the planner model to use.
 * Cheap variant only fires when we're confident the intent is read_only or
 * meta — anything ambiguous or write-y goes to the flagship model.
 *
 * Provider-aware:
 *   - Groq:   cheap = Llama 70B-versatile (legacy), flagship = Llama 3.3 70B-versatile
 *   - Vertex: cheap = Gemini 3 Flash,             flagship = Gemini 3 Pro
 *
 * Returning concrete model IDs (vs an abstract tier label) keeps the cost
 * tracker and tracer tags accurate without an extra resolution step.
 */
export function pickPlannerModel(verdict: IntentVerdict, provider: LLMProvider): string {
  const wantCheap =
    verdict.confidence >= 0.7 && (verdict.intent === 'read_only' || verdict.intent === 'meta');
  if (provider.name === 'groq') {
    return wantCheap ? 'llama-3.1-70b-versatile' : 'llama-3.3-70b-versatile';
  }
  return wantCheap ? 'gemini-3-flash' : 'gemini-3-pro';
}
