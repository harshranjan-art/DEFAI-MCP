function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const R = {
  thinking(): string {
    return pick([
      '🔍 Samajh raha hoon...',
      '🧠 Ek second bhai...',
      '⏳ Dekh raha hoon...',
      '🤔 Soch raha hoon...',
    ]);
  },

  yieldOk(apy: number): string {
    return pick([
      `✅ Done bhai! Venus pe ${apy}% APY mil raha hai — paisa kaam kar raha hai!`,
      `🎉 Ho gaya! ${apy}% yield lock ho gayi Venus mein!`,
      `💰 Tera paisa laga diya — ${apy}% APY chal raha hai!`,
    ]);
  },

  remitOk(savings: number): string {
    return pick([
      `✅ Best rate mil gayi! ₹${savings} bacha liya traditional remittance se!`,
      `🎉 Transfer ready hai — ₹${savings} ki saving hui aaj!`,
      `💸 Ho gaya bhai! Tune ₹${savings} bachaye is baar!`,
    ]);
  },

  error(): string {
    return pick([
      '❌ Kuch gadbad ho gayi, thoda baad mein try kar.',
      '⚠️ Oops! Kuch toh gadbad hai — dubara try kar bhai.',
      '😅 Ek error aa gayi — phir se bhej apna message.',
    ]);
  },
};
