import { Telegraf } from 'telegraf';
import { pendingActions } from '../utils/storage';
import * as agentRouter from './agentRouter';
import { logger } from '../utils/logger';
import * as engine from '../core/engine';
import * as userResolver from '../core/userResolver';
import * as walletManager from '../core/walletManager';
import { setBotRef } from '../monitor/alertDispatcher';
import { formatDepositResult } from '../mcp/tools/yieldDeposit';
import 'dotenv/config';

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Wire bot reference for alert dispatcher (Telegram delivery)
setBotRef(bot);

/**
 * Resolve or create a user from Telegram context.
 * Returns userId or null if the user needs to register.
 */
function resolveUser(telegramId: number): string | null {
  return userResolver.resolveFromTelegram(telegramId);
}

// ─── /start — welcome + registration ───
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  logger.info('Bot: /start from telegram user %d', telegramId);

  const userId = resolveUser(telegramId);
  if (userId) {
    await ctx.reply(
      `*Welcome back!*\n\n` +
      `Your wallet is connected. What would you like to do?\n\n` +
      `Use /help to see available commands.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // New user — check if there's a default user we can link
  const defaultUser = userResolver.resolveFromEnv();
  if (defaultUser) {
    userResolver.linkTelegram(defaultUser, telegramId);
    await ctx.reply(
      `*Welcome to DeFAI!*\n\n` +
      `Your Telegram account has been linked to the default wallet.\n` +
      `Use /portfolio to check your positions or /help to see all commands.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ctx.reply(
    `*Welcome to DeFAI!*\n\n` +
    `To get started:\n` +
    `1. Register on the DeFAI dashboard (enter your private key once in a secure form)\n` +
    `2. Copy your User ID from the registration page\n` +
    `3. Send \`/connect <your_user_id>\` here to link your Telegram\n\n` +
    `Already have a User ID? Use \`/connect <user_id>\` now.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── /connect and /link — link existing user to Telegram via UUID ───
async function handleConnect(ctx: any) {
  const parts = ctx.message.text.split(' ');
  const targetUserId = parts[1];
  if (!targetUserId) {
    await ctx.reply('Usage: /connect <user_id>\n\nGet your User ID from the dashboard Register page.');
    return;
  }

  try {
    const success = userResolver.linkTelegramByUserId(targetUserId, ctx.from.id);
    if (!success) {
      await ctx.reply('User not found. Make sure you registered on the dashboard first.');
      return;
    }
    await walletManager.activate(targetUserId);
    await ctx.reply(
      `Linked! Your Telegram is now connected to user ${targetUserId}.\n` +
      `Use /portfolio to check your positions or /help to see all commands.`
    );
  } catch (e: any) {
    await ctx.reply(`Error: ${e.message}`);
  }
}

bot.command('connect', handleConnect);
bot.command('link', handleConnect);

// ─── /scan — market data ───
bot.command('scan', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  await ctx.reply('Scanning markets...');
  try {
    const result = await engine.scanMarkets('all');
    // Telegram has 4096 char limit — truncate if needed
    const text = result.length > 4000 ? result.slice(0, 4000) + '\n\n(truncated)' : result;
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e: any) {
    logger.error('Bot /scan error: %s', e.message);
    await ctx.reply(`Error scanning markets: ${e.message}`);
  }
});

// ─── /deposit — yield deposit ───
bot.command('deposit', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  const parts = ctx.message.text.split(' ');
  const amount = parts[1];
  const token = parts[2] || 'BNB';

  if (!amount || isNaN(parseFloat(amount))) {
    await ctx.reply('Usage: /deposit <amount> <token>\nExample: /deposit 0.05 BNB');
    return;
  }

  await ctx.reply(`Depositing ${amount} ${token} into best yield protocol...`);
  try {
    const result = await engine.yieldDeposit(userId, token, amount);
    await ctx.reply(formatDepositResult(result));
  } catch (e: any) {
    logger.error('Bot /deposit error: %s', e.message);
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── /rotate — yield rotation ───
bot.command('rotate', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  const parts = ctx.message.text.split(' ');
  const positionId = parts[1];

  if (!positionId) {
    await ctx.reply('Usage: /rotate <position_id>\nUse /portfolio to see your position IDs.');
    return;
  }

  await ctx.reply('Checking for better yield opportunities...');
  try {
    const plan = await engine.checkRotation(positionId);
    if (!plan) {
      await ctx.reply('No better yield found. Your current position is already at the best available APY.');
      return;
    }

    await ctx.reply(
      `*Rotation plan:*\n` +
      `Current: ${plan.currentProtocol} at ${plan.currentApy.toFixed(2)}% APY\n` +
      `Target: ${plan.targetProtocol} at ${plan.targetApy.toFixed(2)}% APY\n` +
      `Improvement: ${plan.improvementBps} bps\n\n` +
      `Executing rotation...`,
      { parse_mode: 'Markdown' }
    );

    const result = await engine.yieldRotate(userId, positionId);
    await ctx.reply(formatDepositResult(result));
  } catch (e: any) {
    logger.error('Bot /rotate error: %s', e.message);
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── /arb — arbitrage status + opportunities ───
bot.command('arb', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  try {
    const session = engine.getArbSession(userId);
    if (session) {
      const status = session.status === 'active' ? 'ACTIVE' : session.status.toUpperCase();
      const pnlSign = session.total_pnl_usd >= 0 ? '+' : '';
      await ctx.reply(
        `Arbitrage Bot — ${status}\n\n` +
        `PnL: ${pnlSign}$${session.total_pnl_usd.toFixed(4)}\n` +
        `Trades: ${session.trades_count}\n` +
        `Max Loss: $${session.max_loss_usd}\n` +
        `Expires: ${new Date(session.expires_at).toLocaleTimeString()}`
      );
    } else {
      await ctx.reply('No active arbitrage session.\n\nScanning for opportunities...');
      const result = await engine.scanMarkets('arbitrage');
      const text = result.length > 4000 ? result.slice(0, 4000) + '\n\n(truncated)' : result;
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
  } catch (e: any) {
    logger.error('Bot /arb error: %s', e.message);
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── /trades — trade history ───
bot.command('trades', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  try {
    const trades = engine.getTradeHistory(userId, { limit: 10 });
    if (trades.length === 0) {
      await ctx.reply('No trades yet. Use /deposit or /scan to get started.');
      return;
    }

    const lines = ['*Recent Trades:*', ''];
    for (const t of trades) {
      lines.push(`${t.type}: ${t.from_amount} ${t.from_token} → ${t.to_amount} ${t.to_token} (${t.protocol})`);
      lines.push(`  ${t.executed_at}`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e: any) {
    logger.error('Bot /trades error: %s', e.message);
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── /portfolio command ───
bot.command('portfolio', async (ctx) => {
  const userId = resolveUser(ctx.from.id);
  if (!userId) return ctx.reply('Please /start first to set up your account.');

  try {
    const portfolio = engine.getPortfolio(userId);
    if (portfolio.positions.length === 0) {
      await ctx.reply(
        `*Portfolio*\n\nNo active positions.\nUse /deposit to start earning yield.` +
        (portfolio.smartAccountAddress ? `\n\nSmart Account: ${portfolio.smartAccountAddress}` : ''),
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const lines = [
      `*Portfolio Summary*`,
      `Smart Account: \`${portfolio.smartAccountAddress}\``,
      `Total Value: $${portfolio.totalValueUsd.toFixed(2)}`,
      `Yield Earned: $${portfolio.yieldEarned.toFixed(2)}`,
      `Arb Profits: $${portfolio.arbProfits.toFixed(2)}`,
      ``,
      `*Positions (${portfolio.positions.length}):*`,
    ];

    for (const p of portfolio.positions) {
      const sim = p.metadata?.isSimulated ? ' [simulated]' : '';
      lines.push(`  ${p.id}: ${p.amount} ${p.token} on ${p.protocol} (${p.entry_apy?.toFixed(2) || '?'}% APY)${sim}`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (e: any) {
    logger.error('Bot /portfolio error: %s', e.message);
    await ctx.reply(`Error: ${e.message}`);
  }
});

// ─── /help command ───
bot.command('help', async (ctx) => {
  await ctx.reply(
    `*DeFAI — Commands*\n\n` +
    `*Yield*\n` +
    `/deposit <amount> <token> — deposit to best yield protocol\n` +
    `/rotate <position_id> — rotate to higher APY\n\n` +
    `*Trading*\n` +
    `"Swap 0.01 BNB to USDT" — token swap via PancakeSwap\n` +
    `/arb — check arbitrage opportunities\n\n` +
    `*Info*\n` +
    `/scan — market data (APYs, prices, funding rates)\n` +
    `/portfolio — your positions and PnL\n` +
    `/trades — recent trade history\n\n` +
    `*Account*\n` +
    `/connect <user_id> — link your dashboard account to Telegram\n` +
    `/start — welcome / registration`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Confirm actions (yield deposit, swap) ───
bot.action('confirm_yield', async (ctx) => {
  const uid = ctx.from.id.toString();
  const pending = pendingActions.get(uid);
  await ctx.answerCbQuery();
  if (!pending) return ctx.reply('No pending action found.');
  pendingActions.delete(uid);
  await pending.execute(ctx);
});

bot.action('cancel', async (ctx) => {
  const uid = ctx.from.id.toString();
  pendingActions.delete(uid);
  await ctx.answerCbQuery();
  await ctx.reply('Action cancelled.');
});

// ─── Main text handler — LLM agent router ───
// IMPORTANT: Must be AFTER bot.command() registrations
bot.on('text', async (ctx) => {
  const telegramId = ctx.from.id;
  const uid = resolveUser(telegramId);

  if (!uid) {
    await ctx.reply('Please use /start first to set up your account.');
    return;
  }

  try {
    const reply = await agentRouter.route(uid, ctx.message.text);
    // Telegram max message length is 4096 chars
    if (reply.length > 4000) {
      await ctx.reply(reply.slice(0, 4000) + '\n\n(truncated)');
    } else {
      await ctx.reply(reply);
    }
  } catch (e: any) {
    logger.error('Bot: error handling text from user %s: %s', uid, e.message);
    await ctx.reply('Something went wrong. Please try again.');
  }
});

export function startBot(): void {
  bot.launch();
  logger.info('Telegram bot launched');
}
