import { Telegraf, Markup } from 'telegraf';
import { parseIntent, generateConversationalReply } from './intentParser';
import { handleYield } from '../skills/yield';
import { handleRemittance } from '../skills/remittance';
import { pendingActions, awaitingAmountFor } from '../utils/storage';
import { remember } from '../utils/memory';
import { positions, setBotRef } from '../monitor/yieldWatcher';
import { getSmartAccountAddress } from '../wallet/pimlico';
import 'dotenv/config';

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

setBotRef(bot);

// /start — welcome + risk preference keyboard
bot.start(async (ctx) => {
  console.log(`[Bot] /start from user ${ctx.from.id}`);
  await ctx.reply(
    `🙏 *Namaste! DeFAI Bharat mein swagat hai!*\n\nMain tera DeFi assistant hoon — yield farming, remittance, aur portfolio sab handle karta hoon.\n\nPehle bata — tera risk appetite kya hai?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🛡️ Conservative (3-5% APY)', 'risk_conservative')],
        [Markup.button.callback('⚖️ Balanced (5-10% APY)', 'risk_balanced')],
        [Markup.button.callback('🚀 Aggressive (10%+ APY)', 'risk_aggressive')],
      ]),
    }
  );
});

// Risk preference actions
for (const level of ['conservative', 'balanced', 'aggressive'] as const) {
  bot.action(`risk_${level}`, async (ctx) => {
    const uid = ctx.from.id.toString();
    console.log(`[Bot] Risk preference: ${level} from user ${uid}`);
    await remember(uid, `User risk preference: ${level}`);
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Got it! ${level.charAt(0).toUpperCase() + level.slice(1)} risk set. Ab baat kar — kya karna hai?`);
  });
}

