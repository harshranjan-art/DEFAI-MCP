import { getYields, type YieldOpportunity } from '../../core/scanner/apyAggregator';
import { getAllQuotes, getTokenPrices, type PriceQuote } from '../../core/scanner/priceAggregator';
import { getFundingRates, type FundingRate } from '../../core/scanner/fundingRates';
import { logger } from '../../utils/logger';

type Category = 'yield' | 'prices' | 'funding_rates' | 'arbitrage' | 'all';

function formatYields(yields: YieldOpportunity[]): string {
  if (yields.length === 0) return 'No yield opportunities found.';

  const top = yields.slice(0, 15);
  const lines = ['# Yield Opportunities (BSC)\n'];
  lines.push('| Protocol | Pool | Token | APY | TVL | Risk | Testnet |');
  lines.push('|----------|------|-------|-----|-----|------|---------|');

  for (const y of top) {
    const tvl = y.tvl > 0 ? `$${(y.tvl / 1e6).toFixed(1)}M` : '-';
    const testnet = y.isSimulated ? 'Simulated' : 'Real';
    lines.push(`| ${y.protocol} | ${y.pool} | ${y.token} | ${y.apy.toFixed(2)}% | ${tvl} | ${y.risk} | ${testnet} |`);
  }

  lines.push(`\nTotal: ${yields.length} opportunities across ${new Set(yields.map(y => y.protocol)).size} protocols`);
  return lines.join('\n');
}

function formatPrices(quotes: PriceQuote[], prices: any[]): string {
  const lines = ['# Price Quotes (BSC DEXs)\n'];

  if (prices.length > 0) {
    lines.push('## Token Prices (USD)');
    for (const p of prices) {
      lines.push(`- ${p.token}: $${p.priceUsd.toLocaleString()} (${p.source})`);
    }
    lines.push('');
  }

  if (quotes.length > 0) {
    lines.push('## DEX Quotes (BNB/USDT)');
    lines.push('| DEX | Price | 1h Change |');
    lines.push('|-----|-------|-----------|');
    for (const q of quotes) {
      lines.push(`| ${q.dex} | $${q.effectivePrice.toFixed(2)} | ${q.priceImpact.toFixed(2)}% |`);
    }
  } else {
    lines.push('No DEX quotes available.');
  }

  return lines.join('\n');
}

function formatFundingRates(rates: Record<string, FundingRate[]>): string {
  const lines = ['# Funding Rates (Binance Futures)\n'];

  for (const [symbol, data] of Object.entries(rates)) {
    if (data.length === 0) continue;
    const latest = data[0];
    const avg = data.reduce((s, r) => s + r.fundingRate, 0) / data.length;
    lines.push(`## ${symbol}`);
    lines.push(`- Current: ${latest.fundingRate.toFixed(4)}%`);
    lines.push(`- Avg (last ${data.length}): ${avg.toFixed(4)}%`);
    lines.push(`- Last updated: ${latest.fundingTime}`);
    if (latest.fundingRate > 0) {
      lines.push(`- Signal: Longs pay shorts — favorable for delta-neutral (earn funding)`);
    } else {
      lines.push(`- Signal: Shorts pay longs — unfavorable for standard delta-neutral`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatArbitrage(quotes: PriceQuote[]): string {
  const lines = ['# Arbitrage Opportunities (BSC)\n'];

  if (quotes.length < 2) {
    lines.push('Need at least 2 DEX quotes to detect arbitrage. Currently insufficient data.');
    return lines.join('\n');
  }

  let found = 0;
  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      const [cheap, expensive] = quotes[i].effectivePrice < quotes[j].effectivePrice
        ? [quotes[i], quotes[j]] : [quotes[j], quotes[i]];

      const spreadBps = ((expensive.effectivePrice - cheap.effectivePrice) / cheap.effectivePrice) * 10000;

      if (spreadBps > 10) {
        found++;
        const viable = spreadBps > 30 ? 'VIABLE' : 'MARGINAL';
        lines.push(`## ${cheap.dex} → ${expensive.dex} (${viable})`);
        lines.push(`- Buy: $${cheap.effectivePrice.toFixed(4)} on ${cheap.dex}`);
        lines.push(`- Sell: $${expensive.effectivePrice.toFixed(4)} on ${expensive.dex}`);
        lines.push(`- Spread: ${spreadBps.toFixed(0)} bps (${(spreadBps / 100).toFixed(2)}%)`);
        lines.push(`- Est. profit per unit: $${(expensive.effectivePrice - cheap.effectivePrice).toFixed(4)}`);
        lines.push('');
      }
    }
  }

  if (found === 0) {
    lines.push('No significant arbitrage opportunities detected (all spreads < 10 bps).');
  }

  return lines.join('\n');
}

/**
 * Execute scan_markets: fetches data based on category and returns formatted text.
 */
export async function executeScanMarkets(category: Category): Promise<string> {
  logger.info('Scanning markets: category=%s', category);
  const sections: string[] = [];

  if (category === 'yield' || category === 'all') {
    const yields = await getYields();
    sections.push(formatYields(yields));
  }

  if (category === 'prices' || category === 'all' || category === 'arbitrage') {
    const [quotes, prices] = await Promise.all([
      getAllQuotes('BNB', 'USDT', '1'),
      getTokenPrices(),
    ]);

    if (category === 'prices' || category === 'all') {
      sections.push(formatPrices(quotes, prices));
    }
    if (category === 'arbitrage' || category === 'all') {
      sections.push(formatArbitrage(quotes));
    }
  }

  if (category === 'funding_rates' || category === 'all') {
    const rates = await getFundingRates();
    sections.push(formatFundingRates(rates));
  }

  return sections.join('\n\n---\n\n');
}
