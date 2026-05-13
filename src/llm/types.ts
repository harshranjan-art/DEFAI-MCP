/**
 * Provider-agnostic LLM interface — Phase 7A.
 *
 * Every Groq call site in the codebase routes through {@link LLMProvider}.
 * Two implementations live behind this interface:
 *   - GroqProvider — wraps groq-sdk (Llama models)
 *   - VertexProvider — wraps @google-cloud/vertexai (Gemini models, Phase 7B)
 *
 * The active provider is selected at startup via the LLM_PROVIDER env var
 * (default 'groq'). Switching providers is a one-line config change.
 *
 * Why this exists:
 *   - The Google FDE JD names Vertex AI as the target stack. Going through
 *     an interface (instead of `new Groq()` at every call site) means the
 *     model/provider swap in Phase 7B is mechanical, not surgical.
 *   - Tests get a single, simple stub (stubProvider) instead of one stub per
 *     SDK shape.
 *   - Cost tracking is uniform: every provider returns usage in the same
 *     normalized shape, regardless of how the underlying SDK packages it.
 *
 * What this does NOT abstract:
 *   - Provider-specific features that have no equivalent (Vertex context
 *     caching, Groq fast-path quantization). Those go through provider
 *     options or stay inside the provider implementation.
 *   - Streaming. Not needed today; can be added as a separate method later.
 */

/**
 * Task labels — drive default model selection inside each provider AND tag
 * cost rows in the llm_costs table. If you add a task here, add it to the
 * LlmTask union in observability/cost.ts too.
 */
export type LLMTask =
  | 'planner'
  | 'verifier'
  | 'classifier'
  | 'summarizer'
  | 'intent'
  | 'judge';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tool definition in normalized form. Groq wants `{type:'function', function:{...}}`
 * and Vertex wants `{functionDeclarations:[...]}`; both are constructed from this.
 *
 * `parameters` is a JSON-schema object — same shape both providers accept
 * verbatim. Keep it as `Record<string, unknown>` because schemas vary wildly
 * across tools and tightening the type buys nothing here.
 */
export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Tool-choice control. `'auto'` lets the model decide, `'required'` forces
 * any tool call, `{name}` forces a specific tool.
 */
export type LLMToolChoice = 'auto' | 'required' | { name: string };

export interface LLMChatOptions {
  task: LLMTask;
  /** Explicit model id — overrides `provider.modelFor(task)`. */
  model?: string;
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  toolChoice?: LLMToolChoice;
  temperature?: number;
  maxTokens?: number;
  /**
   * Force JSON output. Mapped to Groq's `response_format:{type:'json_object'}`
   * and Vertex's `responseMimeType:'application/json'`.
   */
  responseFormat?: 'text' | 'json_object';
}

export interface LLMToolCall {
  id?: string;
  name: string;
  /**
   * JSON-string-encoded args. Both providers' tool-call args are normalized
   * to a string here so callers can keep using `JSON.parse(toolCall.arguments)`
   * regardless of which SDK is underneath.
   */
  arguments: string;
}

export interface LLMUsage {
  input_tokens: number;
  /** Subset of input_tokens served from prompt cache (Groq) / context cache (Vertex). */
  cached_input_tokens: number;
  output_tokens: number;
}

export interface LLMChatResult {
  /** Free-text response. Null when the model emitted only tool calls. */
  content: string | null;
  tool_calls: LLMToolCall[];
  usage: LLMUsage;
  /** Resolved model id (after task-default resolution). Use this when recording cost. */
  model: string;
}

export interface LLMProvider {
  readonly name: 'groq' | 'vertex';
  modelFor(task: LLMTask): string;
  chat(opts: LLMChatOptions): Promise<LLMChatResult>;
}
