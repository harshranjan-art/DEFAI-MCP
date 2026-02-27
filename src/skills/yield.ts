import { Context, Markup } from 'telegraf';
import { getVenusAPY } from '../data/venus';
import { getPancakeAPY } from '../data/pancake';
import { checkProtocolSecurity } from '../tinyfish/securityMonitor';
import { executeYieldDeposit, getSmartAccountBalance } from '../wallet/execute';
import { remember } from '../utils/memory';
import { pendingActions } from '../utils/storage';
import { positions } from '../monitor/yieldWatcher';
import type { Intent } from '../bot/intentParser';

export async function handleYield(ctx: Context, intent: Intent, userId: string): Promise<void> {
  const amount = intent.amount ?? 0.1;

  await ctx.reply('🔍 Analysing best yield opportunities...');

  // Check smart account balance before proceeding
  const { address, balanceBNB } = await getSmartAccountBalance();
  if (balanceBNB < amount) {
    await ctx.reply(
      `⚠️ *Smart Account needs funding!*\n\nYou want to deposit *${amount} BNB* but your smart account only has *${balanceBNB.toFixed(4)} BNB*.\n\n📬 Send at least *${amount} BNB* to your smart account first:\n\`${address}\`\n\n_Gas fees are sponsored by Pimlico — you only need BNB for the actual deposit._`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [venus, pancake, security] = await Promise.all([
    getVenusAPY(),
    getPancakeAPY(),
    checkProtocolSecurity('Venus'),
  ]);

  const options = [venus, pancake].sort((a, b) => b.apy - a.apy);
  const best = options[0];
  const other = options[1];

  const monthly = (amount * best.apy / 100 / 12).toFixed(4);
  const annual = (amount * best.apy / 100).toFixed(4);

  const whyBest = amount < 0.5
    ? `${best.protocol} is ideal for smaller amounts with lower gas overhead.`
    : `${best.protocol} offers the highest APY with deep liquidity for your deposit size.`;

  const securityLine = security.safe
    ? '✅ No recent exploits found'
    : `⚠️ Warning: ${security.warning}`;

  const message = [
    `📊 *Yield Comparison*`,
    ``,
    `| Protocol | APY |`,
    `|----------|-----|`,
    `| 🏆 ${best.protocol} | ${best.apy.toFixed(2)}% |`,
    `| ${other.protocol} | ${other.apy.toFixed(2)}% |`,
    ``,
    `💡 ${whyBest}`,
    ``,
    `💰 *Deposit:* ${amount} BNB into ${best.protocol}`,
    `📅 Monthly yield: ~${monthly} BNB`,
    `📅 Annual yield: ~${annual} BNB`,
    ``,
    `🔒 Security: ${securityLine}`,
    `⛽ Gasless via Pimlico AA | Non-custodial Smart Account`,
  ].join('\n');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`✅ Confirm Deposit (${amount} BNB)`, 'confirm_yield')],
      [Markup.button.callback('❌ Cancel', 'cancel')],
    ]),
  });

  pendingActions.set(userId, {
    type: 'YIELD',
    execute: async (c: Context) => {
      await c.reply('⏳ Submitting via Pimlico AA...');
      const result = await executeYieldDeposit(amount);
      if (result.success) {
        await remember(
          userId,
          `Deposited ${amount} BNB to ${best.protocol} at ${best.apy.toFixed(2)}% APY. TxHash: ${result.txHash}. Date: ${new Date().toISOString()}`
        );
        positions.set(userId, {
          entryAPY: best.apy,
          amount,
          protocol: best.protocol,
          txHash: result.txHash ?? '',
          depositedAt: new Date(),
        });
        await c.reply(
          `✅ Deposit confirmed!\n\n💰 ${amount} BNB → ${best.protocol}\n📈 APY: ${best.apy.toFixed(2)}%\n\n🔗 [View on BSCScan](${result.explorerUrl})`,
          { parse_mode: 'Markdown' }
        );
      } else {
        console.error('[Yield] Deposit failed:', result.error);
        await c.reply(`❌ Deposit failed. Please check your smart account has enough BNB and try again.`);
      }
    },
  });
}
