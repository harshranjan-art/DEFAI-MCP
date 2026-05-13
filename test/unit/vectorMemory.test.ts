/**
 * Tests for Phase 7D episodic memory.
 *
 * Covers:
 *   - StubEmbedder is deterministic + L2-normalized
 *   - Identical text → identical vector; different text → different vector
 *   - Shared tokens → higher cosine similarity than disjoint tokens
 *   - cosineSimilarity edge cases (zero, mismatched, same direction)
 *   - remember + recall happy path + topK truncation
 *   - remember is fail-soft (empty content, embedder throws → no entry stored)
 *   - recall is fail-soft (empty store, empty query)
 *   - getEmbedder factory respects VECTOR_MEMORY_PROVIDER
 *   - MAX_PER_USER cap evicts oldest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  StubEmbedder,
  cosineSimilarity,
  remember,
  recall,
  getEmbedder,
  _resetEmbedder,
  _clearMemory,
  _peekMemory,
} from '../../src/utils/vectorMemory';

const SAVED_VECTOR_PROVIDER = process.env.VECTOR_MEMORY_PROVIDER;
const SAVED_LLM_PROVIDER = process.env.LLM_PROVIDER;
const SAVED_GCP_PROJECT = process.env.GCP_PROJECT_ID;

beforeEach(() => {
  delete process.env.VECTOR_MEMORY_PROVIDER;
  delete process.env.LLM_PROVIDER;
  delete process.env.GCP_PROJECT_ID;
  _resetEmbedder();
  _clearMemory();
});

afterEach(() => {
  if (SAVED_VECTOR_PROVIDER === undefined) delete process.env.VECTOR_MEMORY_PROVIDER;
  else process.env.VECTOR_MEMORY_PROVIDER = SAVED_VECTOR_PROVIDER;
  if (SAVED_LLM_PROVIDER === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = SAVED_LLM_PROVIDER;
  if (SAVED_GCP_PROJECT === undefined) delete process.env.GCP_PROJECT_ID;
  else process.env.GCP_PROJECT_ID = SAVED_GCP_PROJECT;
  _resetEmbedder();
  _clearMemory();
});

describe('StubEmbedder', () => {
  const embedder = new StubEmbedder();

  it('produces a 768-dim vector', async () => {
    const v = await embedder.embed('hello world');
    expect(v).toHaveLength(768);
  });

  it('is deterministic: same text → same vector', async () => {
    const v1 = await embedder.embed('the quick brown fox');
    const v2 = await embedder.embed('the quick brown fox');
    expect(v1).toEqual(v2);
  });

  it('produces L2-normalized vectors', async () => {
    const v = await embedder.embed('venus apy is high right now');
    let normSq = 0;
    for (const x of v) normSq += x * x;
    expect(normSq).toBeCloseTo(1, 5);
  });

  it('different texts produce different vectors', async () => {
    const a = await embedder.embed('venus yield deposit');
    const b = await embedder.embed('pancake swap arbitrage');
    expect(a).not.toEqual(b);
  });

  it('texts sharing tokens are more similar than disjoint texts', async () => {
    const a = await embedder.embed('venus yield BNB deposit');
    const sharedTokens = await embedder.embed('venus yield BNB withdraw');
    const disjoint = await embedder.embed('biswap arbitrage opportunity USDT');
    const simShared = cosineSimilarity(a, sharedTokens);
    const simDisjoint = cosineSimilarity(a, disjoint);
    expect(simShared).toBeGreaterThan(simDisjoint);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for length-mismatched vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for zero vector input', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
  });
});

describe('remember + recall', () => {
  it('returns recorded content for a matching query', async () => {
    await remember('alice', 'I prefer Venus over Beefy for low-risk yield');
    await remember('alice', 'PancakeSwap fees are too high for small swaps');
    const r = await recall('alice', 'which yield protocol do I like?');
    expect(r).toContain('Venus');
  });

  it('respects topK', async () => {
    for (let i = 0; i < 5; i++) {
      await remember('alice', `memory entry ${i} venus yield`);
    }
    const r = await recall('alice', 'venus yield', 2);
    const lines = r.split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it('returns empty string when no memories are stored for the user', async () => {
    const r = await recall('alice', 'anything');
    expect(r).toBe('');
  });

  it('returns empty string for an empty query', async () => {
    await remember('alice', 'some content');
    const r = await recall('alice', '   ');
    expect(r).toBe('');
  });

  it('isolates per-user memory', async () => {
    await remember('alice', 'alice prefers Venus');
    await remember('bob', 'bob prefers Beefy');
    // Use a token that's only in alice's entry. StubEmbedder is bag-of-words
    // so a query needs at least one matching token to score > 0.
    const r = await recall('alice', 'Venus');
    expect(r).toContain('Venus');
    expect(r).not.toContain('Beefy');
  });

  it('remember drops entries with empty content', async () => {
    await remember('alice', '   ');
    expect(_peekMemory('alice')).toEqual([]);
  });

  it('remember fail-soft when the embedder throws', async () => {
    process.env.VECTOR_MEMORY_PROVIDER = 'vertex';
    // No GCP_PROJECT_ID set → VertexEmbedder constructor throws → factory
    // falls back to StubEmbedder, so we exercise the construct-path branch.
    _resetEmbedder();
    await remember('alice', 'some content');
    // Should still have stored because the fallback Stub succeeded.
    expect(_peekMemory('alice').length).toBe(1);
  });

  it('caps stored entries per user (MAX_PER_USER = 100)', async () => {
    for (let i = 0; i < 105; i++) {
      await remember('alice', `entry number ${i}`);
    }
    expect(_peekMemory('alice').length).toBe(100);
    // The oldest entries should have been evicted.
    const contents = _peekMemory('alice').map((e) => e.content);
    expect(contents).not.toContain('entry number 0');
    expect(contents).toContain('entry number 104');
  });
});

describe('getEmbedder factory', () => {
  it('defaults to StubEmbedder when no vertex env is set', () => {
    expect(getEmbedder().name).toBe('stub');
  });

  it('attempts Vertex when LLM_PROVIDER=vertex but falls back when GCP_PROJECT_ID missing', () => {
    process.env.LLM_PROVIDER = 'vertex';
    delete process.env.GCP_PROJECT_ID;
    _resetEmbedder();
    expect(getEmbedder().name).toBe('stub');
  });

  it('attempts Vertex when VECTOR_MEMORY_PROVIDER=vertex (regardless of LLM_PROVIDER)', () => {
    process.env.VECTOR_MEMORY_PROVIDER = 'vertex';
    process.env.GCP_PROJECT_ID = 'test-project';
    _resetEmbedder();
    const e = getEmbedder();
    // Project is set, so construction succeeds; the embed call itself would
    // require a real Vertex endpoint but we don't exercise it here.
    expect(e.name).toBe('vertex');
  });

  it('singleton-caches the embedder', () => {
    const a = getEmbedder();
    const b = getEmbedder();
    expect(a).toBe(b);
  });
});
