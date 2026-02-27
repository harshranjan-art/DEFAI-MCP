import { Context, Markup } from 'telegraf';
import { getCache } from '../tinyfish/ratesCache';
import { convertINRtoUSD as getINRtoUSD } from '../data/rates';
import { executeTestnetTransfer } from '../wallet/execute';
import { remember } from '../utils/memory';
import { pendingActions } from '../utils/storage';
import type { Intent } from '../bot/intentParser';

const BURN = '0x000000000000000000000000000000000000dEaD';

export async function handleRemittance(ctx: Context, intent: Intent, userId: string): Promise<void> {
  const amountINR = intent.amount ?? 5000;
  const destination = intent.destination ?? 'family';

  await ctx.reply('💸 Comparing routes...');

  const cache = getCache();
  const usdAmount = await getINRtoUSD(amountINR);

  const ourFee = Math.round(amountINR * 0.005);
  const wiseFee = cache?.wiseFee.fee_inr ?? Math.round(amountINR * 0.018);
  const wuFee = cache?.wuFee.fee_inr ?? Math.round(amountINR * 0.035);
  const bestExch = cache?.bestExchange ?? { exchange: 'WazirX', bnb_inr: 52000 };
  const age = cache?.lastRefreshed
    ? `${Math.round((Date.now() - cache.lastRefreshed.getTime()) / 60000)} min ago`
    : 'fallback data';

  const maxSaving = Math.max(wiseFee, wuFee) - ourFee;

  const message = [
    `💸 *Remittance: ₹${amountINR.toLocaleString()} → ${destination}*`,
    `💵 USD equivalent: ~$${usdAmount.toFixed(2)}`,
    `📊 Rates: ${age}`,
    ``,
    `| Provider | Fee | Time |`,
    `|----------|-----|------|`,
    `| 🏆 DeFAI (BNB) | ₹${ourFee} | Instant |`,
    `| Wise | ₹${wiseFee} | 1-2 days |`,
    `| Western Union | ₹${wuFee} | 3-5 days |`,
    ``,
    `🏦 Best off-ramp: *${bestExch.exchange}* @ ₹${bestExch.bnb_inr.toLocaleString()}/BNB`,
    `💰 You save up to *₹${maxSaving.toLocaleString()}* vs traditional remittance`,
  ].join('\n');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`✅ Confirm via ${bestExch.exchange}`, 'confirm_remit')],
      [Markup.button.callback('❌ Cancel', 'cancel')],
    ]),
  });

  pendingActions.set(userId, {
    type: 'REMITTANCE',
    execute: async (c: Context) => {
      await c.reply('⏳ Simulating transfer via Pimlico AA on BSC testnet...');
      const result = await executeTestnetTransfer(BURN, 0n);
      if (result.success) {
        await remember(
          userId,
          `Remittance of ₹${amountINR} to ${destination} via ${bestExch.exchange}. Fee: ₹${ourFee}. Saved ₹${maxSaving} vs traditional. TxHash: ${result.txHash}. Date: ${new Date().toISOString()}`
        );
        await c.reply(
          `✅ Transfer simulated!\n\n💸 ₹${amountINR.toLocaleString()} → ${destination}\n🏦 Via ${bestExch.exchange} @ ₹${bestExch.bnb_inr.toLocaleString()}/BNB\n💰 Saved ₹${maxSaving.toLocaleString()} vs traditional\n\n🔗 [View on BSCScan](${result.explorerUrl})`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await c.reply(`❌ Transfer failed: ${result.error ?? 'Unknown error'}`);
      }
    },
  });
}
