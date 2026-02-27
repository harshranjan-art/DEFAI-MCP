import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import 'dotenv/config';
import { logger } from '../utils/logger';
import * as userResolver from '../core/userResolver';
import * as walletManager from '../core/walletManager';
import * as dbOps from '../core/db';
import { executeScanMarkets } from './tools/scanMarkets';
import { executeYieldDeposit } from './tools/yieldDeposit';
import { executeYieldRotate } from './tools/yieldRotate';
import { executePortfolio } from './tools/portfolio';
import { executeTradeHistory } from './tools/tradeHistory';
import { executeSwapTokens } from './tools/swapTokens';
import { executeArbExecute } from './tools/arbExecute';
import { executeDeltaNeutralOpen, executeDeltaNeutralClose } from './tools/deltaNeutral';
import { executeRiskConfig } from './tools/riskConfig';
import { executeSetAlert, executeGetAlerts } from './tools/setAlerts';
import { executeLinkTelegram } from './tools/linkTransport';
import { executeArbAutoStart, executeArbAutoStop, executeArbAutoStatus } from './tools/arbAuto';
import { startAutoArbExecutor } from '../monitor/autoArbExecutor';

const server = new McpServer({
  name: 'defai-bnb',
  version: '0.1.0',
});

// Session → userId mapping
const sessionUsers = new Map<string, string>();

function getUserId(sessionId: string): string {
  const uid = sessionUsers.get(sessionId) || sessionUsers.get('default');
  if (!uid) throw new Error('No wallet registered. Call wallet_setup first.');
  return uid;
}

// ─── TOOL: ping ───
server.tool(
  'ping',
  'Test connectivity to DeFAI MCP server',
  {},
  async () => ({
    content: [{ type: 'text' as const, text: 'pong — DeFAI MCP is alive on BSC Testnet (Chain 97)' }],
  })
);

// ─── TOOL: wallet_setup ───
server.tool(
  'wallet_setup',
  'Register your wallet. Provide EOA private key and a passphrase to encrypt it at rest. Returns userId, smart account address, and API key. Save the userId for future sessions.',
  {
    private_key: z.string().describe('EOA private key (hex, with or without 0x prefix)'),
    passphrase: z.string().describe('Passphrase to encrypt your key at rest'),
    existing_user_id: z.string().optional().describe('If returning user, provide your userId to resume session'),
  },
  async ({ private_key, passphrase, existing_user_id }, extra) => {
    try {
      const sessionId = (extra as any)?.sessionId || 'default';

      // Returning user — activate existing wallet
      if (existing_user_id) {
        const user = dbOps.getUser(existing_user_id);
        if (!user) {
          return {
            content: [{ type: 'text' as const, text: `Error: User ${existing_user_id} not found in database.` }],
          };
        }

        const address = await walletManager.activate(existing_user_id, passphrase);
        sessionUsers.set(sessionId, existing_user_id);

        return {
          content: [{
            type: 'text' as const,
            text: [
              `Welcome back!`,
              `User ID: ${existing_user_id}`,
              `Smart Account: ${address}`,
              `BSCScan: https://testnet.bscscan.com/address/${address}`,
              `Wallet activated — all transactions are gasless via Pimlico.`,
            ].join('\n'),
          }],
        };
      }

      // New user — create and activate
      const result = await userResolver.createUser({
        privateKey: private_key,
        passphrase,
        label: 'mcp-stdio',
      });

      await walletManager.activate(result.id, passphrase);
      sessionUsers.set(sessionId, result.id);

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Wallet registered successfully!`,
            ``,
            `User ID: ${result.id}`,
            `  (save this — use as existing_user_id for future sessions)`,
            `Smart Account: ${result.smartAccountAddress}`,
            `API Key: ${result.apiKey}`,
            `  (use for dashboard login or MCP SSE auth)`,
            `BSCScan: https://testnet.bscscan.com/address/${result.smartAccountAddress}`,
            ``,
            `All transactions are gasless via Pimlico.`,
            `Fund your smart account with testnet BNB: https://testnet.bnbchain.org/faucet-smart`,
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      logger.error('wallet_setup failed: %s', e.message);
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
      };
    }
  }
);

