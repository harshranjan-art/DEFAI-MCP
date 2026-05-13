/**
 * Groq SDK implementation of LLMProvider.
 *
 * This is the legacy path — kept fully working through Phase 7 so a
 * `LLM_PROVIDER=groq` env flip is always a one-second fallback if Vertex
 * has an outage.
 *
 * Model defaults:
 *   - planner / judge  → llama-3.3-70b-versatile (flagship)
 *   - verifier / classifier / summarizer / intent → llama-3.1-8b-instant (fast)
 *
 * Callers can override per call via `LLMChatOptions.model` — used by the
 * agent router's intent-routed model tiering (Phase 6.5).
 */

import Groq from 'groq-sdk';
import type {
  LLMChatOptions,
  LLMChatResult,
  LLMProvider,
  LLMTask,
  LLMToolCall,
} from './types';

export const GROQ_PLANNER_FLAGSHIP = 'llama-3.3-70b-versatile';
export const GROQ_PLANNER_CHEAP = 'llama-3.1-70b-versatile';
export const GROQ_FAST = 'llama-3.1-8b-instant';

export class GroqProvider implements LLMProvider {
  readonly name = 'groq' as const;
  private client: Groq | null = null;

  modelFor(task: LLMTask): string {
    switch (task) {
      case 'planner':
      case 'judge':
        return GROQ_PLANNER_FLAGSHIP;
      case 'verifier':
      case 'classifier':
      case 'summarizer':
      case 'intent':
        return GROQ_FAST;
    }
  }

  private getClient(): Groq {
    if (this.client) return this.client;
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is not set — GroqProvider cannot make calls');
    }
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    return this.client;
  }

  async chat(opts: LLMChatOptions): Promise<LLMChatResult> {
    const model = opts.model ?? this.modelFor(opts.task);
    const client = this.getClient();

    const groqTools = opts.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));

    let toolChoice: unknown;
    if (opts.toolChoice === 'auto') toolChoice = 'auto';
    else if (opts.toolChoice === 'required') toolChoice = 'required';
    else if (opts.toolChoice && typeof opts.toolChoice === 'object') {
      toolChoice = { type: 'function', function: { name: opts.toolChoice.name } };
    }

    const responseFormat =
      opts.responseFormat === 'json_object' ? { type: 'json_object' as const } : undefined;

    const completion = await client.chat.completions.create({
      model,
      messages: opts.messages as Groq.Chat.ChatCompletionMessageParam[],
      ...(groqTools ? { tools: groqTools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice as Groq.Chat.ChatCompletionToolChoiceOption } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    });

    const choice = completion.choices?.[0];
    const message = choice?.message;
    const usage = (completion as unknown as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    }).usage;

    const tool_calls: LLMToolCall[] = (message?.tool_calls ?? []).map((tc) => {
      const fnTc = tc as Groq.Chat.ChatCompletionMessageToolCall;
      return {
        id: fnTc.id,
        name: fnTc.function?.name ?? '',
        arguments: fnTc.function?.arguments ?? '{}',
      };
    });

    return {
      content: message?.content ?? null,
      tool_calls,
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        cached_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
      },
      model,
    };
  }
}
