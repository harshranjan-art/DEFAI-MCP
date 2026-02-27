import * as engine from '../../core/engine';
import { scan } from '../../core/strategy/arbScanner';

export async function executeArbExecute(
  userId: string,
  opportunityId?: string,
  maxSlippageBps?: number,
): Promise<string> {
  // If no specific opportunity chosen, show the list — don't auto-execute
  if (!opportunityId) {
    const opps = await scan();
    if (opps.length === 0) {
      return 'No arbitrage opportunities found right now (all spreads < 10 bps). Try again later.';
    }

    const slippage = maxSlippageBps ?? 50;
    const lines = ['Arbitrage opportunities available — choose one to execute:\n'];
    for (const opp of opps) {
      const executable = opp.spreadBps > slippage;
      const status = executable
        ? '✅ Executable at your slippage limit'
        : `⚠️ Marginal — spread ${opp.spreadBps} bps < your ${slippage} bps limit`;
      lines.push(`ID: ${opp.id}`);
      lines.push(`  Route: ${opp.buyDex} → ${opp.sellDex} | Token: ${opp.token}`);
      lines.push(`  Spread: ${opp.spreadBps} bps | Est. profit: $${opp.estimatedProfitUsd.toFixed(4)}`);
      lines.push(`  ${status}`);
      lines.push('');
    }
    lines.push('To execute: provide the opportunity ID above.');
    return lines.join('\n');
  }

  // Specific opportunity chosen — execute it
  const result = await engine.arbExecute(userId, opportunityId, maxSlippageBps);
  return result.message;
}
