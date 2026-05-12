/**
 * LLM-as-judge — scores a captured trajectory against three rubrics
 * (tool-correctness, argument-correctness, step-efficiency) on a 0-3 scale.
 *
 * Default judge: Llama-3.3-70b-versatile via Groq. Tests inject a stubbed
 * Groq client through `groqOverride` so we never make real network calls.
 */

import Groq from 'groq-sdk';
import { z } from 'zod';
import type { CapturedStep, ExpectedTrajectory } from './matcher';

const ScoreSchema = z.object({
  tool_correctness: z.number().int().min(0).max(3),
  argument_correctness: z.number().int().min(0).max(3),
  step_efficiency: z.number().int().min(0).max(3),
  rationale: z.string().max(500),
});

export type JudgeScore = z.infer<typeof ScoreSchema>;

export const JUDGE_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are an evaluator for an AI agent that controls a DeFi trading system. Score the agent's behavior on three rubrics, each as integers 0-3:

- tool_correctness: did the agent pick the right tools? 0=wrong tool, 1=related but wrong, 2=mostly right, 3=exactly right.
- argument_correctness: were tool arguments well-formed and matching the user's stated intent? 0=fabricated, 1=partial, 2=mostly correct, 3=exact.
- step_efficiency: was the trajectory efficient? Penalize unnecessary tools. 0=wandering, 1=excess, 2=fine, 3=optimal.

Respond with JSON only:
  {"tool_correctness": 0|1|2|3, "argument_correctness": 0|1|2|3, "step_efficiency": 0|1|2|3, "rationale": "<=500 chars"}

No prose outside the JSON object.`;

export interface JudgeOptions {
  user_input: string;
  captured_trajectory: CapturedStep[];
  expected_trajectory: ExpectedTrajectory;
  response: string;
  /** Inject a mock Groq client. If absent, a real client is constructed from GROQ_API_KEY. */
  groqOverride?: Pick<Groq, 'chat'>;
}

let cachedGroq: Groq | null = null;
function getGroqClient(): Groq {
  if (cachedGroq) return cachedGroq;
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — judge cannot run');
  }
  cachedGroq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return cachedGroq;
}

const ZERO_SCORE: JudgeScore = {
  tool_correctness: 0,
  argument_correctness: 0,
  step_efficiency: 0,
  rationale: 'judge unavailable or output malformed — defaulting to 0',
};

export async function judgeTrajectory(opts: JudgeOptions): Promise<JudgeScore> {
  const client = opts.groqOverride ?? getGroqClient();
  const userContent = [
    `User input: "${opts.user_input}"`,
    ``,
    `Agent's captured trajectory (tool calls in order):`,
    opts.captured_trajectory
      .map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.args)})`)
      .join('\n'),
    ``,
    `Agent's final response: ${opts.response.slice(0, 500)}`,
    ``,
    `Expected tool sequence (for reference, not exhaustive):`,
    opts.expected_trajectory.tool_sequence
      .map((t, i) => `${i + 1}. ${t.name} required args: ${JSON.stringify(t.args_match ?? {})}`)
      .join('\n'),
  ].join('\n');

  let raw: string;
  try {
    const completion = await client.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch {
    return ZERO_SCORE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ZERO_SCORE;
  }
  const result = ScoreSchema.safeParse(parsed);
  if (!result.success) return ZERO_SCORE;
  return result.data;
}
