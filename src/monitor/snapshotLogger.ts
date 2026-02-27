import cron from 'node-cron';
import { getYields } from '../core/scanner/apyAggregator';
import { getTokenPrices } from '../core/scanner/priceAggregator';
import { insertSnapshot } from '../core/db';
import { logger } from '../utils/logger';

/**
 * Start cron that logs market data to market_snapshots table every 5 minutes.
 * Used by dashboard for historical APY/price charts.
 */
export function startSnapshotLogger(): void {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const [yields, prices] = await Promise.all([
        getYields(),
        getTokenPrices(),
      ]);

      // Log top yields (limit to avoid bloating DB)
      const topYields = yields.slice(0, 10);
      for (const y of topYields) {
        insertSnapshot({
          protocol: y.protocol,
          token: y.token,
          apy: y.apy,
          tvl_usd: y.tvl,
        });
      }

      // Log token prices
      for (const p of prices) {
        insertSnapshot({
          protocol: 'market',
          token: p.token,
          price_usd: p.priceUsd,
        });
      }

      logger.info('Snapshot logged: %d yields, %d prices', topYields.length, prices.length);
    } catch (e: any) {
      logger.error('Snapshot logger failed: %s', e.message);
    }
  });

  logger.info('Snapshot logger started (every 5 minutes)');
}
