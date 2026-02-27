# DeFAI — Autonomous DeFi Agent

An autonomous DeFi agent on BSC Testnet with MCP server, Telegram bot, REST API, and React dashboard. Supports yield optimization, cross-DEX arbitrage, delta-neutral strategies, and multi-user identity — all gasless via ERC-4337 Account Abstraction.

## Quick Start

```bash
npm run dev          # Start bot + crons + API server (ts-node src/index.ts)
npm run mcp          # Start MCP server (stdio transport for Claude Desktop)
npm run mcp:sse      # Start MCP server (SSE transport on port 3001)
npm run api          # Start REST API only (port 3002)
npm run bot          # Start Telegram bot only
npm run build        # Compile TypeScript to dist/

# Dashboard (separate)
cd dashboard && npm install && npm run dev   # Vite dev server on port 5173
```

## Environment Variables (.env)

| Variable            | Purpose                                  |
|---------------------|------------------------------------------|
| `PRIVATE_KEY`       | EOA private key (hex). Auto-creates default user on first startup. |
| `PIMLICO_API_KEY`   | Pimlico bundler + paymaster API key      |
| `TELEGRAM_BOT_TOKEN`| Telegraf bot token from BotFather        |
| `GROQ_API_KEY`      | Groq API key (Llama 3.3 70B for Telegram agent router) |
| `BSC_TESTNET_RPC`   | (Optional) Custom BSC Testnet RPC        |
| `JWT_SECRET`        | JWT signing secret for dashboard API     |
| `DEFAI_USER_ID`     | (Optional) Resume MCP session as existing user |
| `MCP_TRANSPORT`     | `stdio` (default) or `sse`               |

## Architecture

```
src/index.ts                    ← Entry: starts bot + crons + API server
│
├── core/
│   ├── engine.ts               ← Thin orchestrator — ALL transports call this
│   ├── db.ts                   ← SQLite (better-sqlite3, WAL mode, full schema)
│   ├── userResolver.ts         ← Multi-transport user resolution + creation
│   ├── walletManager.ts        ← Per-user wallet sessions (SmartAccountClient cache)
│   ├── positionTracker.ts      ← SQLite-backed position CRUD + portfolio
│   ├── tradeLogger.ts          ← SQLite-backed trade logging
│   ├── riskManager.ts          ← Per-user risk config + pre-execution checks
│   ├── scanner/
│   │   ├── cache.ts            ← Generic TTL cache
│   │   ├── apyAggregator.ts    ← Venus + Beefy + DefiLlama yields
│   │   ├── priceAggregator.ts  ← CoinGecko + DexScreener prices
│   │   └── fundingRates.ts     ← Binance Futures funding rates
│   └── strategy/
│       ├── types.ts            ← Shared strategy types
│       ├── yieldOptimizer.ts   ← Deposit + rotate to best yield
│       ├── arbScanner.ts       ← Cross-DEX spread detection + execution
│       └── deltaNeutral.ts     ← Spot + virtual short (funding yield)
│
├── adapters/
│   ├── types.ts                ← ProtocolAdapter interface
│   ├── venus.ts                ← Real testnet supply/withdraw
│   ├── pancakeswap.ts          ← Real testnet V2 Router swaps
│   ├── thena.ts                ← Simulated (DexScreener prices)
│   └── biswap.ts               ← Simulated (DexScreener prices)
│
├── mcp/
│   ├── server.ts               ← MCP server (stdio + SSE transport)
│   └── tools/                  ← 12 MCP tools (all call engine.*)
│       ├── scanMarkets.ts, yieldDeposit.ts, yieldRotate.ts
│       ├── portfolio.ts, tradeHistory.ts, swapTokens.ts
│       ├── arbExecute.ts, deltaNeutral.ts, riskConfig.ts
│       └── setAlerts.ts, linkTransport.ts
│
├── bot/
│   ├── index.ts                ← Telegraf bot (commands + text handler via agentRouter)
│   ├── agentRouter.ts          ← LLM tool-calling agent (Groq Llama 3.3 70B, 15 tools, 5-turn history)
│   └── intentParser.ts         ← (deprecated — replaced by agentRouter)
│
├── api/
│   ├── server.ts               ← Express REST API (port 3002)
│   ├── middleware/auth.ts       ← JWT authentication
│   └── routes/                 ← auth, portfolio, trades, markets, alerts
│
├── monitor/
│   ├── yieldWatcher.ts         ← Cron: APY drop alerts (5 min)
│   ├── arbWatcher.ts           ← Cron: arb opportunity alerts (2 min)
│   ├── positionHealth.ts       ← Cron: delta-neutral funding alerts (5 min)
│   ├── snapshotLogger.ts       ← Cron: market data to SQLite (5 min)
│   └── alertDispatcher.ts      ← Telegram + notification delivery
│
├── wallet/
│   ├── pimlico.ts              ← SmartAccountClient singleton
│   ├── execute.ts              ← Legacy on-chain execution
│   └── encryption.ts           ← AES-256-GCM key encryption
│
├── utils/
│   ├── logger.ts               ← pino (stderr for MCP stdio compat)
│   ├── constants.ts            ← Addresses, ABIs, API URLs
│   ├── storage.ts              ← In-memory maps for bot state
│   └── memory.ts               ← Supermemory SDK wrapper
│
└── data/
    ├── venus.ts                ← Venus APY (live API)
    └── pancake.ts              ← PancakeSwap APR (live API)

dashboard/                      ← React SPA (Vite + Tailwind + React Query)
├── src/api/client.ts           ← JWT-authenticated API client
├── src/pages/                  ← Login, Dashboard, Portfolio, Trades, Markets, Settings
└── src/components/Layout.tsx   ← Sidebar navigation
```