// ─── TOOL: scan_markets ───
server.tool(
  'scan_markets',
  'Scan current DeFi market conditions on BSC. Returns APYs from Venus/Beefy/DefiLlama, DEX prices, Binance funding rates, and arbitrage opportunities.',
  {
    category: z.enum(['yield', 'prices', 'funding_rates', 'arbitrage', 'all']).describe('What to scan'),
  },
  async ({ category }) => {
    try {
      const result = await executeScanMarkets(category);
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (e: any) {
      logger.error('scan_markets failed: %s', e.message);
      return {
        content: [{ type: 'text' as const, text: `Error scanning markets: ${e.message}` }],
      };
    }
  }
);

// ─── TOOL: yield_deposit ───
server.tool(
  'yield_deposit',
  'Deposit tokens into the highest-APY protocol. Compares Venus, Beefy, DefiLlama and picks the best. Requires wallet_setup first.',
  {
    token: z.string().describe('Token symbol (e.g., BNB, USDT)'),
    amount: z.string().describe('Amount to deposit (e.g., "0.1")'),
    protocol: z.string().optional().describe('Force a specific protocol (optional — auto-selects best if omitted)'),
  },
  async ({ token, amount, protocol }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeYieldDeposit(userId, token, amount, protocol);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: yield_rotate ───
server.tool(
  'yield_rotate',
  'Check if a better yield exists and rotate funds. Withdraws from current protocol, deposits into higher-APY one. Requires wallet_setup first.',
  {
    position_id: z.string().describe('Position ID to rotate (from portfolio)'),
    min_improvement_bps: z.number().optional().describe('Minimum APY improvement in basis points to trigger rotation (default: 50)'),
  },
  async ({ position_id, min_improvement_bps }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeYieldRotate(userId, position_id, min_improvement_bps);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: portfolio ───
server.tool(
  'portfolio',
  'Full portfolio: balances, open positions, PnL, yield earned. Requires wallet_setup first.',
  {},
  async (_, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executePortfolio(userId);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: trade_history ───
server.tool(
  'trade_history',
  'Get past trades with optional filters. Requires wallet_setup first.',
  {
    limit: z.number().optional().describe('Number of trades to return (default: 20)'),
    type: z.string().optional().describe('Filter by type: swap, deposit, withdraw, arb_buy, arb_sell, rotation'),
  },
  async ({ limit, type }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeTradeHistory(userId, limit, type);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: swap_tokens ───
server.tool(
  'swap_tokens',
  'Swap tokens via PancakeSwap V2 on BSC Testnet. Supports BNB↔USDT and token-to-token swaps. Requires wallet_setup first.',
  {
    from_token: z.string().describe('Token to sell (e.g., BNB, USDT)'),
    to_token: z.string().describe('Token to buy (e.g., USDT, BNB)'),
    amount: z.string().describe('Amount of from_token to swap (e.g., "0.01")'),
  },
  async ({ from_token, to_token, amount }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeSwapTokens(userId, from_token, to_token, amount);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: arb_execute ───
server.tool(
  'arb_execute',
  'Scan for cross-DEX arbitrage opportunities and execute the best one. Compares PancakeSwap, Thena, and BiSwap prices. Requires wallet_setup first.',
  {
    opportunity_id: z.string().optional().describe('Specific opportunity ID to execute (from scan_markets arbitrage). Auto-selects best if omitted.'),
    max_slippage_bps: z.number().optional().describe('Maximum slippage in basis points (default: 50)'),
  },
  async ({ opportunity_id, max_slippage_bps }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeArbExecute(userId, opportunity_id, max_slippage_bps);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: delta_neutral_open ───
server.tool(
  'delta_neutral_open',
  'Open a delta-neutral position: buy spot + virtual short. Earns yield from positive funding rates while hedging price risk. Requires wallet_setup first.',
  {
    token: z.string().describe('Token to trade (e.g., BNB, ETH)'),
    notional_usd: z.string().describe('Notional size in USD (e.g., "100")'),
    max_funding_rate: z.number().optional().describe('Max acceptable funding rate % (optional)'),
  },
  async ({ token, notional_usd, max_funding_rate }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeDeltaNeutralOpen(userId, token, notional_usd, max_funding_rate);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: delta_neutral_close ───
server.tool(
  'delta_neutral_close',
  'Close a delta-neutral position and realize PnL. Requires wallet_setup first.',
  {
    position_id: z.string().describe('Position ID to close (from portfolio)'),
  },
  async ({ position_id }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = await executeDeltaNeutralClose(userId, position_id);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: risk_config ───
server.tool(
  'risk_config',
  'View or update risk management settings. Controls max position size, total exposure, slippage limits, and allowed protocols.',
  {
    max_position_usd: z.number().optional().describe('Max single position size in USD'),
    max_total_exposure_usd: z.number().optional().describe('Max total exposure across all positions in USD'),
    max_slippage_bps: z.number().optional().describe('Max slippage in basis points'),
    allowed_protocols: z.array(z.string()).optional().describe('List of allowed protocol names (empty = all)'),
    max_delta_neutral_positions: z.number().optional().describe('Max number of concurrent delta-neutral positions'),
  },
  async ({ max_position_usd, max_total_exposure_usd, max_slippage_bps, allowed_protocols, max_delta_neutral_positions }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const updates: any = {};
      if (max_position_usd !== undefined) updates.max_position_usd = max_position_usd;
      if (max_total_exposure_usd !== undefined) updates.max_total_exposure_usd = max_total_exposure_usd;
      if (max_slippage_bps !== undefined) updates.max_slippage_bps = max_slippage_bps;
      if (allowed_protocols !== undefined) updates.allowed_protocols = allowed_protocols;
      if (max_delta_neutral_positions !== undefined) updates.max_delta_neutral_positions = max_delta_neutral_positions;
      const result = executeRiskConfig(userId, Object.keys(updates).length > 0 ? updates : undefined);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: set_alerts ───
server.tool(
  'set_alerts',
  'Enable or disable alert notifications. Types: apy_drop, arb_opportunity, position_health. Alerts are delivered via Telegram if linked, otherwise stored for dashboard.',
  {
    alert_type: z.string().describe('Alert type: apy_drop, arb_opportunity, or position_health'),
    active: z.boolean().describe('Enable (true) or disable (false) the alert'),
    threshold: z.number().optional().describe('Optional threshold value (e.g., APY drop % or spread bps)'),
  },
  async ({ alert_type, active, threshold }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeSetAlert(userId, alert_type, active, threshold);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: get_alerts ───
server.tool(
  'get_alerts',
  'View all configured alert settings and their last trigger times.',
  {},
  async (_, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeGetAlerts(userId);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: link_telegram ───
server.tool(
  'link_telegram',
  'Get instructions to link your Telegram account for receiving alerts and using commands.',
  {},
  async (_, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeLinkTelegram(userId);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: arb_auto_start ───
server.tool(
  'arb_auto_start',
  'Start automated arbitrage for a fixed duration. Scans every 30s and executes all viable opportunities. Stops automatically when time expires or cumulative loss limit is hit. All trades are logged.',
  {
    duration_hours: z.number().describe('How many hours to run (e.g. 6)'),
    max_loss_usd: z.number().describe('Stop if total loss exceeds this USD amount (e.g. 5)'),
    max_slippage_bps: z.number().optional().describe('Max slippage per trade in basis points (default: 50)'),
  },
  async ({ duration_hours, max_loss_usd, max_slippage_bps }, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeArbAutoStart(userId, duration_hours, max_loss_usd, max_slippage_bps ?? 50);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: arb_auto_stop ───
server.tool(
  'arb_auto_stop',
  'Stop the currently running automated arbitrage session.',
  {},
  async (_args, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeArbAutoStop(userId);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── TOOL: arb_auto_status ───
server.tool(
  'arb_auto_status',
  'Check the status of your automated arbitrage session — trades executed, total P&L, time remaining.',
  {},
  async (_args, extra) => {
    try {
      const userId = getUserId((extra as any)?.sessionId || 'default');
      const result = executeArbAutoStatus(userId);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ─── RESOURCE: supported_protocols ───
server.resource(
  'supported_protocols',
  'defai://protocols',
  async () => ({
    contents: [{
      uri: 'defai://protocols',
      mimeType: 'application/json',
      text: JSON.stringify({
        yield: ['Venus (real testnet)', 'Beefy Finance (simulated)', 'DefiLlama aggregated (simulated)'],
        dex: ['PancakeSwap V2 (real testnet)', 'Thena (simulated)', 'BiSwap (simulated)'],
        perps: ['Simulated (Binance funding rates for PnL calculation)'],
        chain: 'BSC Testnet (Chain ID 97)',
        note: 'Simulated protocols use real mainnet data but transactions are mocked on testnet',
      }, null, 2),
    }],
  })
);

// ─── STARTUP ───
async function resolveDefaultUser() {
  const envUserId = userResolver.resolveFromEnv();
  if (envUserId) {
    sessionUsers.set('default', envUserId);
    logger.info('Resolved user from DEFAI_USER_ID: %s', envUserId);
    return;
  }

  const defaultId = await userResolver.ensureDefaultUser();
  if (defaultId) {
    sessionUsers.set('default', defaultId);
    await walletManager.activate(defaultId, 'defai-dev-default');
  }
}

async function startStdio() {
  await resolveDefaultUser();
  startAutoArbExecutor();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('DeFAI MCP server started (stdio transport)');
}

async function startSse(port: number = 3001) {
  await resolveDefaultUser();
  startAutoArbExecutor();

  const app = express();
  let sseTransport: SSEServerTransport | null = null;

  app.get('/sse', async (req, res) => {
    // Authenticate via Bearer token (API key)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const apiKey = authHeader.slice(7);
      const userId = userResolver.resolveFromApiKey(apiKey);
      if (userId) {
        sessionUsers.set('sse', userId);
      }
    }

    sseTransport = new SSEServerTransport('/messages', res);
    await server.connect(sseTransport);
    logger.info('SSE client connected');
  });

  app.post('/messages', async (req, res) => {
    if (!sseTransport) {
      res.status(400).json({ error: 'No SSE connection. Connect to /sse first.' });
      return;
    }
    await sseTransport.handlePostMessage(req, res);
  });

  app.listen(port, () => {
    logger.info('DeFAI MCP server started (SSE transport on port %d)', port);
  });
}

const transportMode = process.env.MCP_TRANSPORT || 'stdio';

if (transportMode === 'sse') {
  startSse().catch((e) => {
    logger.error('MCP SSE startup failed: %s', e.message);
    process.exit(1);
  });
} else {
  startStdio().catch((e) => {
    logger.error('MCP stdio startup failed: %s', e.message);
    process.exit(1);
  });
}

export { server, sessionUsers, getUserId };
