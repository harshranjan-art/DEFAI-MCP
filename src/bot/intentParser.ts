import Groq from 'groq-sdk';
import { recall } from '../utils/memory';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface Intent {
  type: 'YIELD' | 'REMITTANCE' | 'SWAP' | 'PORTFOLIO' | 'UNKNOWN';
  amount?: number;
  currency?: string;
  destination?: string;
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
          enum: ['YIELD', 'REMITTANCE', 'SWAP', 'PORTFOLIO', 'UNKNOWN'],
          description: 'The intent type',
        },
        amount: {
          type: 'number',
          description: 'Numeric amount mentioned by the user',
        },
        currency: {
          type: 'string',
          description: 'Currency code mentioned (e.g. BNB, USDT, INR)',
        },
        destination: {
          type: 'string',
          description: 'Destination address or country for remittance',
        },
      },
    },
  },
};

export async function parseIntent(message: string, userId: string): Promise<Intent> {
  console.log(`[Intent] Parsing message from user ${userId}: "${message}"`);

  try {
    console.log('[Intent] Fetching user memory...');
    const memory = await recall(userId, message);
    console.log(`[Intent] Memory result: ${memory ? `"${memory.slice(0, 100)}..."` : '(empty)'}`);

    const systemPrompt = [
      'You are DeFAI Bharat, an AI agent helping Indian users with DeFi on BSC.',
      'Classify the user message into one of: YIELD (deposit/earn/invest), REMITTANCE (send money abroad), SWAP (exchange tokens), PORTFOLIO (check balance/status), UNKNOWN.',
      'You MUST call the classify_intent function with your classification.',
      memory ? `\nUser context from memory:\n${memory}` : '',
    ].join('\n').trim();

    console.log('[Intent] Calling Groq API (llama-3.3-70b-versatile)...');
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

    const choice = response.choices[0];
    console.log(`[Intent] API response - finish_reason: ${choice.finish_reason}`);

    const toolCall = choice.message.tool_calls?.[0];
    if (!toolCall) {
      console.warn('[Intent] No tool call in response — returning UNKNOWN');
      console.warn('[Intent] Response message:', JSON.stringify(choice.message, null, 2));
      return { type: 'UNKNOWN', rawText: message };
    }

    console.log(`[Intent] Tool call args: ${toolCall.function.arguments}`);
    const input = JSON.parse(toolCall.function.arguments) as Omit<Intent, 'rawText'>;
    console.log(`[Intent] Classified as: ${input.type}`, input.amount ? `amount=${input.amount}` : '', input.currency ? `currency=${input.currency}` : '');
    return { ...input, rawText: message };
  } catch (e: any) {
    console.error('[Intent] ERROR during intent parsing:', e.message);
    console.error('[Intent] Error details:', e.status || '', e.error || '');
    if (e.stack) console.error('[Intent] Stack:', e.stack);
    return { type: 'UNKNOWN', rawText: message };
  }
}

const FALLBACK_REPLY =
  `🤔 Samajh nahi aaya. Try:\n\n• "Invest 0.1 BNB" — yield farming\n• "Send ₹5000 to family" — remittance\n• /portfolio — check balance`;

export async function generateConversationalReply(
  message: string,
  userId: string
): Promise<string> {
  console.log(`[ConversationalReply] Generating reply for user ${userId}: "${message}"`);
  try {
    const memory = await recall(userId, message);
    console.log(`[ConversationalReply] Memory: ${memory ? `"${memory.slice(0, 80)}..."` : '(empty)'}`);

    const systemPrompt = [
      'You are DeFAI Bharat, a friendly DeFi assistant for Indian users on BSC Testnet.',
      'Reply in Hinglish (natural mix of Hindi and English) — warm, helpful, conversational.',
      'You can help with: yield farming (Venus, PancakeSwap), remittance (sending money abroad), and portfolio tracking.',
      'Keep replies short — 2-3 sentences max. Use 1-2 emojis max.',
      'If the user asks what you can do, briefly explain your capabilities.',
      'Never mention that you are an AI model or name the underlying model.',
      memory ? `\nUser context (use this to personalise your reply):\n${memory}` : '',
    ].join('\n').trim();

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const reply = response.choices[0]?.message?.content?.trim();
    console.log(`[ConversationalReply] Generated: "${reply?.slice(0, 80)}..."`);
    return reply || FALLBACK_REPLY;
  } catch (e: any) {
    console.error('[ConversationalReply] Error:', e.message);
    return FALLBACK_REPLY;
  }
}
