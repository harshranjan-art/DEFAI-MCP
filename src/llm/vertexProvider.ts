/**
 * Vertex AI implementation of LLMProvider — Phase 7B.
 *
 * Wraps the `@google-cloud/vertexai` SDK. Routes the project's six
 * LLM tasks onto Gemini 3 (Pro for planner / judge, Flash for verifier /
 * classifier / summarizer / intent).
 *
 * Translation layer:
 *
 *   Groq / OpenAI shape                  Vertex / Gemini shape
 *   ──────────────────────────────────  ─────────────────────────────────────
 *   messages: [{role:'system'|'user'    contents: [{role:'user'|'model',
 *               |'assistant', content}]              parts:[{text}]}]
 *                                       + systemInstruction (string)
 *   tools: [{type:'function',           tools: [{functionDeclarations:[
 *           function:{name, …}}]                    {name, description,
 *                                                   parameters}]}]
 *   tool_choice: 'auto'                 toolConfig: {functionCallingConfig:
 *                | 'required'                        {mode: AUTO|ANY,
 *                | {name}                            allowedFunctionNames?}}
 *   response_format:{type:'json_object'} generationConfig.responseMimeType:
 *                                         'application/json'
 *   tool_calls[]:                       parts.filter(functionCall):
 *     {name, arguments:string}            {name, args:object}
 *                                       → normalized to JSON-string args
 *   usage.prompt_tokens                 usageMetadata.promptTokenCount
 *   usage.completion_tokens             usageMetadata.candidatesTokenCount
 *   prompt_tokens_details.cached_tokens usageMetadata.cachedContentTokenCount
 *
 * Configuration:
 *   - project:  GCP_PROJECT_ID env (required at chat() time; constructor
 *               is harmless without it)
 *   - location: GCP_LOCATION env, default 'us-central1'
 *   - Auth happens via Application Default Credentials. On Cloud Run the
 *     service account is auto-attached; locally use `gcloud auth
 *     application-default login`.
 *
 * Not implemented yet (deferred to later sub-phases):
 *   - Explicit context caching (`cachedContent`). Comes in 7B-followup
 *     once prompt+tools stabilize across the eval suite.
 *   - Streaming via generateContentStream. Not needed by any caller today.
 */

import { VertexAI, FunctionCallingMode } from '@google-cloud/vertexai';
import type {
  GenerativeModel,
  GenerateContentRequest,
  Content,
  Tool,
  ToolConfig,
  GenerationConfig,
  FunctionDeclaration,
} from '@google-cloud/vertexai';
import type {
  LLMChatOptions,
  LLMChatResult,
  LLMProvider,
  LLMTask,
  LLMToolCall,
} from './types';

export const VERTEX_PLANNER_MODEL = 'gemini-3-pro';
export const VERTEX_FAST_MODEL = 'gemini-3-flash';

export interface VertexProviderOptions {
  /** GCP project id; defaults to GCP_PROJECT_ID env var. */
  project?: string;
  /** Region; defaults to GCP_LOCATION env var or 'us-central1'. */
  location?: string;
  /**
   * Test-only escape hatch. Injecting a stub `VertexAI` (or anything with
   * `getGenerativeModel(opts)`) lets unit tests exercise chat() without
   * making real calls or installing google-auth-library credentials.
   * Production code should NEVER pass this.
   */
  _vertexClient?: Pick<VertexAI, 'getGenerativeModel'>;
}

export class VertexProvider implements LLMProvider {
  readonly name = 'vertex' as const;
  private readonly project: string;
  private readonly location: string;
  private readonly injectedClient?: Pick<VertexAI, 'getGenerativeModel'>;
  private vertexClient: VertexAI | null = null;
  private readonly modelCache = new Map<string, GenerativeModel>();

