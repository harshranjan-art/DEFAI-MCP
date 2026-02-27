export const pendingActions = new Map<string, {
  type: string;
  execute: (ctx: any) => Promise<void>;
}>();

// Tracks when we asked the user for a missing amount.
// On next message, the text handler checks this first before re-parsing with Groq.
export const awaitingAmountFor = new Map<string, 'YIELD' | 'SWAP'>();
