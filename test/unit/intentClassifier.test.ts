import { describe, it, expect } from 'vitest';
import { classifyIntent, pickPlannerModel } from '../../src/bot/intentClassifier';
import { stubProvider } from '../../evals/helpers/mocks';

describe('classifyIntent — happy paths', () => {
  it('parses a well-formed read_only verdict', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ intent: 'read_only', confidence: 0.95, reason: 'asking for portfolio' }),
    });
    const v = await classifyIntent('show me my portfolio', { providerOverride });
    expect(v.intent).toBe('read_only');
    expect(v.confidence).toBe(0.95);
  });

  it('parses a write verdict', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ intent: 'write', confidence: 0.88, reason: 'swap request' }),
    });
    const v = await classifyIntent('swap 1 BNB to USDT', { providerOverride });
    expect(v.intent).toBe('write');
  });
});

describe('classifyIntent — fail-soft', () => {
  it('returns ambiguous on empty input (no LLM call)', async () => {
    const v = await classifyIntent('');
    expect(v.intent).toBe('ambiguous');
    expect(v.confidence).toBe(0);
  });

  it('returns ambiguous when the provider throws', async () => {
    const providerOverride = stubProvider({ throwError: 'network unreachable' });
    const v = await classifyIntent('something', { providerOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when output is not valid JSON', async () => {
    const providerOverride = stubProvider({ content: 'not json' });
    const v = await classifyIntent('something', { providerOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when JSON misses required fields', async () => {
    const providerOverride = stubProvider({ content: JSON.stringify({ confidence: 0.9 }) });
    const v = await classifyIntent('something', { providerOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when intent value is out of enum', async () => {
    const providerOverride = stubProvider({
      content: JSON.stringify({ intent: 'NUKE_LAUNCH', confidence: 1, reason: 'broken' }),
    });
    const v = await classifyIntent('something', { providerOverride });
    expect(v.intent).toBe('ambiguous');
  });
});

describe('pickPlannerModel — Groq routing', () => {
  const groq = stubProvider({ name: 'groq' });

  it('routes high-confidence read_only to the cheap variant', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.9 }, groq)).toBe('llama-3.1-70b-versatile');
  });

  it('routes high-confidence meta to the cheap variant', () => {
    expect(pickPlannerModel({ intent: 'meta', confidence: 0.85 }, groq)).toBe('llama-3.1-70b-versatile');
  });

  it('routes write to the flagship regardless of confidence', () => {
    expect(pickPlannerModel({ intent: 'write', confidence: 0.99 }, groq)).toBe('llama-3.3-70b-versatile');
  });

  it('routes ambiguous to the flagship', () => {
    expect(pickPlannerModel({ intent: 'ambiguous', confidence: 0.99 }, groq)).toBe('llama-3.3-70b-versatile');
  });

  it('escalates low-confidence read_only to the flagship', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.5 }, groq)).toBe('llama-3.3-70b-versatile');
  });

  it('threshold is 0.7 — at the boundary, route cheap', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.7 }, groq)).toBe('llama-3.1-70b-versatile');
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.69 }, groq)).toBe('llama-3.3-70b-versatile');
  });
});

describe('pickPlannerModel — Vertex routing (Gemini 3)', () => {
  const vertex = stubProvider({ name: 'vertex' });

  it('routes high-confidence read_only to Gemini 3 Flash', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.9 }, vertex)).toBe('gemini-3-flash');
  });

  it('routes high-confidence meta to Gemini 3 Flash', () => {
    expect(pickPlannerModel({ intent: 'meta', confidence: 0.85 }, vertex)).toBe('gemini-3-flash');
  });

  it('routes write to Gemini 3 Pro regardless of confidence', () => {
    expect(pickPlannerModel({ intent: 'write', confidence: 0.99 }, vertex)).toBe('gemini-3-pro');
  });

  it('escalates low-confidence read_only to Gemini 3 Pro', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.5 }, vertex)).toBe('gemini-3-pro');
  });
});
