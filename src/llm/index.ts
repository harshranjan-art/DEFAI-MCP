/**
 * Provider factory. Singleton-cached per process so:
 *   - Real providers don't re-construct an SDK client on every call
 *   - Tests can reset via _resetLLMProvider() between describe blocks
 *
 * Selection:
 *   LLM_PROVIDER=groq    (default)  → GroqProvider
 *   LLM_PROVIDER=vertex             → VertexProvider (throws on chat() until Phase 7B)
 *
 * Any other value throws — fail-fast rather than silently fall back, because
 * cost-tracking and model-routing both assume the active provider is known.
 */

import { GroqProvider } from './groqProvider';
import { VertexProvider } from './vertexProvider';
import type { LLMProvider } from './types';

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  const which = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();
  switch (which) {
    case 'groq':
      cached = new GroqProvider();
      return cached;
    case 'vertex':
      cached = new VertexProvider();
      return cached;
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER=${which}. Use 'groq' or 'vertex'.`,
      );
  }
}

/**
 * Reset the cached provider. Test-only — production code should never need
 * to swap providers mid-process. Used to validate the factory across env
 * permutations.
 */
export function _resetLLMProvider(): void {
  cached = null;
}

export * from './types';
export { GroqProvider, GROQ_PLANNER_FLAGSHIP, GROQ_PLANNER_CHEAP, GROQ_FAST } from './groqProvider';
export { VertexProvider, VERTEX_PLANNER_MODEL, VERTEX_FAST_MODEL } from './vertexProvider';
