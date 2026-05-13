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
| `GROQ_API_KEY`      | Groq API key (Llama 3.3 70B planner / 8B verifier). Required when `LLM_PROVIDER=groq`. |
| `BSC_TESTNET_RPC`   | (Optional) Custom BSC Testnet RPC        |
| `JWT_SECRET`        | JWT signing secret for dashboard API (≥32 chars, required). |
| `ENCRYPTION_KEY`    | AES-256-GCM key for private-key storage (≥32 chars, required). |
| `DEFAI_USER_ID`     | (Optional) Resume MCP session as existing user |
| `MCP_TRANSPORT`     | `stdio` (default) or `sse`               |
| **LLM provider (Phase 7A+)** | |
| `LLM_PROVIDER`      | `groq` (default) or `vertex`. Switches every LLM call between Llama (Groq) and Gemini 3 (Vertex). |
| `GCP_PROJECT_ID`    | Required when `LLM_PROVIDER=vertex`. |
| `GCP_LOCATION`      | Vertex region; default `us-central1`. |
| `VECTOR_MEMORY_PROVIDER` | `stub` (default) or `vertex`. Selects embedder for episodic memory. |
| **Postgres backend (Phase 7C+, optional)** | |
| `CLOUD_SQL_CONNECTION_NAME` | When set, app connects via Cloud SQL Auth Proxy unix socket. |
| `POSTGRES_URL`      | Full libpq connection string (used when not on Cloud SQL). |
| `POSTGRES_HOST`/`_PORT`/`_USER`/`_PASSWORD`/`_DATABASE` | Discrete env-var alternative to `POSTGRES_URL`. |
| **Cloud Run deploy (Phase 7E+)** | |
| `PORT`              | Server port. Cloud Run injects 8080; local default 3002. |
| `TELEGRAM_MODE`     | `polling` (default) or `webhook`. Webhook required on Cloud Run. |
| `TELEGRAM_WEBHOOK_SECRET` | (Optional) Telegram's `secret_token` header for webhook auth. |
| `TELEGRAM_WEBHOOK_URL` | (Optional) Base URL — when set, app auto-calls Telegram's setWebhook on boot. |

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
│   ├── postgres/               ← Phase 7C — pg.Pool, schema, migrations (caller migration is 7C.1)
│   │   ├── index.ts            ← Public API: query, withTransaction, getPostgresPool
│   │   ├── pool.ts             ← Lifecycle owner; reads CLOUD_SQL_CONNECTION_NAME / POSTGRES_URL
│   │   └── schema.ts           ← Schema + bundled migrations (versioned via schema_migrations)
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
│   └── tools/                  ← 19 MCP tools (all call engine.*)
│       ├── scanMarkets.ts, yieldDeposit.ts, yieldRotate.ts
│       ├── portfolio.ts, tradeHistory.ts, swapTokens.ts, sendTokens.ts
│       ├── arbExecute.ts, arbAuto.ts (start/stop/status), deltaNeutral.ts, riskConfig.ts
│       └── setAlerts.ts, linkTransport.ts
│
├── bot/
│   ├── index.ts                ← Telegraf bot (polling OR webhook via startBotWebhook)
│   ├── agentRouter.ts          ← LLM tool-calling agent (provider-agnostic; planner via getLLMProvider)
│   ├── verifier.ts             ← Layer-3 sub-agent (fresh context, JSON-only output)
│   ├── intentClassifier.ts     ← Fast classifier routing read-only → cheap variant
│   └── summarizer.ts           ← Conversation-history compression
│
├── llm/                        ← Phase 7A provider abstraction
│   ├── types.ts                ← LLMProvider interface (chat / modelFor / name)
│   ├── groqProvider.ts         ← Groq SDK impl (Llama models)
│   ├── vertexProvider.ts       ← Vertex AI impl (Gemini 3 Pro / Flash)
│   └── index.ts                ← getLLMProvider() singleton, LLM_PROVIDER env switch
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
│   └── encryption.ts           ← AES-256-GCM key encryption
│
├── utils/
│   ├── logger.ts               ← pino (stderr for MCP stdio compat)
│   ├── constants.ts            ← Addresses, ABIs, API URLs
│   ├── storage.ts              ← In-memory maps for bot state
│   ├── vectorMemory.ts         ← Phase 7D — episodic memory (Vertex embeddings + cosine recall)
│   └── lifecycle.ts            ← Shutdown registry (SIGTERM/SIGINT, 15s timeout)
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
- Methods: `scanMarkets`, `yieldDeposit`, `yieldRotate`, `swapTokens`, `sendTokens`, `arbExecute`, `deltaNeutralOpen`, `deltaNeutralClose`, `configureRisk`, `setAlert`, `getPortfolio`, `getTradeHistory`, `getArbSession`

