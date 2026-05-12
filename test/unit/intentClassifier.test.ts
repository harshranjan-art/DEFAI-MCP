import { describe, it, expect } from 'vitest';
import { classifyIntent, pickPlannerModel } from '../../src/bot/intentClassifier';
import { stubGroq } from '../../evals/helpers/mocks';

describe('classifyIntent — happy paths', () => {
  it('parses a well-formed read_only verdict', async () => {
    const groqOverride = stubGroq({
      content: JSON.stringify({ intent: 'read_only', confidence: 0.95, reason: 'asking for portfolio' }),
    });
    const v = await classifyIntent('show me my portfolio', { groqOverride });
    expect(v.intent).toBe('read_only');
    expect(v.confidence).toBe(0.95);
  });

  it('parses a write verdict', async () => {
    const groqOverride = stubGroq({
      content: JSON.stringify({ intent: 'write', confidence: 0.88, reason: 'swap request' }),
    });
    const v = await classifyIntent('swap 1 BNB to USDT', { groqOverride });
    expect(v.intent).toBe('write');
  });
});

describe('classifyIntent — fail-soft', () => {
  it('returns ambiguous on empty input (no LLM call)', async () => {
    const v = await classifyIntent('');
    expect(v.intent).toBe('ambiguous');
    expect(v.confidence).toBe(0);
  });

  it('returns ambiguous when Groq throws', async () => {
    const groqOverride = {
      chat: {
        completions: {
          create: async () => { throw new Error('network unreachable'); },
        },
      },
    } as any;
    const v = await classifyIntent('something', { groqOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when output is not valid JSON', async () => {
    const groqOverride = stubGroq({ content: 'not json' });
    const v = await classifyIntent('something', { groqOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when JSON misses required fields', async () => {
    const groqOverride = stubGroq({ content: JSON.stringify({ confidence: 0.9 }) });
    const v = await classifyIntent('something', { groqOverride });
    expect(v.intent).toBe('ambiguous');
  });

  it('returns ambiguous when intent value is out of enum', async () => {
    const groqOverride = stubGroq({
      content: JSON.stringify({ intent: 'NUKE_LAUNCH', confidence: 1, reason: 'broken' }),
    });
    const v = await classifyIntent('something', { groqOverride });
    expect(v.intent).toBe('ambiguous');
  });
});

describe('pickPlannerModel', () => {
  it('routes high-confidence read_only to the cheap variant', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.9 })).toBe('llama-3.1-70b-versatile');
  });

  it('routes high-confidence meta to the cheap variant', () => {
    expect(pickPlannerModel({ intent: 'meta', confidence: 0.85 })).toBe('llama-3.1-70b-versatile');
  });

  it('routes write to the flagship regardless of confidence', () => {
    expect(pickPlannerModel({ intent: 'write', confidence: 0.99 })).toBe('llama-3.3-70b-versatile');
  });

  it('routes ambiguous to the flagship', () => {
    expect(pickPlannerModel({ intent: 'ambiguous', confidence: 0.99 })).toBe('llama-3.3-70b-versatile');
  });

  it('escalates low-confidence read_only to the flagship', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.5 })).toBe('llama-3.3-70b-versatile');
  });

  it('threshold is 0.7 — at the boundary, route cheap', () => {
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.7 })).toBe('llama-3.1-70b-versatile');
    expect(pickPlannerModel({ intent: 'read_only', confidence: 0.69 })).toBe('llama-3.3-70b-versatile');
  });
});
