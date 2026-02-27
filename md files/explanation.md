## Overview

This project is **DeFAI**, an autonomous DeFi agent running on **BSC Testnet (Chain ID 97)**. It exposes:

- **Telegram bot** (`src/bot/index.ts`) for chat-style DeFi control.
- **MCP server** (`src/mcp/server.ts`) so AI tools (e.g. Claude/Cursor) can call DeFi actions.
- **REST API** (`src/api/server.ts`) plus a **React dashboard** (`dashboard/`) for a web UI.

All three frontends route into a **single core engine** (`src/core/engine.ts`) that:

- Talks to **strategy modules** (yield optimization, arbitrage, delta-neutral).
- Uses **protocol adapters** for real + simulated protocols (Venus, PancakeSwap, Thena, BiSwap, etc.).
- Persists everything to a **SQLite DB** (`data/defai.db` via `src/core/db.ts`).
- Executes transactions via **ERC‑4337 smart accounts** managed by `walletManager` + Pimlico (gasless UX).

---

## Startup Flow (`src/index.ts`)

When you run `npm run dev` (which executes `src/index.ts`), the following happens:

1. **Environment & database initialization**
   - `dotenv/config` loads `.env`.
   - `src/core/db.ts` opens `data/defai.db`, enables WAL + foreign keys, and ensures tables:
     - `users`, `api_keys`, `positions`, `trades`, `alerts`, `notifications`, `market_snapshots`.

2. **Ensure a default user exists**
   - `userResolver.ensureDefaultUser()`:
     - If `users` table is empty and `PRIVATE_KEY` is set:
       - Derives a **smart account address** on BSC Testnet using `viem` + `permissionless` with EntryPoint v0.7 and `SIMPLE_ACCOUNT_FACTORY_V07`.
       - Encrypts the EOA private key with AES‑256‑GCM (`wallet/encryption.ts`) using passphrase `defai-dev-default`.
       - Inserts a `users` row and a corresponding `api_keys` row (API key `dfai_k_*`).
   - If a default user was created, `walletManager.activate(defaultId, 'defai-dev-default')`:
     - Decrypts the private key.
     - Initializes a **SmartAccountClient** backed by **Pimlico**:
       - BSC Testnet RPC (`BSC_TESTNET_RPC` or default).
       - Pimlico bundler + paymaster (gasless UserOperations).
     - Caches this session in memory in `activeSessions` (`walletManager`).

3. **Start Telegram bot**
   - `startBot()` from `src/bot/index.ts`:
     - Creates a `Telegraf` bot with `TELEGRAM_BOT_TOKEN`.
     - Registers commands and intent-based handlers (see below).
     - Calls `setBotRef(bot)` so `alertDispatcher` can send Telegram alerts.
     - Calls `bot.launch()` and logs startup.

4. **Start cron watchers**
   - `startYieldWatcher()` (`src/monitor/yieldWatcher.ts`):
     - Every **5 minutes**, fetches Venus APY and compares against users’ Venus positions.
     - If APY dropped ≥ 0.5% vs entry, sends `apy_drop` alerts via `broadcastAlert`.
   - `startArbWatcher()` (`src/monitor/arbWatcher.ts`):
     - Every **2 minutes**, calls `arbScanner.scan('BNB', 'USDT', '1')`.
     - Filters to viable arbitrage opportunities and broadcasts `arb_opportunity` alerts.
   - `startPositionHealthMonitor()` (`src/monitor/positionHealth.ts`):
     - Every **5 minutes**, inspects open `delta_neutral` positions.
     - Uses `scanner/fundingRates` to fetch current perps funding.
     - If funding flips from positive at entry to ≤ 0, sends `position_health` alerts.
   - `startSnapshotLogger()` (`src/monitor/snapshotLogger.ts`):
     - Every **5 minutes**, fetches:
       - Yields via `core/scanner/apyAggregator`.
       - Prices via `core/scanner/priceAggregator`.
     - Writes **top APYs** and **token prices** into `market_snapshots` for dashboard charts.

5. **Start REST API**
   - `startApiServer()` (`src/api/server.ts`):
     - Creates an Express app with CORS + JSON body parsing.
     - Mounts:
       - `/api/auth` — auth & API key/JWT handling.
       - `/api/portfolio` — portfolio + positions.
       - `/api/trades` — trade history.
       - `/api/markets` — current yields/prices.
       - `/api/alerts` — alert config + unread notifications.
     - Exposes a health check at `/api/health`.
     - Listens on port **3002** by default.

