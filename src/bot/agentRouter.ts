/**
 * Agent Router — LLM tool-calling layer for the Telegram bot.
 * The LLM decides which tool to invoke (and with what args) based on user message.
 * If no tool matches, it responds conversationally.
 */

import Groq from 'groq-sdk';
import * as engine from '../core/engine';
import * as walletManager from '../core/walletManager';
import { formatDepositResult } from '../mcp/tools/yieldDeposit';
import { executeArbAutoStart, executeArbAutoStop } from '../mcp/tools/arbAuto';
import { executeArbExecute } from '../mcp/tools/arbExecute';
import { executeDeltaNeutralOpen, executeDeltaNeutralClose } from '../mcp/tools/deltaNeutral';
import { executeRiskConfig } from '../mcp/tools/riskConfig';
import { executeSetAlert, executeGetAlerts } from '../mcp/tools/setAlerts';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'yield_deposit',
      description: 'Deposit tokens into the best yield protocol (Venus, Beefy, etc.)',
      parameters: {
        type: 'object',
        required: ['amount', 'token'],
        properties: {
          amount: { type: 'string', description: 'Amount to deposit, e.g. "0.1"' },
          token: { type: 'string', description: 'Token symbol, e.g. "BNB", "USDT"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swap_tokens',
      description: 'Swap one token for another via PancakeSwap V2',
      parameters: {
        type: 'object',
        required: ['from_token', 'to_token', 'amount'],
        properties: {
          from_token: { type: 'string', description: 'Token to sell, e.g. "BNB"' },
          to_token: { type: 'string', description: 'Token to buy, e.g. "USDT"' },
          amount: { type: 'string', description: 'Amount of from_token to swap' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_markets',
      description: 'Scan market data: yields/APYs, prices, funding rates, or arbitrage opportunities',
      parameters: {
        type: 'object',
        required: ['category'],
        properties: {
          category: {
            type: 'string',
            enum: ['yield', 'prices', 'funding_rates', 'arbitrage', 'all'],
            description: '"yield" for APYs, "prices" for token prices, "arbitrage" for cross-DEX spreads, "all" for everything',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description: 'Get the user portfolio: active positions, total value, yield earned, arb profits',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trade_history',
      description: 'Get recent trade history. Use trade_type to filter: "arb" for arbitrage trades, "deposit" for yield deposits, "swap" for token swaps. Omit trade_type for all trades.',
      parameters: {
        type: 'object',
        properties: {
          limit: { description: 'Number of trades to return (default 10)' },
          trade_type: { type: 'string', description: 'Filter by trade type: "arb", "deposit", or "swap". Omit for all.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_arb_status',
      description: 'Check the CURRENTLY ACTIVE arbitrage bot session: status, PnL, trade count, expiry. Only use for current/live session — use get_trade_history with trade_type="arb" for past arb trades.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rotate_position',
      description: 'Rotate an existing yield position to a higher APY protocol',
      parameters: {
        type: 'object',
        required: ['position_id'],
        properties: {
          position_id: { type: 'string', description: 'Position ID from portfolio, e.g. "pos_abc123"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_arb_session',
      description: 'Start an automated arbitrage bot session. Scans every 30s and executes viable cross-DEX trades. Stops when duration expires or loss limit is hit.',
      parameters: {
        type: 'object',
        properties: {
          duration_hours: { type: 'number', description: 'How long to run in hours (default 1)' },
          max_loss_usd: { type: 'number', description: 'Stop if cumulative loss exceeds this USD amount (default 5)' },
          max_slippage_bps: { type: 'number', description: 'Max slippage in basis points (default 50 = 0.5%)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_arb_session',
      description: 'Stop the currently active arbitrage bot session early',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'arb_execute',
      description: 'Scan for and execute a specific arbitrage opportunity. Without opportunity_id, lists available opportunities. With opportunity_id, executes that specific trade.',
      parameters: {
        type: 'object',
        properties: {
          opportunity_id: { type: 'string', description: 'ID of the opportunity to execute. Omit to just list available opportunities.' },
          max_slippage_bps: { type: 'number', description: 'Max slippage in basis points (default 50)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delta_neutral_open',
      description: 'Open a delta-neutral hedged position: spot deposit + virtual short to earn funding yield with no directional exposure',
      parameters: {
        type: 'object',
        required: ['token', 'notional_usd'],
        properties: {
          token: { type: 'string', description: 'Token to hedge, e.g. "BNB"' },
          notional_usd: { type: 'string', description: 'Position size in USD, e.g. "100"' },
          max_funding_rate: { type: 'number', description: 'Max acceptable funding rate (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delta_neutral_close',
      description: 'Close an existing delta-neutral position and realize PnL',
      parameters: {
        type: 'object',
        required: ['position_id'],
        properties: {
          position_id: { type: 'string', description: 'Position ID to close, e.g. "pos_abc123"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'risk_config',
      description: 'View or update risk management settings: max position size, max exposure, slippage, allowed protocols',
      parameters: {
        type: 'object',
        properties: {
          max_position_usd: { type: 'number', description: 'Max single position size in USD' },
          max_total_exposure_usd: { type: 'number', description: 'Max total portfolio exposure in USD' },
          max_slippage_bps: { type: 'number', description: 'Max slippage in basis points' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_alert',
      description: 'Enable or disable an alert type. Types: "apy_drop", "arb_opportunity", "position_health"',
      parameters: {
        type: 'object',
        required: ['alert_type', 'active'],
        properties: {
          alert_type: { type: 'string', description: '"apy_drop", "arb_opportunity", or "position_health"' },
          active: { type: 'boolean', description: 'true to enable, false to disable' },
          threshold: { type: 'number', description: 'Optional threshold value for the alert' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts',
      description: 'View all configured alerts and their current status',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const SYSTEM_PROMPT = [
  'You are DeFAI, an autonomous DeFi assistant running on BSC Testnet.',
  'You help with: yield farming, token swaps (PancakeSwap), arbitrage, portfolio tracking, and market data.',
  '',
  'When the user wants to perform an action or fetch data, call the appropriate tool.',
  'When the user asks what you can do, list your capabilities: yield deposit, yield rotation, token swaps (PancakeSwap), arbitrage (scan/execute/auto-bot), delta-neutral positions, portfolio view, trade history, market data, risk config, alerts.',
  'For general chat or questions without a clear action, respond conversationally — 2-3 sentences max.',
  'Never call a tool with guessed parameters. If an amount or token is missing, ask the user first.',
  'For start_arb_session: always ask the user for duration (hours), max loss (USD), and max slippage (bps) before calling the tool — even though defaults exist, this is an automated trading bot and user must confirm parameters.',
  'For yield_deposit and swap_tokens: always ask for the missing amount or token before calling.',
  'Never mention the underlying AI model.',
].join('\n');

// Per-user conversation history (in-memory, last 10 messages = 5 turns)
type ChatMessage = { role: 'user' | 'assistant'; content: string };
const histories = new Map<string, ChatMessage[]>();
const MAX_HISTORY = 10;

function addToHistory(userId: string, role: 'user' | 'assistant', content: string) {
  const history = histories.get(userId) || [];
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  histories.set(userId, history);
}

type ToolArgs = Record<string, any>;

async function executeTool(name: string, args: ToolArgs, userId: string): Promise<string> {
  logger.info('AgentRouter: executing tool %s args=%j', name, args);

  switch (name) {
    case 'yield_deposit': {
      await walletManager.activate(userId);
      const result = await engine.yieldDeposit(userId, args.token, args.amount);
      return formatDepositResult(result);
    }

    case 'swap_tokens': {
      await walletManager.activate(userId);
      const result = await engine.swapTokens(userId, args.from_token, args.to_token, args.amount);
      return result.message;
    }

    case 'scan_markets': {
      const text = await engine.scanMarkets(args.category);
      return text.length > 3800 ? text.slice(0, 3800) + '\n\n(truncated)' : text;
    }

    case 'get_portfolio': {
      const p = engine.getPortfolio(userId);
      if (p.positions.length === 0) {
        return `No active positions.\nTotal Value: $${p.totalValueUsd.toFixed(2)}\nSmart Account: ${p.smartAccountAddress || 'N/A'}`;
      }
      const lines = [
        `Portfolio — Total Value: $${p.totalValueUsd.toFixed(2)}`,
        `Yield Earned: $${p.yieldEarned.toFixed(2)} | Arb Profits: $${p.arbProfits.toFixed(2)}`,
        '',
        `Positions (${p.positions.length}):`,
      ];
      for (const pos of p.positions) {
        const sim = pos.metadata?.isSimulated ? ' [simulated]' : '';
        lines.push(`  ${pos.id}: ${pos.amount} ${pos.token} on ${pos.protocol} (${pos.entry_apy?.toFixed(2) || '?'}% APY)${sim}`);
      }
      return lines.join('\n');
    }

    case 'get_trade_history': {
      const trades = engine.getTradeHistory(userId, {
        limit: Number(args.limit) || 10,
        type: args.trade_type,
      });
      if (trades.length === 0) return args.trade_type ? `No ${args.trade_type} trades found.` : 'No trades yet.';
      return trades
        .map(t => `${t.type}: ${t.from_amount} ${t.from_token} → ${t.to_amount} ${t.to_token} (${t.protocol}) — ${t.executed_at}`)
        .join('\n');
    }

    case 'get_arb_status': {
      const session = engine.getArbSession(userId);
      if (!session) return 'No active arbitrage session.';
      const pnlSign = session.total_pnl_usd >= 0 ? '+' : '';
      return (
        `Arbitrage Bot — ${session.status.toUpperCase()}\n\n` +
        `PnL: ${pnlSign}$${session.total_pnl_usd.toFixed(4)}\n` +
        `Trades: ${session.trades_count}\n` +
        `Max Loss: $${session.max_loss_usd}\n` +
        `Expires: ${new Date(session.expires_at).toLocaleTimeString()}`
      );
    }

    case 'rotate_position': {
      await walletManager.activate(userId);
      const plan = await engine.checkRotation(args.position_id);
      if (!plan) return 'No better yield found. Your current position is already at the best available APY.';
      const result = await engine.yieldRotate(userId, args.position_id);
      return formatDepositResult(result);
    }

    case 'start_arb_session': {
      const durationHours = Number(args.duration_hours) || 1;
      const maxLossUsd = Number(args.max_loss_usd) || 5;
      const maxSlippageBps = Number(args.max_slippage_bps) || 50;
      return executeArbAutoStart(userId, durationHours, maxLossUsd, maxSlippageBps);
    }

    case 'stop_arb_session': {
      return executeArbAutoStop(userId);
    }

    case 'arb_execute': {
      return await executeArbExecute(userId, args.opportunity_id, args.max_slippage_bps);
    }

    case 'delta_neutral_open': {
      await walletManager.activate(userId);
      return await executeDeltaNeutralOpen(userId, args.token, args.notional_usd, args.max_funding_rate);
    }

    case 'delta_neutral_close': {
      await walletManager.activate(userId);
      return await executeDeltaNeutralClose(userId, args.position_id);
    }

    case 'risk_config': {
      const updates = Object.keys(args).length > 0 ? args : undefined;
      return executeRiskConfig(userId, updates);
    }

    case 'set_alert': {
      return executeSetAlert(userId, args.alert_type, args.active, args.threshold);
    }

    case 'get_alerts': {
      return executeGetAlerts(userId);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export async function route(userId: string, message: string): Promise<string> {
  logger.info('AgentRouter: routing message from user %s: "%s"', userId, message);

  addToHistory(userId, 'user', message);

  try {
    const history = histories.get(userId) || [];

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
      ],
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 500,
      temperature: 0.1,
    });

    const choice = response.choices[0];

    let reply: string;
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      reply = await executeTool(toolCall.function.name, JSON.parse(toolCall.function.arguments) ?? {}, userId);
    } else {
      reply = choice.message.content?.trim() || "I'm not sure how to help with that. Try /help for available commands.";
    }

    addToHistory(userId, 'assistant', reply);
    return reply;
  } catch (e: any) {
    logger.error('AgentRouter: error: %s', e.message);
    return 'Something went wrong. Please try again.';
  }
}
