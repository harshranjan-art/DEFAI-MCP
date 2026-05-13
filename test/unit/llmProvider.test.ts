/**
 * Tests for the LLMProvider abstraction (Phase 7A).
 *
 * Covers:
 *   - Factory respects LLM_PROVIDER env var
 *   - Singleton caching + reset
 *   - GroqProvider model resolution per task
 *   - VertexProvider model resolution per task + Phase 7A scaffold throw
 *   - Unknown providers fail fast
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  GroqProvider,
  VertexProvider,
  GROQ_PLANNER_FLAGSHIP,
  GROQ_FAST,
  VERTEX_PLANNER_MODEL,
  VERTEX_FAST_MODEL,
  _resetLLMProvider,
  getLLMProvider,
} from '../../src/llm';

const ORIG_PROVIDER = process.env.LLM_PROVIDER;

afterEach(() => {
  _resetLLMProvider();
  if (ORIG_PROVIDER === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = ORIG_PROVIDER;
});

beforeEach(() => {
  _resetLLMProvider();
});

describe('getLLMProvider — factory', () => {
  it('defaults to GroqProvider when LLM_PROVIDER is unset', () => {
    delete process.env.LLM_PROVIDER;
    const p = getLLMProvider();
    expect(p.name).toBe('groq');
    expect(p).toBeInstanceOf(GroqProvider);
  });

  it('returns VertexProvider when LLM_PROVIDER=vertex', () => {
    process.env.LLM_PROVIDER = 'vertex';
    const p = getLLMProvider();
    expect(p.name).toBe('vertex');
    expect(p).toBeInstanceOf(VertexProvider);
  });

  it('is case-insensitive', () => {
    process.env.LLM_PROVIDER = 'VERTEX';
    const p = getLLMProvider();
    expect(p.name).toBe('vertex');
  });

  it('singleton-caches the provider', () => {
    delete process.env.LLM_PROVIDER;
    const p1 = getLLMProvider();
    const p2 = getLLMProvider();
    expect(p1).toBe(p2);
  });

  it('throws on unknown LLM_PROVIDER value', () => {
    process.env.LLM_PROVIDER = 'cohere';
    expect(() => getLLMProvider()).toThrow(/Unsupported LLM_PROVIDER/);
  });

  it('_resetLLMProvider() clears the cache so env changes take effect', () => {
    delete process.env.LLM_PROVIDER;
    expect(getLLMProvider().name).toBe('groq');
    process.env.LLM_PROVIDER = 'vertex';
    // Without reset, the cached groq provider is returned.
    expect(getLLMProvider().name).toBe('groq');
    _resetLLMProvider();
    expect(getLLMProvider().name).toBe('vertex');
  });
});

describe('GroqProvider — modelFor', () => {
  const p = new GroqProvider();

  it('routes planner + judge to the flagship 70B model', () => {
    expect(p.modelFor('planner')).toBe(GROQ_PLANNER_FLAGSHIP);
    expect(p.modelFor('judge')).toBe(GROQ_PLANNER_FLAGSHIP);
    expect(p.modelFor('planner')).toBe('llama-3.3-70b-versatile');
  });

  it('routes verifier / classifier / summarizer / intent to the fast 8B model', () => {
    expect(p.modelFor('verifier')).toBe(GROQ_FAST);
    expect(p.modelFor('classifier')).toBe(GROQ_FAST);
    expect(p.modelFor('summarizer')).toBe(GROQ_FAST);
    expect(p.modelFor('intent')).toBe(GROQ_FAST);
    expect(p.modelFor('verifier')).toBe('llama-3.1-8b-instant');
  });
});

describe('VertexProvider — modelFor', () => {
  const p = new VertexProvider({ project: 'test-project', location: 'us-central1' });

  it('routes planner + judge to Gemini 3 Pro', () => {
    expect(p.modelFor('planner')).toBe(VERTEX_PLANNER_MODEL);
    expect(p.modelFor('judge')).toBe(VERTEX_PLANNER_MODEL);
    expect(p.modelFor('planner')).toBe('gemini-3-pro');
  });

  it('routes verifier / classifier / summarizer / intent to Gemini 3 Flash', () => {
    expect(p.modelFor('verifier')).toBe(VERTEX_FAST_MODEL);
    expect(p.modelFor('classifier')).toBe(VERTEX_FAST_MODEL);
    expect(p.modelFor('summarizer')).toBe(VERTEX_FAST_MODEL);
    expect(p.modelFor('intent')).toBe(VERTEX_FAST_MODEL);
    expect(p.modelFor('verifier')).toBe('gemini-3-flash');
  });

  it('chat() throws a Phase 7B-pending error (scaffold)', async () => {
    await expect(
      p.chat({
        task: 'planner',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/Phase 7A scaffold|Phase 7B/);
  });

  it('falls back to GCP_LOCATION env or us-central1', () => {
    delete process.env.GCP_LOCATION;
    const p1 = new VertexProvider();
    expect(p1.modelFor('planner')).toBe('gemini-3-pro');
    // No way to read location off the public surface, but constructing without
    // throwing is the contract.
  });
});

describe('GroqProvider — chat without GROQ_API_KEY throws on call, not construct', () => {
  const ORIG_KEY = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = ORIG_KEY;
  });

  it('construction is safe (so modelFor + name accessors work in tests)', () => {
    delete process.env.GROQ_API_KEY;
    const p = new GroqProvider();
    expect(p.name).toBe('groq');
    expect(p.modelFor('planner')).toBe('llama-3.3-70b-versatile');
  });

  it('chat() throws with a clear message when GROQ_API_KEY is unset', async () => {
    delete process.env.GROQ_API_KEY;
    const p = new GroqProvider();
    await expect(
      p.chat({ task: 'planner', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/GROQ_API_KEY is not set/);
  });
});
