/**
 * Layer 1 — deterministic sanitizer for content arriving from external sources
 * (CoinGecko, DexScreener, Beefy, Venus, DefiLlama, Binance, etc.).
 *
 * What it does:
 *   1. Hard length cap.
 *   2. Strip control characters that confuse tokenizers / terminals.
 *   3. Redact role-token / "ignore previous" / tool-mimicry patterns.
 *
 * What it does NOT do:
 *   - Semantic injection detection (that's Layer 2 — Phase 3.5).
 *   - Verify the *intent* of a proposed action (that's Layer 3 — the
 *     verifier sub-agent in src/bot/verifier.ts).
 *
 * Use the lightest applicable function:
 *   sanitizeString  — single freeform string from an external source.
 *   wrapAsExternal  — wrap any payload in <external_data source="..."> tags;
 *                     the agent system prompt teaches the LLM to treat the
 *                     contents as data, not instructions.
 */

const ROLE_TOKEN_PATTERNS: RegExp[] = [
  /\b(system|assistant|user)\s*:/gi,                        // "System:" "user :"
  /<\|im_(?:start|end)\|>/gi,                                // OpenAI ChatML
  /<\|(?:eot|sot|bos|eos)_id\|>/gi,                          // Llama 3 special tokens
  /<\|(?:eot|sot|bos|eos)\|>/gi,                             // generic
  /\[INST\]|\[\/INST\]/g,                                    // Mistral
  /<<SYS>>|<<\/SYS>>/g,                                      // Llama 2
  /\bignore\s+(?:the\s+)?(?:previous|prior|above|earlier)\b/gi,
  /\boverride\s+(?:the\s+)?(?:previous|prior|above)\b/gi,
  /\b(?:disregard|forget)\s+(?:the\s+)?(?:previous|prior|above|all)\b/gi,
  /\b(?:execute|run|call)\s+(?:the\s+|this\s+)?\w+(?:_\w+)*\s*\(/gi,  // "call send_tokens("
  /<\/?external_data\b[^>]*>/gi,                              // spoofing our own wrapper
];

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface SanitizeOptions {
  maxLength?: number;
  source: string;          // 'dexscreener' | 'coingecko' | 'venus' | ...
  field: string;           // 'dex' | 'pool' | 'token' | ...
}

export interface SanitizedField {
  value: string;
  flagged: boolean;
  reasons: string[];       // diagnostic — what triggered each redaction
}

const REDACTED = '[REDACTED]';

export function sanitizeString(input: unknown, opts: SanitizeOptions): SanitizedField {
  const reasons: string[] = [];
  let s = String(input ?? '');

  // 1) Length cap — applied first so we never run regex over megabytes
  const cap = opts.maxLength ?? 64;
  if (s.length > cap) {
    s = s.slice(0, cap);
    reasons.push('truncated');
  }

  // 2) Control chars
  if (CONTROL_CHARS.test(s)) {
    s = s.replace(CONTROL_CHARS, '');
    reasons.push('control_chars_stripped');
  }

  // 3) Role tokens & injection patterns
  let patternsMatched = 0;
  for (const p of ROLE_TOKEN_PATTERNS) {
    if (p.test(s)) {
      s = s.replace(p, REDACTED);
      patternsMatched += 1;
      reasons.push(`pattern:${p.source.slice(0, 40)}`);
    }
  }

  return { value: s, flagged: patternsMatched > 0 || reasons.includes('control_chars_stripped'), reasons };
}

/**
 * Wrap a payload in delimited tags by source. The agent system prompt teaches
 * the LLM that anything inside <external_data> is DATA, not instructions.
 * Also strips any nested closing tag from the payload to block spoofing.
 */
export function wrapAsExternal(source: string, payload: unknown): string {
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const stripped = text.replace(/<\/?external_data\b[^>]*>/gi, '');
  return `<external_data source="${safeSource}">${stripped}</external_data>`;
}

/**
 * Convenience: sanitize a record's keys in-place, replacing each listed key
 * with the sanitized value. Returns the union of flagged-field names for
 * telemetry. Non-string fields are left alone.
 */
export function sanitizeFields<T extends Record<string, unknown>>(
  obj: T,
  source: string,
  fieldSpecs: Array<{ field: keyof T & string; maxLength?: number }>,
): { sanitized: T; flagged: string[] } {
  const out: any = { ...obj };
  const flagged: string[] = [];
  for (const spec of fieldSpecs) {
    const raw = obj[spec.field];
    if (typeof raw !== 'string') continue;
    const r = sanitizeString(raw, { source, field: spec.field, maxLength: spec.maxLength });
    out[spec.field] = r.value;
    if (r.flagged) flagged.push(spec.field);
  }
  return { sanitized: out as T, flagged };
}
