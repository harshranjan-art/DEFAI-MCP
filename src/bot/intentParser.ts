import Groq from 'groq-sdk';
import 'dotenv/config';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface Intent {
  type: 'YIELD' | 'SWAP' | 'ARB' | 'DELTA_NEUTRAL' | 'SCAN' | 'PORTFOLIO' | 'TRADES' | 'RISK' | 'UNKNOWN';
  amount?: number;
  currency?: string;
  token?: string;
  toToken?: string;
  rawText: string;
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'classify_intent',
    description: 'Classify the user message into a DeFi intent category',
    parameters: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          enum: ['YIELD', 'SWAP', 'ARB', 'DELTA_NEUTRAL', 'SCAN', 'PORTFOLIO', 'TRADES', 'RISK', 'UNKNOWN'],
          description: 'The intent type',
        },
        amount: {
          type: 'number',
          description: 'Numeric amount mentioned by the user',
        },
        currency: {
          type: 'string',
          description: 'Currency / token symbol (e.g. BNB, USDT)',
        },
        token: {
          type: 'string',
          description: 'Primary token (for swap: from token, for yield: deposit token)',
        },
        toToken: {
          type: 'string',
          description: 'Target token for swaps (e.g. USDT when swapping BNB to USDT)',
        },
      },
    },
  },
};

export async function parseIntent(message: string, userId: string): Promise<Intent> {
  logger.info('Intent: parsing message from user %s: "%s"', userId, message);

  try {
    const systemPrompt = [
      'You are DeFAI, an AI DeFi assistant on BSC Testnet.',
      'Classify the user message into one of these categories:',
      '  YIELD — deposit / earn / invest tokens for yield',
      '  SWAP — exchange one token for another (e.g. "swap 0.1 BNB to USDT")',
      '  ARB — arbitrage, cross-DEX spread, arb opportunities',
      '  DELTA_NEUTRAL — delta-neutral position, hedged position, basis trade',
      '  SCAN — check market data, APYs, prices, funding rates',
      '  PORTFOLIO — check balance, positions, portfolio value',
      '  TRADES — trade history, past transactions',
      '  RISK — risk settings, risk tolerance, max position',
      '  UNKNOWN — anything else',
      '',
      'You MUST call the classify_intent function with your classification.',
      'Extract amount, token, and toToken if mentioned.',
    ].join('\n');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'classify_intent' } },
      max_tokens: 400,
      temperature: 0,
    });

    const toolCall = response.choices[0]?.message.tool_calls?.[0];
    if (!toolCall) {
      logger.warn('Intent: no tool call in response — returning UNKNOWN');
      return { type: 'UNKNOWN', rawText: message };
    }

    const input = JSON.parse(toolCall.function.arguments) as Omit<Intent, 'rawText'>;
    logger.info('Intent: classified as %s (amount=%s, token=%s)', input.type, input.amount, input.token);
    return { ...input, rawText: message };
  } catch (e: any) {
    logger.error('Intent: parsing error: %s', e.message);
    return { type: 'UNKNOWN', rawText: message };
  }
}

const FALLBACK_REPLY =
  `I didn't understand that. Try:\n\n` +
  `- "Invest 0.1 BNB" — deposit for yield\n` +
  `- "Swap 0.01 BNB to USDT" — token swap\n` +
  `- "Scan markets" — check APYs and prices\n` +
  `- /portfolio — view positions\n` +
  `- /arb — check arbitrage opportunities`;

export async function generateConversationalReply(
  message: string,
  _userId: string,
): Promise<string> {
  try {
    const systemPrompt = [
      'You are DeFAI, a friendly DeFi assistant on BSC Testnet.',
      'Reply naturally — warm, helpful, conversational.',
      'You help with: yield farming, token swaps (PancakeSwap), arbitrage, portfolio tracking, and market data.',
      'Keep replies short — 2-3 sentences max.',
      'If the user asks what you can do, briefly list your capabilities.',
      'Never mention that you are an AI model or name the underlying model.',
    ].join('\n');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() || FALLBACK_REPLY;
  } catch (e: any) {
    logger.error('ConversationalReply error: %s', e.message);
    return FALLBACK_REPLY;
  }
}
