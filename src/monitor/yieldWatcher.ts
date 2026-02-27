import cron from 'node-cron';
import { getVenusAPY } from '../data/venus';

export interface YieldPosition {
  entryAPY: number;
  amount: number;
  protocol: string;
  txHash: string;
  depositedAt: Date;
}

export const positions = new Map<string, YieldPosition>();

let botRef: any = null;

export function setBotRef(b: any): void {
  botRef = b;
}

export function startYieldWatcher(): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const current = await getVenusAPY();
      for (const [userId, pos] of positions) {
        if (pos.entryAPY - current.apy >= 0.5) {
          await botRef?.telegram.sendMessage(
            userId,
            `⚠️ *APY Alert!*\n\nVenus APY dropped from ${pos.entryAPY.toFixed(2)}% → ${current.apy.toFixed(2)}%\n\nYour ${pos.amount} BNB may earn less. Use /rebalance to move funds.`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch { /* never crash the cron */ }
  });
  console.log('[Watcher] Yield watcher started, checking every 5 minutes');
}