---

## Core Engine (`src/core/engine.ts`)

The engine is a **thin orchestrator** that all transports (Telegram, MCP tools, API routes) call into. It centralizes logging, validation, and risk checks.

Key responsibilities:

- **Market scanning**
  - `scanMarkets(category)` → delegates to `executeScanMarkets` (MCP tool layer) and returns a Markdown/text report of:
    - Yields (Venus/Beefy/DefiLlama),
    - Prices (DEX + aggregators),
    - Binance funding rates,
    - Cross‑DEX arbitrage opportunities.

- **Yield strategies**
  - `yieldDeposit(userId, token, amount, protocol?)`:
    - Uses `strategy/yieldOptimizer.ts` to choose the best protocol (Venus vs simulated Beefy/DefiLlama) unless a protocol is forced.
    - Inserts a `positions` row with metadata (APY, protocol, token, amount).
    - Inserts a `trades` row for the deposit.
  - `yieldRotate(userId, positionId, minImprovementBps?)`:
    - Uses `yieldOptimizer.rotate` to move an existing position to a higher‑APY protocol if improvement ≥ threshold.
  - `checkRotation(positionId, minImprovementBps?)`:
    - Dry‑run rotation: returns a `RotationPlan` with current vs target protocol/APY and improvement in bps.

- **Portfolio & trade history**
  - `getPortfolio(userId)`:
    - Uses `positionTracker` to aggregate:
      - Smart account address,
      - Total USD value,
      - Yield earned,
      - Arbitrage profits,
      - Open positions (type, protocol, token, size, APY, simulation flags).
  - `getTradeHistory(userId, opts?)`:
    - Uses `tradeLogger` / `db.getTrades` to return the last N trades, optionally filtered by `type`.

- **Swaps**
  - `swapTokens(userId, fromToken, toToken, amount)`:
    - Ensures wallet session via `walletManager.getClient(userId)`.
    - Uses `pancakeSwapAdapter.swap` (real PancakeSwap V2 Router on BSC Testnet) to execute a real swap.
    - Logs a `swap` trade in `trades` with tx hash and protocol `PancakeSwap`.

- **Arbitrage**
  - `arbExecute(userId, opportunityId?, maxSlippageBps?)`:
    - Uses `strategy/arbScanner.execute` to:
      - Scan prices across PancakeSwap, Thena, and BiSwap (some simulated).
      - Choose the best opportunity under slippage/risk constraints.
      - Execute and log trades/positions as needed.

- **Delta‑neutral strategies**
  - `deltaNeutralOpen(userId, token, notionalUsd, maxFundingRate?)`:
    - Runs `riskManager.check` with type `delta_neutral` and amount in USD.
    - If allowed, uses `strategy/deltaNeutral.open` to:
      - Open a spot + simulated short (based on Binance funding rates).
      - Store funding rate and other metadata in the `positions` table.
  - `deltaNeutralClose(userId, positionId)`:
    - Uses `deltaNeutral.close` to unwind the position and realize PnL, updating DB.

- **Risk configuration**
  - `getRiskConfig(userId)` / `configureRisk(userId, config)`:
    - Get/update constraints like:
      - Max single position size,
      - Total exposure cap,
      - Max slippage in bps,
      - Allowed protocols,
      - Max concurrent delta-neutral positions.

- **Alerts**
  - `setAlert(userId, alertType, active, threshold?)`:
    - Validates `alertType` (`apy_drop`, `arb_opportunity`, `position_health`).
    - Upserts rows into `alerts` with `active` and `threshold`.
  - `getAlerts(userId)`:
    - Reads active alerts from `alerts`.

---

## Identity & Wallet Management

### Users and API keys (`src/core/userResolver.ts`, `src/core/db.ts`)

- **User storage** (`users` table):
  - `id` — internal UUID.
  - `encrypted_private_key` — AES‑256‑GCM encrypted EOA private key.
  - `smart_account_address` — ERC‑4337 smart account on BSC Testnet.
  - `pimlico_api_key` — optional per‑user Pimlico key (otherwise global `PIMLICO_API_KEY`).
  - `telegram_id` — for Telegram linking.
  - `risk_config` / `alert_config` — JSON blobs for future config.

- **API keys** (`api_keys` table):
  - `key` — `dfai_k_*` string.
  - `user_id` — foreign key to `users.id`.
  - Used for:
    - MCP SSE auth (Bearer token).
    - Dashboard login / JWT issuance.