  constructor(opts: VertexProviderOptions = {}) {
    this.project = opts.project ?? process.env.GCP_PROJECT_ID ?? '';
    this.location = opts.location ?? process.env.GCP_LOCATION ?? 'us-central1';
    this.injectedClient = opts._vertexClient;
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

  private getClient(): Pick<VertexAI, 'getGenerativeModel'> {
    if (this.injectedClient) return this.injectedClient;
    if (this.vertexClient) return this.vertexClient;
    if (!this.project) {
      throw new Error(
        'GCP_PROJECT_ID is not set — VertexProvider cannot make calls. ' +
          'Either set the env var or pass `project` to the constructor.',
      );
    }
    this.vertexClient = new VertexAI({ project: this.project, location: this.location });
    return this.vertexClient;
  }

  /**
   * Per-model `GenerativeModel` instance, cached so we don't pay the auth
   * + handle construction cost on every chat call.
   */
  private getModel(modelName: string): GenerativeModel {
    const cached = this.modelCache.get(modelName);
    if (cached) return cached;
    const model = this.getClient().getGenerativeModel({ model: modelName });
    this.modelCache.set(modelName, model);
    return model;
  }

  async chat(opts: LLMChatOptions): Promise<LLMChatResult> {
    const modelName = opts.model ?? this.modelFor(opts.task);
    const model = this.getModel(modelName);
    const request = this.buildRequest(opts);

    const result = await model.generateContent(request);
    return this.translateResponse(result.response, modelName);
  }

  private buildRequest(opts: LLMChatOptions): GenerateContentRequest {
    // Vertex accepts system instructions as a separate field — split them
    // out so the system prompt isn't re-encoded as a user turn.
    const systemParts: string[] = [];
    const contents: Content[] = [];
    for (const m of opts.messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }

    // `FunctionDeclaration.parameters` is typed as `FunctionDeclarationSchema`
    // (a JSON-schema-like object with required `type` + `properties`). Our
    // upstream LLMToolDef keeps `parameters` as a loose Record so the same
    // shape can flow to Groq verbatim. Cast through `unknown` to bridge —
    // the schema is validated by the model at runtime.
    const tools: Tool[] | undefined =
      opts.tools && opts.tools.length > 0
        ? [
            {
              functionDeclarations: opts.tools.map(
                (t): FunctionDeclaration =>
                  ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as unknown as FunctionDeclaration['parameters'],
                  }),
              ),
            },
          ]
        : undefined;

    let toolConfig: ToolConfig | undefined;
    if (opts.toolChoice === 'auto') {
      toolConfig = { functionCallingConfig: { mode: FunctionCallingMode.AUTO } };
    } else if (opts.toolChoice === 'required') {
      toolConfig = { functionCallingConfig: { mode: FunctionCallingMode.ANY } };
    } else if (opts.toolChoice && typeof opts.toolChoice === 'object') {
      toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: [opts.toolChoice.name],
        },
      };
    }

    const generationConfig: GenerationConfig = {};
    if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) generationConfig.maxOutputTokens = opts.maxTokens;
    if (opts.responseFormat === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }

    const request: GenerateContentRequest = { contents };
    if (systemParts.length > 0) request.systemInstruction = systemParts.join('\n\n');
    if (tools) request.tools = tools;
    if (toolConfig) request.toolConfig = toolConfig;
    if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
    return request;
  }

  private translateResponse(
    response: Awaited<ReturnType<GenerativeModel['generateContent']>>['response'],
    modelName: string,
  ): LLMChatResult {
    const candidate = response.candidates?.[0];
    const usage = response.usageMetadata;

    if (!candidate) {
      // Safety block or empty response — return zeroed result so callers
      // can decide whether to retry or surface to the user.
      return {
        content: null,
        tool_calls: [],
        usage: {
          input_tokens: usage?.promptTokenCount ?? 0,
          cached_input_tokens: usage?.cachedContentTokenCount ?? 0,
          output_tokens: usage?.candidatesTokenCount ?? 0,
        },
        model: modelName,
      };
    }

    let textContent: string | null = null;
    const tool_calls: LLMToolCall[] = [];
    for (const part of candidate.content.parts ?? []) {
      const p = part as { text?: string; functionCall?: { name: string; args?: object } };
      if (p.functionCall) {
        tool_calls.push({
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args ?? {}),
        });
      } else if (typeof p.text === 'string' && p.text.length > 0) {
        textContent = (textContent ?? '') + p.text;
      }
    }

    return {
      content: textContent,
      tool_calls,
      usage: {
        input_tokens: usage?.promptTokenCount ?? 0,
        cached_input_tokens: usage?.cachedContentTokenCount ?? 0,
        output_tokens: usage?.candidatesTokenCount ?? 0,
      },
      model: modelName,
    };
  }
}
