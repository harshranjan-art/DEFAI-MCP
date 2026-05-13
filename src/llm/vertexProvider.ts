/**
 * Vertex AI implementation of LLMProvider — Phase 7B scaffold.
 *
 * In Phase 7A this class exists so the provider abstraction has both
 * implementations the env-var switch can reach. The actual Vertex SDK
 * wiring (tool-call translation, context caching, usage extraction) lands
 * in Phase 7B once the GCP project + region are pinned.
 *
 * Until then: constructing the class is harmless, but calling chat() throws
 * a clear error. The model defaults are already correct so cost-tracking
 * pricing tables and observability tags can be wired in 7A.
 *
 * Target models (2026 latest):
 *   - Gemini 3 Pro    → planner, judge (high-capability)
 *   - Gemini 3 Flash  → verifier, classifier, summarizer, intent (fast/cheap)
 *
 * Model IDs below use the unversioned form. Phase 7B should pin to specific
 * versioned IDs (`-001`, `-002` etc.) once we confirm what's GA in the
 * chosen region.
 */

import type {
  LLMChatOptions,
  LLMChatResult,
  LLMProvider,
  LLMTask,
} from './types';

export const VERTEX_PLANNER_MODEL = 'gemini-3-pro';
export const VERTEX_FAST_MODEL = 'gemini-3-flash';

export interface VertexProviderOptions {
  /** GCP project id; defaults to GCP_PROJECT_ID env var. */
  project?: string;
  /** Region; defaults to GCP_LOCATION env var or 'us-central1'. */
  location?: string;
}

export class VertexProvider implements LLMProvider {
  readonly name = 'vertex' as const;
  private readonly project: string;
  private readonly location: string;

  constructor(opts: VertexProviderOptions = {}) {
    this.project = opts.project ?? process.env.GCP_PROJECT_ID ?? '';
    this.location = opts.location ?? process.env.GCP_LOCATION ?? 'us-central1';
  }

  modelFor(task: LLMTask): string {
    switch (task) {
      case 'planner':
      case 'judge':
        return VERTEX_PLANNER_MODEL;
      case 'verifier':
      case 'classifier':
      case 'summarizer':
      case 'intent':
        return VERTEX_FAST_MODEL;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(_opts: LLMChatOptions): Promise<LLMChatResult> {
    throw new Error(
      `VertexProvider.chat() not implemented yet (Phase 7A scaffold). ` +
        `Vertex AI wiring lands in Phase 7B. Project=${this.project || '<unset>'} location=${this.location}. ` +
        `Set LLM_PROVIDER=groq to use Groq in the meantime.`,
    );
  }
}