- **Resolution helpers**:
  - `resolveFromEnv()` — uses `DEFAI_USER_ID` env (for MCP stdio).
  - `resolveFromApiKey(apiKey)` — used by MCP SSE and the dashboard.
  - `resolveFromTelegram(telegramId)` — used by Telegram bot to map Telegram users to internal users.

- **User creation**:
  - `createUser({ privateKey, passphrase, telegramId?, label? })`:
    - Normalizes private key and creates a `viem` account.
    - Uses `toSimpleSmartAccount` with EntryPoint v0.7 and the factory address to derive the smart account address.
    - Encrypts the private key with the given passphrase.
    - Inserts a `users` row and a labeled `api_keys` row.

### Wallet sessions (`src/core/walletManager.ts`)

- `activate(userId, passphrase)`:
  - Fetches the user row and decrypts the key using `wallet/encryption.ts`.
  - Reads `PIMLICO_API_KEY` (or user-specific `pimlico_api_key`).
  - Builds:
    - `publicClient` — BSC Testnet RPC client.
    - `pimlicoClient` — Pimlico client configured with EntryPoint v0.7.
    - `smartAccount` — via `toSimpleSmartAccount`.
    - `client` — a `SmartAccountClient` using Pimlico as bundler + paymaster, with `estimateFeesPerGas` hooked into Pimlico’s gas price endpoint.
  - Caches `{ client, publicClient, address }` in `activeSessions` map.

- `getClient(userId)`:
  - Returns the active wallet session, or throws if not activated (e.g. MCP requires `wallet_setup` first).

---

## Telegram Bot (`src/bot/index.ts`)

The bot provides a conversational interface around the engine.

- **User resolution**
  - `resolveUser(telegramId)`:
    - Uses `userResolver.resolveFromTelegram(telegramId)` to get a `userId`, or `null` if not linked.

- **Key commands**
  - `/start`:
    - If a user is linked:
      - Sends a “Welcome back” message and hints at `/help`.
    - Else:
      - If a default user exists via env, links Telegram to that wallet.
      - Otherwise instructs you to:
        - Use MCP `wallet_setup`, then
        - `/link <your_user_id>` (depending on how linking is configured in your branch).
  - `/scan`:
    - Calls `engine.scanMarkets('all')` and replies with a Markdown report (truncated at 4000 chars).
  - `/deposit <amount> <token>`:
    - Validates numeric amount, default token is `BNB`.
    - Calls `engine.yieldDeposit(userId, token, amount)` and formats the result via `mcp/tools/yieldDeposit.formatDepositResult`.
  - `/rotate <position_id>`:
    - Uses `engine.checkRotation` to show a plan.
    - Then calls `engine.yieldRotate` and formats the new position.
  - `/arb`:
    - Calls `engine.scanMarkets('arbitrage')` and prints opportunities.
  - `/trades`:
    - Calls `engine.getTradeHistory(userId, { limit: 10 })` and shows recent trades.
  - `/portfolio`:
    - Calls `engine.getPortfolio(userId)` and shows:
      - Smart account address,
      - Total value, yield, arb profits,
      - Each position (id, token, protocol, APY, simulated flag).
  - `/help`:
    - Lists commands and examples (including natural language swaps).

- **Natural language intents**
  - `bot.on('text', ...)`:
    - Uses `parseIntent(text, userId)` (Groq Llama 3.3 70B) to classify into types:
      - `YIELD`, `SWAP`, `ARB`, `SCAN`, `PORTFOLIO`, `TRADES`, `RISK`, `DELTA_NEUTRAL`, etc.
    - Uses `awaitingAmountFor` to handle multi-step flows (e.g. ask “How much BNB?”).
    - Routes to `engine` methods accordingly.
    - Fallbacks to `generateConversationalReply` when there’s no actionable intent.

- **Alert integration**
  - During initialization, `setBotRef(bot)` is called so `alertDispatcher` can:
    - `botRef.telegram.sendMessage(telegram_id, message, { parse_mode: 'Markdown' })` when alerts fire.

---

## MCP Server (`src/mcp/server.ts`)

The MCP server is a separate entrypoint used by AI tools to control DeFAI.

### Session handling

- `sessionUsers: Map<string, string>` tracks which `userId` is associated with which MCP session id.
- `getUserId(sessionId)`:
  - Returns `sessionUsers.get(sessionId)` or, if missing, `sessionUsers.get('default')`.
  - Throws if neither exists (require `wallet_setup`).