## Key Design Patterns

### Core Engine (engine.ts)
- **Single orchestrator**: MCP tools, Telegram commands, and API routes ALL call `engine.*()` methods. Never call strategies or adapters directly from transports.
- **Risk checks**: Engine calls `riskManager.check()` before every strategy execution.
- Methods: `scanMarkets`, `yieldDeposit`, `yieldRotate`, `swapTokens`, `arbExecute`, `deltaNeutralOpen`, `deltaNeutralClose`, `configureRisk`, `setAlert`, `getPortfolio`, `getTradeHistory`, `getArbSession`

### Telegram Agent Router (agentRouter.ts)
- **LLM tool-calling layer**: Free-text messages from Telegram users go through Groq Llama 3.3 70B with 15 registered tools (full MCP parity). The LLM decides which tool to invoke based on intent.
- **Conversation history**: Per-user in-memory history capped at 10 messages (5 turns). Enables multi-turn context ("actually make it 0.1 BNB").
- **Idempotent wallet activation**: `walletManager.activate()` is called before every wallet-requiring tool — it's a no-op if already active, so no "wallet not activated" errors after server restart.
- **Null-safe args**: Tool arguments parsed as `JSON.parse(args) ?? {}` to handle parameterless tool calls.
- **Confirmations for destructive actions**: System prompt instructs LLM to ask for `start_arb_session` parameters (duration, max loss, slippage) before executing — even though defaults exist.

### Multi-User Identity
- Users stored in SQLite with encrypted private keys (AES-256-GCM)
- Resolution: `resolveFromEnv()` | `resolveFromApiKey()` | `resolveFromTelegram()`
- Default user auto-created from `PRIVATE_KEY` env on first startup (backward compat)
- API keys (`dfai_k_*`) for dashboard login, JWT for session auth

### Simulated vs Real Protocols
- **Real testnet execution**: Venus (supply/withdraw), PancakeSwap V2 (swaps)
- **Simulated (real data, mocked tx)**: Beefy, DefiLlama, Thena, BiSwap
- All simulated protocols flagged with `isSimulated: true`
- Delta-neutral short leg always simulated (no perp DEX on testnet)

