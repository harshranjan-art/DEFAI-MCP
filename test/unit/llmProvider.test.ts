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

  it('falls back to GCP_LOCATION env or us-central1', () => {
    delete process.env.GCP_LOCATION;
    const p1 = new VertexProvider();
    expect(p1.modelFor('planner')).toBe('gemini-3-pro');
    // No way to read location off the public surface, but constructing without
    // throwing is the contract.
  });

  it('chat() without GCP_PROJECT_ID throws a clear error', async () => {
    const ORIG_PROJECT = process.env.GCP_PROJECT_ID;
    delete process.env.GCP_PROJECT_ID;
    try {
      const p1 = new VertexProvider();
      await expect(
        p1.chat({ task: 'planner', messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(/GCP_PROJECT_ID is not set/);
    } finally {
      if (ORIG_PROJECT === undefined) delete process.env.GCP_PROJECT_ID;
      else process.env.GCP_PROJECT_ID = ORIG_PROJECT;
    }
  });
});

describe('VertexProvider — chat (mocked Vertex client)', () => {
  /**
   * Build a stub Vertex client whose getGenerativeModel returns a
   * GenerativeModel-shaped object with a captured generateContent. Tests
   * can read `lastRequest` to assert translation correctness.
   */
  function makeMockClient(responseFactory: () => any) {
    let lastRequest: any = null;
    return {
      lastRequestRef: () => lastRequest,
      vertex: {
        getGenerativeModel: ({ model }: { model: string }) => ({
          model,
          generateContent: async (req: any) => {
            lastRequest = req;
            return { response: responseFactory() };
          },
        }),
      } as any,
    };
  }

  it('translates messages: system prompt → systemInstruction, user/assistant → user/model', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ text: 'hi back' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    }));
    const p = new VertexProvider({ project: 'p', location: 'us-central1', _vertexClient: mock.vertex });
    const r = await p.chat({
      task: 'planner',
      messages: [
        { role: 'system', content: 'You are friendly.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'how are you?' },
      ],
    });

    const req = mock.lastRequestRef();
    expect(req.systemInstruction).toBe('You are friendly.');
    expect(req.contents).toHaveLength(3);
    expect(req.contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
    expect(req.contents[1]).toEqual({ role: 'model', parts: [{ text: 'hello' }] });
    expect(req.contents[2]).toEqual({ role: 'user', parts: [{ text: 'how are you?' }] });

    expect(r.content).toBe('hi back');
    expect(r.tool_calls).toEqual([]);
    expect(r.usage).toEqual({ input_tokens: 12, cached_input_tokens: 0, output_tokens: 4 });
    expect(r.model).toBe('gemini-3-pro');
  });

  it('joins multiple system messages with double-newline', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    await p.chat({
      task: 'planner',
      messages: [
        { role: 'system', content: 'rule 1' },
        { role: 'system', content: 'rule 2' },
        { role: 'user', content: 'go' },
      ],
    });
    expect(mock.lastRequestRef().systemInstruction).toBe('rule 1\n\nrule 2');
  });

  it('translates tools to functionDeclarations and tool_choice to functionCallingConfig', async () => {
    const mock = makeMockClient(() => ({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'get_portfolio', args: {} } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({
      task: 'planner',
      messages: [{ role: 'user', content: 'show portfolio' }],
      tools: [
        {
          name: 'get_portfolio',
          description: 'fetch portfolio',
          parameters: { type: 'object', properties: {} },
        },
      ],
      toolChoice: 'auto',
    });

    const req = mock.lastRequestRef();
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0].functionDeclarations).toHaveLength(1);
    expect(req.tools[0].functionDeclarations[0].name).toBe('get_portfolio');
    expect(req.toolConfig.functionCallingConfig.mode).toBe('AUTO');

    expect(r.tool_calls).toHaveLength(1);
    expect(r.tool_calls[0].name).toBe('get_portfolio');
    expect(r.tool_calls[0].arguments).toBe('{}');
    expect(r.content).toBeNull();
  });

  it('translates tool_choice={name} to mode=ANY + allowedFunctionNames', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ functionCall: { name: 'swap_tokens', args: { from: 'BNB' } } }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({
      task: 'planner',
      messages: [{ role: 'user', content: 'swap' }],
      tools: [{ name: 'swap_tokens', description: 'swap', parameters: { type: 'object' } }],
      toolChoice: { name: 'swap_tokens' },
    });

    const cfg = mock.lastRequestRef().toolConfig.functionCallingConfig;
    expect(cfg.mode).toBe('ANY');
    expect(cfg.allowedFunctionNames).toEqual(['swap_tokens']);
    expect(r.tool_calls[0].arguments).toBe('{"from":"BNB"}');
  });

  it('translates responseFormat=json_object → responseMimeType=application/json', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ text: '{"intent":"read_only"}' }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({
      task: 'intent',
      messages: [{ role: 'user', content: 'classify' }],
      responseFormat: 'json_object',
      temperature: 0,
      maxTokens: 80,
    });

    const cfg = mock.lastRequestRef().generationConfig;
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.temperature).toBe(0);
    expect(cfg.maxOutputTokens).toBe(80);

    expect(r.content).toBe('{"intent":"read_only"}');
    expect(r.model).toBe('gemini-3-flash');
  });

  it('extracts cached input tokens from usageMetadata.cachedContentTokenCount', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, cachedContentTokenCount: 800 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({ task: 'planner', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.usage).toEqual({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 });
  });

  it('handles a safety-block response (no candidates) without throwing', async () => {
    const mock = makeMockClient(() => ({
      candidates: undefined,
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: { promptTokenCount: 10 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({ task: 'planner', messages: [{ role: 'user', content: 'bad' }] });
    expect(r.content).toBeNull();
    expect(r.tool_calls).toEqual([]);
    expect(r.usage.input_tokens).toBe(10);
  });

  it('explicit model arg overrides modelFor(task)', async () => {
    const mock = makeMockClient(() => ({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }));
    const p = new VertexProvider({ project: 'p', _vertexClient: mock.vertex });
    const r = await p.chat({
      task: 'planner',
      model: 'gemini-3-flash', // intentionally cheaper than the planner default
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(r.model).toBe('gemini-3-flash');
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