### Tools

Tools are declared with `server.tool(name, description, schema, handler)` and mostly delegate to executor functions that call the engine:

- **Onboarding**
  - `wallet_setup`:
    - If `existing_user_id` is provided:
      - Ensures user exists, activates wallet via `walletManager.activate`, and sets `sessionUsers[sessionId]`.
    - Otherwise:
      - Calls `userResolver.createUser`.
      - Activates wallet and sets `sessionUsers[sessionId]`.
    - Responds with:
      - `User ID`, `Smart Account`, `API Key`, and a BSCScan link.

- **Core DeFi**
  - `scan_markets` → `executeScanMarkets`.
  - `yield_deposit` → `executeYieldDeposit` (which calls `engine.yieldDeposit`).
  - `yield_rotate` → `executeYieldRotate` (rotation via engine).
  - `portfolio` → `executePortfolio` (wraps `engine.getPortfolio`).
  - `trade_history` → `executeTradeHistory`.
  - `swap_tokens` → `executeSwapTokens`.
  - `arb_execute` → `executeArbExecute`.
  - `delta_neutral_open` / `delta_neutral_close` → `executeDeltaNeutralOpen` / `executeDeltaNeutralClose`.

- **Risk and alerts**
  - `risk_config` → `executeRiskConfig` (get or update risk settings).
  - `set_alerts` / `get_alerts` → `executeSetAlert` / `executeGetAlerts`.
  - `link_telegram` → `executeLinkTelegram` with instructions for connecting Telegram.

- **Utility**
  - `ping` → health check text response.

### Transports

- **stdio mode** (default, `MCP_TRANSPORT=stdio` or unset):
  - `startStdio()`:
    - Calls `resolveDefaultUser()`:
      - Uses `DEFAI_USER_ID` if set, else `ensureDefaultUser`.
      - Activates the default wallet and sets `sessionUsers['default']`.
    - Attaches `StdioServerTransport` to the MCP server.

- **SSE mode** (`MCP_TRANSPORT=sse`):
  - `startSse(port = 3001)`:
    - Starts an Express app with:
      - `GET /sse`:
        - Validates Bearer `apiKey` → maps to a `userId` via `resolveFromApiKey`.
        - Sets `sessionUsers['sse'] = userId`.
        - Creates an `SSEServerTransport` for `/messages` and connects to the MCP server.
      - `POST /messages`:
        - Forwards MCP POST messages to `sseTransport.handlePostMessage`.

---

## Alerts & Notifications

### `src/monitor/alertDispatcher.ts`

- `setBotRef(bot)`:
  - Stores the Telegraf bot so alerts can be sent over Telegram when available.

- `dispatch(userId, alertType, message)`:
  - Looks up the user in `users`.
  - Finds active alert configs for the given type from `alerts`.
  - If `telegram_id` is set and `botRef` is available:
    - Sends a Telegram message with Markdown formatting.
  - Always:
    - Inserts a row into `notifications` for dashboard consumption.
    - Updates `alerts.last_triggered_at` when a matching alert config exists.

- `broadcastAlert(alertType, message)`:
  - Queries all `users` with active alerts of this type.
  - Calls `dispatch` for each.

### Watchers

- **Yield watcher**:
  - Detects APY drops on Venus positions (`apy_drop`).
- **Arb watcher**:
  - Detects profitable cross‑DEX opportunities (`arb_opportunity`).
- **Position health monitor**:
  - Detects negative funding on delta‑neutral positions (`position_health`).
- **Snapshot logger**:
  - Feeds `market_snapshots` to power historical charts in the dashboard.

---

## Mental Model

At a high level, you can think of DeFAI as:

- A **multi-interface DeFi agent**:
  - Telegram, MCP tools, and a REST API all plug into the same `engine`.
- Backed by:
  - **Account abstraction smart accounts** (gasless via Pimlico),
  - **SQLite** for all state (users, positions, trades, alerts, snapshots),
  - **cron-based watchers** for autonomous monitoring and alerting.
- Operating on:
  - **Real BSC Testnet protocols** (Venus, PancakeSwap V2),
  - **Simulated protocols** using live mainnet data (Beefy, DefiLlama, Thena, BiSwap),
  - **Binance funding rates** for delta‑neutral strategies.

Use this file as a conceptual map when navigating or extending the codebase.