### Alert System
- Shared `alertDispatcher.ts` for all watchers
- Delivery: Telegram (if linked) + stored as unread notification (for dashboard)
- Types: `apy_drop`, `arb_opportunity`, `position_health`

## Tech Stack

| Layer               | Technology                                    |
|---------------------|-----------------------------------------------|
| MCP Server          | @modelcontextprotocol/sdk (stdio + SSE)       |
| Bot                 | Telegraf (Telegram Bot API)                   |
| API                 | Express + JWT + CORS                          |
| Dashboard           | React + Vite + Tailwind CSS + React Query     |
| LLM                 | Groq SDK → Llama 3.3 70B                      |
| Database            | better-sqlite3 (WAL mode)                     |
| Blockchain          | viem (BSC Testnet, Chain ID 97)               |
| Account Abstraction | permissionless + Pimlico (ERC-4337 v0.7)      |
| Logger              | pino (to stderr for MCP stdio compat)         |
| Scheduling          | node-cron                                     |
| Language            | TypeScript (strict, ES2022, CommonJS)         |

## On-Chain Addresses (BSC Testnet, Chain 97)

| Contract                    | Address                                      |
|-----------------------------|----------------------------------------------|
| EntryPoint v0.7             | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SimpleAccountFactory v0.7   | `0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985` |
| Venus vBNB                  | `0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c` |
| PancakeSwap V2 Router       | `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` |
| WBNB Testnet                | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` |
| Testnet USDT                | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` |
| Pimlico Paymaster           | `0x0000000000000039cd5e8aE05257CE51C473ddd1` |

## MCP Tools (12)

| Tool                  | Description                                        |
|-----------------------|----------------------------------------------------|
| `ping`                | Test connectivity                                  |
| `wallet_setup`        | Register/resume wallet                             |
| `scan_markets`        | APYs, prices, funding rates, arbitrage             |
| `yield_deposit`       | Deposit to best yield protocol                     |
| `yield_rotate`        | Rotate to higher APY                               |
| `swap_tokens`         | PancakeSwap V2 token swap                          |
| `arb_execute`         | Cross-DEX arbitrage                                |
| `delta_neutral_open`  | Open hedged position                               |
| `delta_neutral_close` | Close hedged position + PnL                        |
| `risk_config`         | View/update risk settings                          |
| `set_alerts`          | Enable/disable alerts                              |
| `get_alerts`          | View alert config                                  |
| `link_telegram`       | Instructions to link Telegram                      |
| `portfolio`           | Full portfolio + positions                         |
| `trade_history`       | Past trades with filters                           |

## Common Pitfalls

- **AA23 reverted**: Factory/EntryPoint version mismatch. Always v0.7 + v0.7.
- **Logger to stdout breaks MCP stdio**: pino MUST write to stderr (fd 2). stdout is reserved for MCP protocol.
- **Command handlers before `bot.on('text')`**: Telegraf routes commands to text handler if registered after.
- **npm ERESOLVE with ox**: permissionless and viem have conflicting ox peer deps. Use `--legacy-peer-deps`.
- **Singleton wallet init**: `_initPromise` caches init. Restart process if wallet config changes.
- **Telegram Markdown parse errors**: Underscores in position IDs (e.g. `pos_abc123`) are treated as italic markers by Telegram Markdown v1. Never use `{ parse_mode: 'Markdown' }` for plain-text replies — omit it entirely.
- **AgentRouter null args crash**: Groq sends `"null"` as arguments for parameterless tools (e.g. `get_portfolio`). Always parse as `JSON.parse(args) ?? {}` — never `JSON.parse(args)` directly.
- **LLM uses defaults silently for trading actions**: Add explicit system prompt rules to require user confirmation before `start_arb_session` — the LLM will otherwise proceed with documented defaults without asking.