### Telegram Agent Router (agentRouter.ts)
- **LLM tool-calling layer**: Free-text messages from Telegram users go through `getLLMProvider().chat(...)` — Llama 3.3 70B on Groq (default) or Gemini 3 Pro on Vertex (when `LLM_PROVIDER=vertex`). 16 registered tools (functional MCP parity — excludes setup/meta tools).
- **Provider-agnostic since Phase 7A**: every LLM call (planner, verifier, classifier, summarizer, judge) routes through `LLMProvider`. Switching stacks is a one-line env flip; no code change.
- **Intent-routed model tiering (Phase 6.5)**: read-only queries get the cheap variant (Llama-70B-versatile / Gemini 3 Flash); write or low-confidence intents get the flagship (Llama-3.3-70B / Gemini 3 Pro). `pickPlannerModel(verdict, provider)` returns the resolved id per provider.
- **Conversation history**: Per-user in-memory cap at MAX_HISTORY (30 turns); older turns compressed by `summarizer.ts` once length exceeds SUMMARIZE_THRESHOLD (12). Last KEEP_VERBATIM (6) turns always stay raw.
- **Idempotent wallet activation**: `walletManager.activate()` is called before every wallet-requiring tool — it's a no-op if already active, so no "wallet not activated" errors after server restart.
- **Null-safe args**: Tool arguments parsed as `JSON.parse(args) ?? {}` to handle parameterless tool calls.
- **Confirmations for destructive actions**: System prompt instructs LLM to ask for `start_arb_session` parameters (duration, max loss, slippage) before executing — even though defaults exist.
- **Verifier gate (Phase 3)**: write tools run through `verify(...)` — a fresh-context 8B/Flash sub-agent that returns approve/reject with flags. Different system prompt than the planner so an injection that hijacked the planner can't bypass it.

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
| Bot                 | Telegraf (polling for local; webhook on Cloud Run) |
| API                 | Express + JWT + CORS                          |
| Dashboard           | React + Vite + Tailwind CSS + React Query     |
| LLM (default)       | Groq SDK → Llama 3.3 70B / 3.1 8B-Instant     |
| LLM (Vertex path)   | @google-cloud/vertexai → Gemini 3 Pro / Flash |
| Embeddings          | gemini-embedding-001 via Vertex predict (production); deterministic stub for dev |
| Database (local)    | better-sqlite3 (WAL mode)                     |
| Database (prod)     | pg + Cloud SQL Postgres (Phase 7C adapter; caller migration tracked as 7C.1) |
| Observability       | Langfuse traces + per-call cost ledger (`llm_costs`) |
| Deploy              | Cloud Run + Cloud SQL Auth Proxy + Secret Manager + Cloud Build |
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

## MCP Tools (16)

| Tool                  | Description                                        |
|-----------------------|----------------------------------------------------|
| `ping`                | Test connectivity                                  |
| `wallet_setup`        | Register/resume wallet                             |
| `scan_markets`        | APYs, prices, funding rates, arbitrage             |
| `yield_deposit`       | Deposit to best yield protocol                     |
| `yield_rotate`        | Rotate to higher APY                               |
| `swap_tokens`         | PancakeSwap V2 token swap                          |
| `send_tokens`         | Transfer tokens to external address                |
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
- **Don't import `groq-sdk` directly anymore (Phase 7A)**: every LLM call goes through `getLLMProvider().chat(...)`. Adding a new call site by `import Groq from 'groq-sdk'` would break the `LLM_PROVIDER=vertex` path.
- **Vertex model IDs are placeholders until 7B-verify (Phase 7B)**: `gemini-3-pro` / `gemini-3-flash` are unversioned. Pin to `-001` etc. before relying on the daily-budget gate; the pricing table in `src/observability/cost.ts` also has TODO[7B-verify] markers.
- **Postgres caller migration deferred (Phase 7C)**: `src/core/postgres/` is the new async backend but 31 `db.prepare().run/get/all()` call sites still use better-sqlite3. Don't add new sync DB callers — write against `pg`'s async API and `await query(...)` / `await withTransaction(...)` from `src/core/postgres/`.
- **Telegram polling vs webhook (Phase 7E)**: long-polling dies under Cloud Run scale-to-zero. Set `TELEGRAM_MODE=webhook` for any deployment that scales to zero; polling is the local default. Webhook path uses Telegraf's `webhookCallback` mounted on the same Express app that serves REST.
- **Vector memory is in-process today (Phase 7D)**: `src/utils/vectorMemory.ts` stores embeddings in a Map. Resets on restart. Production persistence (Vertex Vector Search index or pg-vector) is a 7D.1 follow-up; the embedder side is already provider-aware.