// Inline portfolio handler — used by both text and command
async function handlePortfolio(ctx: any, uid: string): Promise<void> {
  console.log(`[Bot] Portfolio request from user ${uid}`);
  const pos = positions.get(uid);
  try {
    const address = await getSmartAccountAddress();
    const explorerUrl = `https://testnet.bscscan.com/address/${address}`;
    if (pos) {
      console.log(`[Bot] User ${uid} has position: ${pos.amount} BNB in ${pos.protocol}`);
      await ctx.reply(
        `📊 *Your Portfolio*\n\n💰 ${pos.amount} BNB in *${pos.protocol}*\n📈 Entry APY: ${pos.entryAPY.toFixed(2)}%\n📅 Since: ${pos.depositedAt.toLocaleDateString()}\n\n🔗 [Smart Account on BSCScan](${explorerUrl})`,
        { parse_mode: 'Markdown' }
      );
    } else {
      console.log(`[Bot] User ${uid} has no active position`);
      await ctx.reply(
        `📊 *Your Portfolio*\n\nNo active position yet.\n\nSend "invest 0.1 BNB" to start earning!\n\n🔗 [Smart Account on BSCScan](${explorerUrl})`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e: any) {
    console.error(`[Bot] Portfolio error for user ${uid}:`, e.message);
    await ctx.reply('❌ Could not fetch portfolio. Try again.');
  }
}

// Confirm yield
bot.action('confirm_yield', async (ctx) => {
  const uid = ctx.from.id.toString();
  console.log(`[Bot] Confirm yield from user ${uid}`);
  const pending = pendingActions.get(uid);
  await ctx.answerCbQuery();
  if (!pending) return ctx.reply('⚠️ No pending action found.');
  pendingActions.delete(uid);
  await pending.execute(ctx);
});

// Confirm remittance
bot.action('confirm_remit', async (ctx) => {
  const uid = ctx.from.id.toString();
  console.log(`[Bot] Confirm remittance from user ${uid}`);
  const pending = pendingActions.get(uid);
  await ctx.answerCbQuery();
  if (!pending) return ctx.reply('⚠️ No pending action found.');
  pendingActions.delete(uid);
  await pending.execute(ctx);
});

// Cancel any pending action
bot.action('cancel', async (ctx) => {
  const uid = ctx.from.id.toString();
  console.log(`[Bot] Cancel action from user ${uid}`);
  pendingActions.delete(uid);
  await ctx.answerCbQuery();
  await ctx.reply('❌ Action cancelled. Kuch aur karna hai?');
});

// ── COMMANDS MUST be registered BEFORE bot.on('text') ──
// Otherwise the text handler catches /portfolio, /help, etc. first

// /portfolio command
bot.command('portfolio', async (ctx) => {
  console.log(`[Bot] /portfolio command from user ${ctx.from.id}`);
  await handlePortfolio(ctx, ctx.from.id.toString());
});

// /help command
bot.command('help', async (ctx) => {
  console.log(`[Bot] /help command from user ${ctx.from.id}`);
  await ctx.reply(
    `*DeFAI Bharat — Commands*\n\n` +
    `💰 *Yield*\n"Invest 0.1 BNB" — deposit to best protocol\n\n` +
    `💸 *Remittance*\n"Send ₹5000 to family" — compare & send\n\n` +
    `📊 *Portfolio*\n/portfolio — active positions & smart account\n\n` +
    `⚙️ *Other*\n/start — set risk preference\n/help — this message`,
    { parse_mode: 'Markdown' }
  );
});

// Main text handler — intent parsing + routing
// IMPORTANT: This must be AFTER bot.command() registrations
bot.on('text', async (ctx) => {
  const uid = ctx.from.id.toString();
  const text = ctx.message.text;
  console.log(`[Bot] Text message from user ${uid}: "${text}"`);

  try {
    // If we previously asked for an amount, intercept before re-parsing
    const awaiting = awaitingAmountFor.get(uid);
    if (awaiting) {
      const amountMatch = text.match(/(\d+\.?\d*)/);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1]);
        awaitingAmountFor.delete(uid);
        console.log(`[Bot] Resolving pending ${awaiting} with amount=${amount}`);
        if (awaiting === 'YIELD') {
          await handleYield(ctx, { type: 'YIELD', amount, rawText: text }, uid);
        } else {
          await handleRemittance(ctx, { type: 'REMITTANCE', amount, rawText: text }, uid);
        }
        return;
      }
      // No number found — clear the pending state and fall through to normal parsing
      awaitingAmountFor.delete(uid);
    }

    await ctx.reply('🔍 Samajh raha hoon...');
    const intent = await parseIntent(text, uid);
    console.log(`[Bot] Intent result: type=${intent.type}, amount=${intent.amount}, currency=${intent.currency}`);

    switch (intent.type) {
      case 'YIELD':
        if (!intent.amount) {
          console.log(`[Bot] YIELD intent but no amount — asking user`);
          awaitingAmountFor.set(uid, 'YIELD');
          await ctx.reply('💰 Kitna BNB invest karna chahte ho? (e.g. "0.1 BNB" ya "0.5 BNB")');
          break;
        }
        console.log(`[Bot] Routing to YIELD handler, amount=${intent.amount}`);
        await handleYield(ctx, intent, uid);
        break;
      case 'REMITTANCE':
        if (!intent.amount) {
          console.log(`[Bot] REMITTANCE intent but no amount — asking user`);
          awaitingAmountFor.set(uid, 'REMITTANCE');
          await ctx.reply('💸 Kitna INR bhejni hai? (e.g. "₹5000 to family" ya "10000 rupees")');
          break;
        }
        console.log(`[Bot] Routing to REMITTANCE handler, amount=${intent.amount}`);
        await handleRemittance(ctx, intent, uid);
        break;
      case 'PORTFOLIO':
        console.log(`[Bot] Routing to PORTFOLIO handler`);
        await handlePortfolio(ctx, uid);
        break;
      default:
        console.log(`[Bot] UNKNOWN intent — generating conversational reply`);
        const reply = await generateConversationalReply(text, uid);
        await ctx.reply(reply);
    }
  } catch (e: any) {
    console.error(`[Bot] Error handling text from user ${uid}:`, e.message);
    if (e.stack) console.error('[Bot] Stack:', e.stack);
    await ctx.reply(`❌ Kuch gadbad ho gayi. Please try again.`);
  }
});

bot.launch();
console.log('[Bot] Telegram bot launched');
