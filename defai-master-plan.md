# DeFAI MCP — The OpenRouter for BNB Chain DeFi

> One MCP server. Connect any chatbot. Full autonomous DeFi on BSC.

---

## 1. GAP ANALYSIS — Where You Are vs Where You Need To Be

### Current State
| Feature | Status |
|---|---|
| Yield deposit (Venus) | ✅ Basic single-protocol deposit |
| Remittance comparison | ✅ But India-specific, not DeFi-native |
| Portfolio tracking | ✅ Minimal (single position map) |
| Intent parsing (Groq LLM) | ✅ Works but narrow intent set |
| Account Abstraction (Pimlico) | ✅ Gasless txs via ERC-4337 |
| Telegram bot | ✅ Functional |
| Delta-neutral strategies | ❌ Missing |
| Yield rotation | ❌ Missing |
| Cross-platform arbitrage | ❌ Missing |
| Market scanning | ❌ Missing |
| MCP server | ❌ Missing |
| Multi-user wallet management | ❌ Missing (single EOA hardcoded) |
| User identity system | ❌ Missing (no user concept at all) |
| Persistent storage | ❌ Missing (in-memory only, lost on restart) |
| Dashboard | ❌ Missing |

### Target State — "AI Agent that scans, executes, rotates, arbitrages"
| Capability | What It Means |
|---|---|
| **Market Scanner** | Continuously poll on-chain APYs, prices, funding rates across BSC protocols |
| **Delta-Neutral Executor** | Long spot + short perp to earn funding while hedged |
| **Yield Rotator** | Auto-move funds from lower-APY to higher-APY vault when spread > threshold |
| **Arbitrage Detector** | Spot price discrepancies across DEXs (PancakeSwap, BiSwap, Thena) and execute |
| **MCP Server** | Expose all capabilities as MCP tools callable by Claude, GPT, or any MCP client |
| **Multi-User with Unified Identity** | Each user has a UUID. Every transport (MCP/Telegram/Dashboard) resolves to it. |
| **Persistent Storage** | SQLite for positions, trades, user config. Survives restarts. |
| **Dashboard** | React web UI showing portfolio, trade history, live APYs, PnL charts |
| **Telegram (Parallel)** | Keep as alternative frontend — calls the same core logic |

---

## 2. IDENTITY & MULTI-USER ARCHITECTURE

This is the most critical design decision. Every transport must resolve to the same `userId`, or a user's Telegram trades won't appear in their dashboard.

### 2.1 The Unified User Model

```typescript
interface User {
  id: string;                    // UUID v4 — the universal identifier
  createdAt: Date;
  
  // Wallet
  encryptedPrivateKey: string;   // AES-256 encrypted with user's passphrase
  smartAccountAddress: Address;
  pimlicoApiKey?: string;
  
  // Connected transports
  telegramId?: number;           // ctx.from.id — set on /start
  apiKeys: string[];             // for dashboard + remote MCP auth
  
  // Config
  riskConfig: RiskConfig;
  alertConfig: AlertConfig;
}
```

### 2.2 How Each Transport Identifies Users

```
┌─────────────────────────────────────────────────────────────────┐
│                      TRANSPORTS                                  │
│                                                                  │
│  MCP (stdio)         MCP (SSE)        Telegram       Dashboard  │
│  ───────────         ─────────        ─────────      ──────────  │
│  env: DEFAI_USER_ID  Bearer token     ctx.from.id    JWT token  │
│  or: auto-create     in /sse?token=   → lookup by    → userId   │
│  on wallet_setup     → userId         telegramId     from JWT   │
│                                                                  │
│  Process IS the user Multiple users   Multiple users  Multiple  │
│  (1 process = 1 user) per SSE server  per bot         users     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │   UserResolver      │
                │   resolve(ctx) →    │
                │   userId: string    │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │   Core Engine       │
                │   (always receives  │
                │    userId param)    │
                └─────────────────────┘
```

### 2.3 Transport → User Resolution Logic

```typescript
// src/core/userResolver.ts

import { db } from "./db.js";
import { v4 as uuid } from "uuid";

export class UserResolver {
  
  // MCP stdio: user ID from env or created on wallet_setup
  resolveFromEnv(): string {
    const envId = process.env.DEFAI_USER_ID;
    if (envId && db.getUser(envId)) return envId;
    // If no env ID, create new user on first wallet_setup call
    return "pending"; // wallet_setup will create and return the ID
  }
  
  // MCP SSE: user sends API key as Bearer token
  resolveFromApiKey(apiKey: string): string | null {
    const user = db.getUserByApiKey(apiKey);
    return user?.id ?? null;
  }
  
  // Telegram: ctx.from.id → lookup user
  resolveFromTelegram(telegramId: number): string | null {
    const user = db.getUserByTelegramId(telegramId);
    return user?.id ?? null;
  }
  
  // Dashboard: JWT contains userId
  resolveFromJwt(token: string): string | null {
    const payload = jwt.verify(token, process.env.JWT_SECRET!);
    return payload.userId ?? null;
  }
  
  // First-time user creation (any transport)
  createUser(opts: {
    privateKey: string;
    passphrase: string;   // to encrypt the private key at rest
    telegramId?: number;
  }): User {
    const id = uuid();
    const encryptedKey = encrypt(opts.privateKey, opts.passphrase);
    const smartAccountAddress = /* derive from privateKey */;
    
    const user: User = {
      id,
      createdAt: new Date(),
      encryptedPrivateKey: encryptedKey,
      smartAccountAddress,
      telegramId: opts.telegramId,
      apiKeys: [generateApiKey()],  // for dashboard + SSE auth
      riskConfig: DEFAULT_RISK_CONFIG,
      alertConfig: DEFAULT_ALERT_CONFIG,
    };
    
    db.saveUser(user);
    return user;
  }
}
```

### 2.4 Registration Flows Per Transport

**MCP (stdio via Claude Desktop)**:
```
User adds to claude_desktop_config.json:
  env: { PRIVATE_KEY: "0x...", DEFAI_USER_ID: "optional" }

First message: "Set up my wallet"
  → wallet_setup tool called
  → If DEFAI_USER_ID exists: load existing user
  → If not: create new user, return userId + API key
  → User saves DEFAI_USER_ID for next session
```

**MCP (SSE — remote)**:
```
User calls POST /auth/register { privateKey, passphrase }
  → Creates user → returns { userId, apiKey }

User connects to GET /sse?token=<apiKey>
  → SSE transport resolves apiKey → userId
  → All tool calls scoped to that user
```

**Telegram**:
```
User sends /start
  → Bot checks db for ctx.from.id
  → Not found: "Welcome! Send your private key to register."
  → User sends key → createUser(key, telegramId=ctx.from.id)
  → Found: "Welcome back! Your smart account: 0x..."
  
All subsequent messages:
  → resolveFromTelegram(ctx.from.id) → userId → core engine
```

**Dashboard**:
```
User visits dashboard.defai.xyz
  → Login with API key (from wallet_setup) or passphrase
  → JWT issued → stored in cookie
  → All API calls include JWT → resolveFromJwt → userId
```

### 2.5 Linking Transports to Same User

A user who started via Telegram can link their dashboard:

```
/link → bot replies: "Your API key: dfai_k_abc123... Use this to login at dashboard.defai.xyz"
```

A user who started via MCP can link Telegram:

```
MCP tool: link_telegram → returns "Send /link dfai_k_abc123 to @DefaiBnbBot"
Telegram: /link dfai_k_abc123 → looks up user by API key → sets telegramId
```

---

## 3. PERSISTENT STORAGE (SQLite)

In-memory maps die on restart. Use SQLite (zero-config, single file, no external service).

### 3.1 Why SQLite
- No Docker, no managed DB, no connection strings
- Single file `data/defai.db` — just works
- Good enough for thousands of users
- `better-sqlite3` is synchronous and fast

### 3.2 Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,                  -- UUID
  encrypted_private_key TEXT NOT NULL,  -- AES-256-GCM encrypted
  smart_account_address TEXT NOT NULL,
  pimlico_api_key TEXT,
  telegram_id INTEGER UNIQUE,
  risk_config TEXT DEFAULT '{}',        -- JSON
  alert_config TEXT DEFAULT '{}',       -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API keys (one user can have multiple)
CREATE TABLE api_keys (
  key TEXT PRIMARY KEY,                 -- dfai_k_<random>
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,                           -- "claude-desktop", "dashboard"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Positions (yield, delta-neutral, LP, spot)
CREATE TABLE positions (
  id TEXT PRIMARY KEY,                  -- pos_<uuid>
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                   -- yield | delta_neutral | lp | spot
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,                 -- bigint as string
  entry_price REAL,
  entry_apy REAL,
  current_value_usd REAL,
  pnl_usd REAL DEFAULT 0,
  status TEXT DEFAULT 'open',           -- open | closed
  tx_hash TEXT,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  metadata TEXT DEFAULT '{}'            -- JSON: extra strategy-specific data
);

-- Trade history (every executed transaction)
CREATE TABLE trades (
  id TEXT PRIMARY KEY,                  -- trd_<uuid>
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                   -- swap | deposit | withdraw | arb_buy | arb_sell | rotation
  protocol TEXT NOT NULL,
  from_token TEXT,
  to_token TEXT,
  from_amount TEXT,
  to_amount TEXT,
  price_usd REAL,
  gas_usd REAL,
  tx_hash TEXT NOT NULL,
  position_id TEXT REFERENCES positions(id),
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Alerts
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                   -- apy_drop | price_move | arb_opportunity | position_health
  threshold REAL NOT NULL,
  active INTEGER DEFAULT 1,
  last_triggered_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Market snapshots (for dashboard charts)
CREATE TABLE market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  apy REAL,
  price_usd REAL,
  tvl_usd REAL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_positions_user ON positions(user_id, status);
CREATE INDEX idx_trades_user ON trades(user_id, executed_at);
CREATE INDEX idx_snapshots_time ON market_snapshots(recorded_at);
```

### 3.3 Database Module

```typescript
// src/core/db.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "defai.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");  // better concurrent reads
db.pragma("foreign_keys = ON");

// Run migrations on startup
db.exec(SCHEMA_SQL);

export { db };
```

---

## 4. ARCHITECTURE — The Complete System

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLIENTS                                    │
│                                                                  │
│  Claude Desktop    Claude.ai SSE    Telegram Bot    Dashboard   │
│  (stdio MCP)       (remote MCP)     (Telegraf)     (React SPA) │
└───────┬──────────────┬──────────────────┬──────────────┬────────┘
        │              │                  │              │
        │   ┌──────────▼──────────┐       │    ┌────────▼────────┐
        │   │  Express Server     │       │    │ REST API        │
        │   │  /sse (MCP SSE)     │       │    │ /api/portfolio  │
        │   │  /auth/*            │       │    │ /api/trades     │
        │   │  /messages          │       │    │ /api/markets    │
        │   └──────────┬──────────┘       │    │ /api/auth       │
        │              │                  │    └────────┬────────┘
        │              │                  │             │
┌───────▼──────────────▼──────────────────▼─────────────▼─────────┐
│                     USER RESOLVER                                │
│  env:DEFAI_USER_ID | Bearer apiKey | ctx.from.id | JWT token    │
│                         ↓ all resolve to userId                  │
├─────────────────────────────────────────────────────────────────┤
│                     CORE ENGINE                                  │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐         │
│  │ Wallet      │  │ Position     │  │ Risk Manager   │         │
│  │ Manager     │  │ Tracker      │  │                │         │
│  ├─────────────┤  ├──────────────┤  ├────────────────┤         │
│  │ Yield       │  │ Arb Scanner  │  │ Delta Neutral  │         │
│  │ Optimizer   │  │              │  │ Strategy       │         │
│  ├─────────────┤  ├──────────────┤  ├────────────────┤         │
│  │ APY         │  │ Price        │  │ Funding Rate   │         │
│  │ Aggregator  │  │ Aggregator   │  │ Scanner        │         │
│  └─────────────┘  └──────────────┘  └────────────────┘         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              PROTOCOL ADAPTERS                        │       │
│  │  Venus | PancakeSwap | Thena | Beefy | BiSwap        │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────┐  ┌────────────────────────┐           │
│  │  SQLite (persistent) │  │  TTL Cache (in-memory)  │           │
│  │  users, positions,   │  │  APYs, prices,          │           │
│  │  trades, alerts      │  │  quotes, snapshots      │           │
│  └──────────────────────┘  └────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│                     MONITORS (Cron)                               │
│  APY watcher | Arb watcher | Position health | Snapshot logger  │
│  → Push alerts to Telegram | Write to SQLite                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. WHAT TO KEEP, REMOVE, AND ADD

### ✅ KEEP (Refactor)
| Component | Why Keep | Refactor How |
|---|---|---|
| `wallet/pimlico.ts` | AA is great UX | Multi-user: accept privKey per user |
| `wallet/execute.ts` | On-chain execution works | Extend with new protocol ABIs |
| `bot/index.ts` | Telegram is a valid parallel UI | Route to shared core engine via userId |
| `bot/intentParser.ts` | LLM intent parsing is useful | Expand intent taxonomy |
| `data/venus.ts` | Live APY fetching | Generalize to multi-protocol |
| `data/pancake.ts` | Live APR fetching | Keep and add more DEXs |
| `monitor/yieldWatcher.ts` | Cron-based alerts | Extend to multi-strategy alerts |

### ❌ REMOVE
| Component | Why Remove |
|---|---|
| `skills/remittance.ts` | India-specific fiat corridor |
| `tinyfish/remittanceScraper.ts` | Scrapes Wise/WU — irrelevant |
| `tinyfish/indianExchanges.ts` | INR prices — irrelevant |
| `data/rates.ts` | INR→USD conversion — irrelevant |
| `utils/responses.ts` | Hinglish templates — English only |
| All Hinglish strings | Replace with clean English |

### 🆕 ADD
| Component | Purpose |
|---|---|
| `mcp/server.ts` | MCP server entry point (stdio + SSE) |
| `mcp/tools/*.ts` | Individual MCP tool definitions |
| `core/db.ts` | SQLite database module |
| `core/userResolver.ts` | Cross-transport user identity resolution |
| `core/walletManager.ts` | Per-user wallet context |
| `core/positionTracker.ts` | CRUD positions in SQLite |
| `core/riskManager.ts` | Exposure limits, slippage guards |
| `core/strategy/yieldOptimizer.ts` | Compare APYs, pick best, rotate |
| `core/strategy/deltaNeutral.ts` | Long spot + short perp strategy |
| `core/strategy/arbScanner.ts` | Cross-DEX arbitrage detection |
| `core/scanner/apyAggregator.ts` | Multi-protocol APY polling |
| `core/scanner/priceAggregator.ts` | Multi-DEX price polling |
| `core/scanner/fundingRates.ts` | Perp funding rate polling |
| `adapters/*.ts` | Protocol-specific contract interactions |
| `api/server.ts` | Express REST API for dashboard |
| `api/routes/*.ts` | API route handlers |
| `api/middleware/auth.ts` | JWT + API key authentication |
| `dashboard/` | React SPA (separate build) |

---

## 6. COMPLETE PROJECT STRUCTURE

```
defai-mcp/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
│
├── data/                           ← SQLite DB lives here (gitignored)
│   └── defai.db
│
├── src/
│   ├── index.ts                    ← Main: starts MCP + API + Telegram + crons
│   │
│   ├── mcp/                        ← MCP SERVER LAYER
│   │   ├── server.ts               ← MCP server init (stdio + SSE)
│   │   └── tools/
│   │       ├── walletSetup.ts      ← Tool: register user wallet
│   │       ├── scanMarkets.ts      ← Tool: get APYs, prices, funding rates
│   │       ├── yieldDeposit.ts     ← Tool: deposit into best yield protocol
│   │       ├── yieldRotate.ts      ← Tool: move funds to higher APY vault
│   │       ├── deltaNeutral.ts     ← Tool: open delta-neutral position
│   │       ├── arbExecute.ts       ← Tool: execute detected arbitrage
│   │       ├── swapTokens.ts       ← Tool: swap via best-price DEX
│   │       ├── portfolio.ts        ← Tool: full portfolio state
│   │       ├── tradeHistory.ts     ← Tool: past trades
│   │       ├── setAlerts.ts        ← Tool: configure alerts
│   │       ├── riskConfig.ts       ← Tool: set risk parameters
│   │       └── linkTransport.ts    ← Tool: link Telegram/dashboard to account
│   │
│   ├── api/                        ← REST API (for Dashboard)
│   │   ├── server.ts               ← Express app setup
│   │   ├── middleware/
│   │   │   └── auth.ts             ← JWT verification + API key lookup
│   │   └── routes/
│   │       ├── auth.ts             ← POST /api/auth/login, /api/auth/register
│   │       ├── portfolio.ts        ← GET /api/portfolio
│   │       ├── trades.ts           ← GET /api/trades
│   │       ├── markets.ts          ← GET /api/markets/yields, /api/markets/prices
│   │       ├── positions.ts        ← GET/POST /api/positions
│   │       └── alerts.ts           ← GET/POST /api/alerts
│   │
│   ├── core/                       ← CORE ENGINE (shared by ALL transports)
│   │   ├── engine.ts               ← Orchestrator: routes commands to strategies
│   │   ├── db.ts                   ← SQLite init + migrations
│   │   ├── userResolver.ts         ← Transport → userId resolution
│   │   ├── walletManager.ts        ← Per-user wallet context
│   │   ├── positionTracker.ts      ← Position CRUD (SQLite-backed)
│   │   ├── tradeLogger.ts          ← Trade history writer (SQLite-backed)
│   │   ├── riskManager.ts          ← Exposure limits, slippage, loss guards
│   │   │
│   │   ├── strategy/
│   │   │   ├── yieldOptimizer.ts   ← Compare APYs → deposit/rotate
│   │   │   ├── deltaNeutral.ts     ← Long spot + short perp
│   │   │   ├── arbScanner.ts       ← Cross-DEX arb detection + execution
│   │   │   └── types.ts            ← Strategy interfaces
│   │   │
│   │   └── scanner/
│   │       ├── apyAggregator.ts    ← Venus + Beefy + DefiLlama APYs
│   │       ├── priceAggregator.ts  ← PancakeSwap + Thena + BiSwap prices
│   │       ├── fundingRates.ts     ← Binance Futures funding rates
│   │       └── cache.ts            ← TTL cache for aggregated data
│   │
│   ├── adapters/                   ← PROTOCOL ADAPTERS
│   │   ├── types.ts                ← Common adapter interfaces
│   │   ├── venus.ts                ← Venus: supply, redeem, borrow, getApy
│   │   ├── pancakeswap.ts          ← PancakeSwap: swap, getQuote
│   │   ├── thena.ts                ← Thena: swap (simulated on testnet)
│   │   ├── beefy.ts                ← Beefy: vault deposit/withdraw
│   │   ├── alpaca.ts               ← Alpaca: leveraged yield
│   │   └── biswap.ts               ← BiSwap: swap + LP
│   │
│   ├── wallet/                     ← WALLET LAYER
│   │   ├── pimlico.ts              ← Smart account client factory (per-user)
│   │   ├── execute.ts              ← Generic tx execution + receipt waiting
│   │   └── encryption.ts           ← AES-256-GCM encrypt/decrypt private keys
│   │
│   ├── bot/                        ← TELEGRAM BOT (parallel UI)
│   │   ├── index.ts                ← Telegraf bot setup
│   │   ├── intentParser.ts         ← Groq LLM intent → core engine calls
│   │   └── registration.ts         ← /start flow: collect key, create user
│   │
│   ├── monitor/
│   │   ├── yieldWatcher.ts         ← Cron: APY drop alerts
│   │   ├── arbWatcher.ts           ← Cron: arb opportunity alerts
│   │   ├── positionHealth.ts       ← Cron: position health checks
│   │   └── snapshotLogger.ts       ← Cron: log market data to SQLite for charts
│   │
│   ├── utils/
│   │   ├── memory.ts               ← Supermemory SDK (keep for LLM context)
│   │   ├── storage.ts              ← Legacy in-memory (migrate to db)
│   │   ├── logger.ts               ← Structured logging (pino)
│   │   └── constants.ts            ← Addresses, ABIs, config
│   │
│   └── scripts/
│       ├── testWallet.ts
│       ├── testMcp.ts              ← Local MCP tool test harness
│       └── seedTestData.ts         ← Seed SQLite with mock positions for dashboard dev
│
├── dashboard/                      ← React SPA (separate package)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── api/client.ts           ← Fetch wrapper with JWT auth
│       ├── pages/
│       │   ├── Login.tsx            ← API key login
│       │   ├── Dashboard.tsx        ← Main overview
│       │   ├── Portfolio.tsx        ← Position details
│       │   ├── Trades.tsx           ← Trade history table
│       │   ├── Markets.tsx          ← Live APY/price tables
│       │   └── Settings.tsx         ← Risk config, alert config, linked accounts
│       ├── components/
│       │   ├── PortfolioCard.tsx
│       │   ├── PositionRow.tsx
│       │   ├── TradeRow.tsx
│       │   ├── ApyChart.tsx         ← Recharts line chart from market_snapshots
│       │   ├── PnlChart.tsx         ← Cumulative PnL over time
│       │   └── Navbar.tsx
│       └── hooks/
│           ├── usePortfolio.ts
│           ├── useTrades.ts
│           └── useMarkets.ts
│
├── abis/
│   ├── venus-vbnb.json
│   ├── pancake-router-v2.json
│   ├── pancake-quoter-v3.json
│   ├── erc20.json
│   ├── beefy-vault.json
│   └── alpaca-vault.json
│
└── docs/
    └── mcp-tool-spec.md
```

---

## 7. MCP SERVER — TECHNICAL SPECIFICATION

### 7.1 MCP SDK Setup

```bash
npm install @modelcontextprotocol/sdk
```

Key repo: https://github.com/modelcontextprotocol/typescript-sdk

### 7.2 Server Implementation (`mcp/server.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { UserResolver } from "../core/userResolver.js";
import express from "express";

const server = new McpServer({
  name: "defai-bnb",
  version: "1.0.0",
  description: "Autonomous DeFi agent for BNB Chain — yield, arb, delta-neutral, swaps"
});

// Session → userId mapping (set during wallet_setup or from env/token)
const sessionUsers = new Map<string, string>();

// Helper: get userId for current session
function getUserId(sessionId: string): string {
  const uid = sessionUsers.get(sessionId);
  if (!uid) throw new Error("No wallet registered. Call wallet_setup first.");
  return uid;
}

// ─── TOOL: wallet_setup ───
server.tool(
  "wallet_setup",
  "Register your wallet. Provide EOA private key and a passphrase to encrypt it. Returns userId and smart account address. Save the userId for future sessions.",
  {
    private_key: { type: "string", description: "EOA private key (hex)" },
    passphrase: { type: "string", description: "Passphrase to encrypt your key at rest" },
    existing_user_id: { type: "string", description: "If returning user, provide your userId to resume session" }
  },
  async ({ private_key, passphrase, existing_user_id }, { sessionId }) => {
    const resolver = new UserResolver();
    let user;
    
    if (existing_user_id) {
      user = resolver.loadExisting(existing_user_id, passphrase);
    } else {
      user = resolver.createUser({ privateKey: private_key, passphrase });
    }
    
    sessionUsers.set(sessionId || "default", user.id);
    
    return {
      content: [{
        type: "text",
        text: [
          `Wallet registered.`,
          `User ID: ${user.id} (save this for future sessions)`,
          `Smart Account: ${user.smartAccountAddress}`,
          `API Key: ${user.apiKeys[0]} (use for dashboard login)`,
          `BSCScan: https://testnet.bscscan.com/address/${user.smartAccountAddress}`,
          `All transactions are gasless via Pimlico.`
        ].join("\n")
      }]
    };
  }
);

// ─── TOOL: scan_markets ───
server.tool(
  "scan_markets",
  "Scan current DeFi market conditions on BSC. Returns APYs, DEX prices, funding rates, or arbitrage opportunities.",
  {
    category: {
      type: "string",
      enum: ["yield", "prices", "funding_rates", "arbitrage", "all"],
      description: "What to scan"
    }
  },
  async ({ category }) => {
    // No userId needed — market data is public
    // → scanner.getMarketSnapshot(category)
  }
);

// ─── TOOL: yield_deposit ───
server.tool(
  "yield_deposit",
  "Deposit tokens into the highest-APY protocol. Compares Venus, Beefy, etc. and picks the best.",
  {
    token: { type: "string", description: "Token symbol (BNB, USDT, BUSD)" },
    amount: { type: "string", description: "Amount to deposit (e.g., '0.1')" },
    protocol: { type: "string", description: "Force specific protocol (optional)" }
  },
  async ({ token, amount, protocol }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → yieldOptimizer.deposit(userId, token, amount, protocol)
  }
);

// ─── TOOL: yield_rotate ───
server.tool(
  "yield_rotate",
  "Check if a better yield exists and rotate funds. Withdraws from current, deposits into higher-APY.",
  {
    position_id: { type: "string", description: "Position ID to rotate (from portfolio)" },
    min_improvement_bps: { type: "number", description: "Min APY improvement in bps to trigger (default: 50)" }
  },
  async ({ position_id, min_improvement_bps }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → yieldOptimizer.rotate(userId, position_id, min_improvement_bps)
  }
);

// ─── TOOL: delta_neutral_open ───
server.tool(
  "delta_neutral_open",
  "Open delta-neutral: long spot + short perpetual. Earns funding while market-neutral.",
  {
    token: { type: "string", description: "Token (e.g., BNB)" },
    amount: { type: "string", description: "Notional amount in USD" },
    max_funding_rate: { type: "number", description: "Max acceptable negative funding rate (%)" }
  },
  async ({ token, amount, max_funding_rate }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → deltaNeutral.open(userId, token, amount, max_funding_rate)
  }
);

// ─── TOOL: arb_execute ───
server.tool(
  "arb_execute",
  "Execute arbitrage: buy on cheap DEX, sell on expensive DEX.",
  {
    opportunity_id: { type: "string", description: "Arb opportunity ID (optional — auto-detects best)" },
    max_slippage_bps: { type: "number", description: "Max slippage bps (default: 50)" }
  },
  async ({ opportunity_id, max_slippage_bps }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → arbScanner.execute(userId, opportunity_id, max_slippage_bps)
  }
);

// ─── TOOL: swap_tokens ───
server.tool(
  "swap_tokens",
  "Swap tokens via best-price DEX. Compares PancakeSwap, Thena, BiSwap.",
  {
    from_token: { type: "string", description: "Token to sell" },
    to_token: { type: "string", description: "Token to buy" },
    amount: { type: "string", description: "Amount of from_token" }
  },
  async ({ from_token, to_token, amount }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → priceAggregator.bestSwap(userId, from_token, to_token, amount)
  }
);

// ─── TOOL: portfolio ───
server.tool(
  "portfolio",
  "Full portfolio: balances, open positions, PnL, yield earned.",
  {},
  async (_, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → positionTracker.getPortfolio(userId)
  }
);

// ─── TOOL: trade_history ───
server.tool(
  "trade_history",
  "Get past trades with filters.",
  {
    limit: { type: "number", description: "Number of trades (default: 20)" },
    type: { type: "string", description: "Filter by type: swap, deposit, withdraw, arb, rotation" }
  },
  async ({ limit, type }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → tradeLogger.getHistory(userId, { limit, type })
  }
);

// ─── TOOL: set_alerts ───
server.tool(
  "set_alerts",
  "Configure automated alerts (delivered via Telegram if linked).",
  {
    alert_type: { type: "string", enum: ["apy_drop", "price_move", "arb_opportunity", "position_health"] },
    threshold: { type: "number", description: "Threshold value" }
  },
  async ({ alert_type, threshold }, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → monitor.setAlert(userId, alert_type, threshold)
  }
);

// ─── TOOL: risk_config ───
server.tool(
  "risk_config",
  "Configure risk parameters.",
  {
    max_position_usd: { type: "number" },
    max_slippage_bps: { type: "number" },
    stop_loss_pct: { type: "number" }
  },
  async (params, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    // → riskManager.configure(userId, params)
  }
);

// ─── TOOL: link_telegram ───
server.tool(
  "link_telegram",
  "Get instructions to link your Telegram account to this DeFAI user.",
  {},
  async (_, { sessionId }) => {
    const userId = getUserId(sessionId || "default");
    const user = db.getUser(userId);
    return {
      content: [{
        type: "text",
        text: `Send this to @DefaiBnbBot on Telegram:\n/link ${user.apiKeys[0]}\nThis will link your Telegram to this account so alerts and commands work there too.`
      }]
    };
  }
);

// ─── RESOURCES ───
server.resource(
  "supported_protocols",
  "defai://protocols",
  async () => ({
    contents: [{
      uri: "defai://protocols",
      mimeType: "application/json",
      text: JSON.stringify({
        yield: ["Venus", "Beefy Finance", "Alpaca Finance"],
        dex: ["PancakeSwap V3", "Thena", "BiSwap"],
        perps: ["Simulated (Binance funding rates)"],
        chain: "BSC Testnet (Chain ID 97)"
      })
    }]
  })
);

// ─── TRANSPORTS ───
async function runStdio() {
  const transport = new StdioServerTransport();
  // Pre-resolve user from env if provided
  if (process.env.DEFAI_USER_ID) {
    sessionUsers.set("default", process.env.DEFAI_USER_ID);
  }
  await server.connect(transport);
}

async function runSSE(port = 3001) {
  const app = express();
  const transports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    // Auth: resolve user from Bearer token
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    if (apiKey) {
      const user = db.getUserByApiKey(apiKey);
      if (user) {
        const transport = new SSEServerTransport("/messages", res);
        sessionUsers.set(transport.sessionId, user.id);
        transports.set(transport.sessionId, transport);
        await server.connect(transport);
        return;
      }
    }
    // No auth — user must call wallet_setup
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sid = req.query.sessionId as string;
    const t = transports.get(sid);
    if (t) await t.handlePostMessage(req, res);
  });

  app.listen(port, () => console.log(`MCP SSE on :${port}`));
}

const mode = process.env.MCP_TRANSPORT || "stdio";
if (mode === "sse") runSSE(); else runStdio();
```

### 7.3 MCP Client Config (Claude Desktop)

```json
{
  "mcpServers": {
    "defai-bnb": {
      "command": "node",
      "args": ["/path/to/defai-mcp/dist/mcp/server.js"],
      "env": {
        "PRIVATE_KEY": "0xYOUR_KEY",
        "PIMLICO_API_KEY": "your_pimlico_key",
        "GROQ_API_KEY": "your_groq_key",
        "DEFAI_USER_ID": "optional-if-returning-user",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

---

## 8. REST API — FOR DASHBOARD

### 8.1 Express Server (`api/server.ts`)

```typescript
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { db } from "../core/db.js";
import { apyAggregator } from "../core/scanner/apyAggregator.js";
import { positionTracker } from "../core/positionTracker.js";
import { tradeLogger } from "../core/tradeLogger.js";

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "defai-dev-secret";

// ─── AUTH ───
app.post("/api/auth/login", (req, res) => {
  const { api_key } = req.body;
  const user = db.getUserByApiKey(api_key);
  if (!user) return res.status(401).json({ error: "Invalid API key" });
  
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, userId: user.id, smartAccount: user.smart_account_address });
});

// ─── AUTH MIDDLEWARE ───
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

// ─── PORTFOLIO ───
app.get("/api/portfolio", authMiddleware, async (req, res) => {
  const portfolio = await positionTracker.getPortfolio(req.userId);
  res.json(portfolio);
});

// ─── POSITIONS ───
app.get("/api/positions", authMiddleware, async (req, res) => {
  const status = req.query.status || "open";
  const positions = db.getPositions(req.userId, status);
  res.json(positions);
});

// ─── TRADES ───
app.get("/api/trades", authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type;
  const trades = db.getTrades(req.userId, { limit, type });
  res.json(trades);
});

// ─── MARKET DATA ───
app.get("/api/markets/yields", async (req, res) => {
  // Public — no auth needed
  const yields = await apyAggregator.getAll();
  res.json(yields);
});

app.get("/api/markets/prices", async (req, res) => {
  const prices = await priceAggregator.getAllQuotes();
  res.json(prices);
});

// ─── MARKET HISTORY (for charts) ───
app.get("/api/markets/history", async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const protocol = req.query.protocol;
  const snapshots = db.getMarketSnapshots({ hours, protocol });
  res.json(snapshots);
});

// ─── ALERTS ───
app.get("/api/alerts", authMiddleware, async (req, res) => {
  const alerts = db.getAlerts(req.userId);
  res.json(alerts);
});

// ─── USER SETTINGS ───
app.get("/api/settings", authMiddleware, (req, res) => {
  const user = db.getUser(req.userId);
  res.json({
    smartAccount: user.smart_account_address,
    riskConfig: JSON.parse(user.risk_config),
    alertConfig: JSON.parse(user.alert_config),
    telegramLinked: !!user.telegram_id,
  });
});

export function startApiServer(port = 3002) {
  app.listen(port, () => console.log(`Dashboard API on :${port}`));
}
```

---

## 9. DASHBOARD — REACT SPA

### 9.1 Tech Stack
| Tool | Why |
|---|---|
| Vite | Fast dev server, simple config |
| React 18 | Standard |
| Tailwind CSS | Rapid styling |
| Recharts | Charts for APY history, PnL |
| React Router | Client-side routing |
| Tanstack Query | API data fetching + caching |

### 9.2 Pages

**Login Page** (`/login`):
- Input: API key (received from wallet_setup)
- Calls `POST /api/auth/login` → stores JWT

**Dashboard** (`/`):
- Portfolio summary card: total value, 24h PnL, yield earned, arb profits
- Active positions table: protocol, token, amount, current APY, PnL, status
- Recent trades (last 10)
- APY chart (line chart from market_snapshots, last 24h)

**Portfolio** (`/portfolio`):
- Detailed positions with expand/collapse
- Per-position PnL chart
- Close/rotate action buttons (call API → core engine)

**Trades** (`/trades`):
- Sortable, filterable table of all trades
- Columns: time, type, protocol, from→to, amount, PnL, tx hash (links to BSCScan)

**Markets** (`/markets`):
- Live APY table (auto-refreshes every 30s via Tanstack Query)
- Live price quotes across DEXs
- Arb opportunities highlighted in green when spread > threshold
- Funding rates table

**Settings** (`/settings`):
- Risk config sliders (max position, max slippage, stop-loss)
- Alert config toggles
- Linked accounts status (Telegram: linked/unlinked)
- API key management (generate new, revoke)

### 9.3 Dashboard Folder Setup

```bash
cd defai-mcp
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install tailwindcss @tailwindcss/vite recharts @tanstack/react-query react-router-dom
```

### 9.4 Key Dashboard Component Example

```tsx
// dashboard/src/pages/Dashboard.tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { PortfolioCard } from "../components/PortfolioCard";
import { PositionRow } from "../components/PositionRow";
import { ApyChart } from "../components/ApyChart";

export function Dashboard() {
  const { data: portfolio } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api.get("/api/portfolio"),
    refetchInterval: 30_000, // refresh every 30s
  });

  const { data: trades } = useQuery({
    queryKey: ["trades", { limit: 10 }],
    queryFn: () => api.get("/api/trades?limit=10"),
  });

  const { data: history } = useQuery({
    queryKey: ["market-history"],
    queryFn: () => api.get("/api/markets/history?hours=24"),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <PortfolioCard label="Total Value" value={`$${portfolio?.totalValueUsd}`} />
        <PortfolioCard label="24h PnL" value={`$${portfolio?.pnl24h}`} />
        <PortfolioCard label="Yield Earned" value={`$${portfolio?.yieldEarned}`} />
        <PortfolioCard label="Arb Profits" value={`$${portfolio?.arbProfits}`} />
      </div>

      {/* APY Chart */}
      <ApyChart data={history} />

      {/* Active Positions */}
      <div>
        <h2 className="text-xl font-bold mb-3">Active Positions</h2>
        <table className="w-full">
          <thead><tr>
            <th>Protocol</th><th>Token</th><th>Amount</th>
            <th>APY</th><th>PnL</th><th>Status</th>
          </tr></thead>
          <tbody>
            {portfolio?.positions?.map(p => <PositionRow key={p.id} position={p} />)}
          </tbody>
        </table>
      </div>

      {/* Recent Trades */}
      <div>
        <h2 className="text-xl font-bold mb-3">Recent Trades</h2>
        {trades?.map(t => (
          <div key={t.id} className="flex justify-between py-2 border-b">
            <span>{t.type} — {t.protocol}</span>
            <span>{t.from_amount} {t.from_token} → {t.to_amount} {t.to_token}</span>
            <a href={`https://testnet.bscscan.com/tx/${t.tx_hash}`} target="_blank"
               className="text-blue-500">View Tx</a>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 10. CORE ENGINE — TECHNICAL SPECIFICATIONS

### 10.1 Wallet Manager (`core/walletManager.ts`)

```typescript
import { createSmartAccountClient } from "permissionless";
import { privateKeyToSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoPaymasterClient } from "permissionless/clients/pimlico";
import { http, createPublicClient, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { db } from "./db.js";
import { decrypt } from "../wallet/encryption.js";

// In-memory cache of active wallet sessions (hot wallets)
const activeSessions = new Map<string, {
  client: any; // SmartAccountClient
  publicClient: any;
  address: Address;
}>();

export class WalletManager {
  
  // Initialize a user's wallet for active use (loads from DB, decrypts key)
  async activate(userId: string, passphrase: string): Promise<Address> {
    if (activeSessions.has(userId)) {
      return activeSessions.get(userId)!.address;
    }
    
    const user = db.getUser(userId);
    if (!user) throw new Error("User not found");
    
    const privateKey = decrypt(user.encrypted_private_key, passphrase) as `0x${string}`;
    const apiKey = user.pimlico_api_key || process.env.PIMLICO_API_KEY!;
    
    const publicClient = createPublicClient({
      chain: bscTestnet,
      transport: http(process.env.BSC_TESTNET_RPC || undefined),
    });
    
    const account = await privateKeyToSimpleSmartAccount(publicClient, {
      privateKey,
      factoryAddress: "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
      entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    });
    
    const pimlicoUrl = `https://api.pimlico.io/v2/97/rpc?apikey=${apiKey}`;
    const paymasterClient = createPimlicoPaymasterClient({ transport: http(pimlicoUrl) });
    
    const smartAccountClient = createSmartAccountClient({
      account,
      chain: bscTestnet,
      transport: http(pimlicoUrl),
      sponsorUserOperation: paymasterClient.sponsorUserOperation,
    });
    
    activeSessions.set(userId, {
      client: smartAccountClient,
      publicClient,
      address: account.address,
    });
    
    return account.address;
  }
  
  getClient(userId: string) {
    const session = activeSessions.get(userId);
    if (!session) throw new Error("Wallet not activated. Call wallet_setup first.");
    return session;
  }
  
  deactivate(userId: string) {
    activeSessions.delete(userId);
  }
}

export const walletManager = new WalletManager();
```

### 10.2 Position Tracker (`core/positionTracker.ts`)

```typescript
import { db as sqlite } from "./db.js";
import { v4 as uuid } from "uuid";

export interface Position {
  id: string;
  user_id: string;
  type: "yield" | "delta_neutral" | "lp" | "spot";
  protocol: string;
  token: string;
  amount: string;
  entry_price?: number;
  entry_apy?: number;
  current_value_usd?: number;
  pnl_usd: number;
  status: "open" | "closed";
  tx_hash: string;
  opened_at: string;
  closed_at?: string;
  metadata: Record<string, any>;
}

export interface Portfolio {
  userId: string;
  smartAccountAddress: string;
  totalValueUsd: number;
  pnl24h: number;
  yieldEarned: number;
  arbProfits: number;
  positions: Position[];
}

class PositionTracker {
  open(pos: Omit<Position, "id" | "opened_at" | "status" | "pnl_usd">): Position {
    const id = `pos_${uuid().slice(0, 8)}`;
    sqlite.prepare(`
      INSERT INTO positions (id, user_id, type, protocol, token, amount, entry_price, entry_apy, tx_hash, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, pos.user_id, pos.type, pos.protocol, pos.token, pos.amount,
           pos.entry_price, pos.entry_apy, pos.tx_hash, JSON.stringify(pos.metadata || {}));
    return this.get(id)!;
  }
  
  close(positionId: string, closeTxHash: string): Position {
    sqlite.prepare(`
      UPDATE positions SET status = 'closed', closed_at = CURRENT_TIMESTAMP, 
      metadata = json_set(metadata, '$.close_tx', ?) WHERE id = ?
    `).run(closeTxHash, positionId);
    return this.get(positionId)!;
  }
  
  get(id: string): Position | null {
    const row = sqlite.prepare("SELECT * FROM positions WHERE id = ?").get(id);
    return row ? { ...row, metadata: JSON.parse(row.metadata) } : null;
  }
  
  getByUser(userId: string, status = "open"): Position[] {
    return sqlite.prepare(
      "SELECT * FROM positions WHERE user_id = ? AND status = ? ORDER BY opened_at DESC"
    ).all(userId, status).map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
  }
  
  async getPortfolio(userId: string): Promise<Portfolio> {
    const positions = this.getByUser(userId, "open");
    const closedToday = this.getClosedSince(userId, 24);
    
    return {
      userId,
      smartAccountAddress: db.getUser(userId)?.smart_account_address || "",
      totalValueUsd: positions.reduce((s, p) => s + (p.current_value_usd || 0), 0),
      pnl24h: closedToday.reduce((s, p) => s + p.pnl_usd, 0),
      yieldEarned: positions.filter(p => p.type === "yield").reduce((s, p) => s + p.pnl_usd, 0),
      arbProfits: positions.filter(p => p.type === "spot" && p.metadata?.isArb).reduce((s, p) => s + p.pnl_usd, 0),
      positions,
    };
  }
  
  private getClosedSince(userId: string, hours: number): Position[] {
    return sqlite.prepare(
      "SELECT * FROM positions WHERE user_id = ? AND status = 'closed' AND closed_at > datetime('now', ?)"
    ).all(userId, `-${hours} hours`).map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
  }
}

export const positionTracker = new PositionTracker();
```

### 10.3 Trade Logger (`core/tradeLogger.ts`)

```typescript
import { db as sqlite } from "./db.js";
import { v4 as uuid } from "uuid";

export interface Trade {
  id: string;
  user_id: string;
  type: "swap" | "deposit" | "withdraw" | "arb_buy" | "arb_sell" | "rotation";
  protocol: string;
  from_token?: string;
  to_token?: string;
  from_amount?: string;
  to_amount?: string;
  price_usd?: number;
  gas_usd?: number;
  tx_hash: string;
  position_id?: string;
  executed_at: string;
}

class TradeLogger {
  log(trade: Omit<Trade, "id" | "executed_at">): Trade {
    const id = `trd_${uuid().slice(0, 8)}`;
    sqlite.prepare(`
      INSERT INTO trades (id, user_id, type, protocol, from_token, to_token, 
        from_amount, to_amount, price_usd, gas_usd, tx_hash, position_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, trade.user_id, trade.type, trade.protocol, trade.from_token, 
           trade.to_token, trade.from_amount, trade.to_amount, trade.price_usd,
           trade.gas_usd, trade.tx_hash, trade.position_id);
    return this.get(id)!;
  }
  
  get(id: string): Trade | null {
    return sqlite.prepare("SELECT * FROM trades WHERE id = ?").get(id) || null;
  }
  
  getHistory(userId: string, opts?: { limit?: number; type?: string }): Trade[] {
    const limit = opts?.limit || 50;
    if (opts?.type) {
      return sqlite.prepare(
        "SELECT * FROM trades WHERE user_id = ? AND type = ? ORDER BY executed_at DESC LIMIT ?"
      ).all(userId, opts.type, limit);
    }
    return sqlite.prepare(
      "SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?"
    ).all(userId, limit);
  }
}

export const tradeLogger = new TradeLogger();
```

### 10.4 APY Aggregator (`core/scanner/apyAggregator.ts`)

```typescript
interface YieldOpportunity {
  protocol: string;
  pool: string;
  token: string;
  apy: number;
  tvl: number;
  risk: "low" | "medium" | "high";
  contractAddress?: string;
  action: "supply" | "stake" | "vault";
  source: string;
}

let cache: { data: YieldOpportunity[]; ts: number } | null = null;
const TTL = 120_000; // 2 min

export async function getYields(): Promise<YieldOpportunity[]> {
  if (cache && Date.now() - cache.ts < TTL) return cache.data;
  const results: YieldOpportunity[] = [];

  // Venus
  try {
    const res = await fetch("https://api.venus.io/api/governance/venus");
    const json = await res.json();
    // Parse supply APYs
    results.push({ protocol: "Venus", pool: "BNB Supply", token: "BNB", apy: /* parsed */, tvl: 0, risk: "low", action: "supply", source: "venus-api" });
  } catch {}

  // Beefy (all BSC vaults)
  try {
    const [apys, vaults] = await Promise.all([
      fetch("https://api.beefy.finance/apy").then(r => r.json()),
      fetch("https://api.beefy.finance/vaults").then(r => r.json()),
    ]);
    const bscVaults = vaults.filter((v: any) => v.chain === "bsc");
    for (const v of bscVaults.slice(0, 30)) {
      const apy = apys[v.id];
      if (typeof apy === "number" && apy > 0) {
        results.push({
          protocol: "Beefy",
          pool: v.name,
          token: v.token,
          apy: apy * 100,
          tvl: v.tvl || 0,
          risk: "medium",
          contractAddress: v.earnContractAddress,
          action: "vault",
          source: "beefy-api"
        });
      }
    }
  } catch {}

  // DefiLlama (BSC yields, massive dataset)
  try {
    const pools = await fetch("https://yields.llama.fi/pools").then(r => r.json());
    const bsc = pools.data.filter((p: any) => p.chain === "Binance" && p.apy > 0);
    for (const p of bsc.slice(0, 30)) {
      results.push({
        protocol: p.project,
        pool: p.pool,
        token: p.symbol,
        apy: p.apy,
        tvl: p.tvlUsd || 0,
        risk: p.apy > 50 ? "high" : p.apy > 15 ? "medium" : "low",
        action: "supply",
        source: "defillama"
      });
    }
  } catch {}

  cache = { data: results, ts: Date.now() };
  return results;
}
```

### 10.5 Yield Optimizer (`core/strategy/yieldOptimizer.ts`)

```typescript
import { getYields } from "../scanner/apyAggregator.js";
import { walletManager } from "../walletManager.js";
import { positionTracker } from "../positionTracker.js";
import { tradeLogger } from "../tradeLogger.js";
import { riskManager } from "../riskManager.js";
import { venusAdapter } from "../../adapters/venus.js";

interface DepositResult {
  positionId: string;
  protocol: string;
  apy: number;
  txHash: string;
  amount: string;
  alternatives: { protocol: string; apy: number }[];
}

export class YieldOptimizer {
  async deposit(userId: string, token: string, amount: string, forceProtocol?: string): Promise<DepositResult> {
    // 1. Get all yields
    const yields = await getYields();
    const relevant = yields.filter(y => y.token.toUpperCase().includes(token.toUpperCase()));
    relevant.sort((a, b) => b.apy - a.apy);

    // 2. Pick best or forced
    const target = forceProtocol
      ? relevant.find(y => y.protocol.toLowerCase() === forceProtocol.toLowerCase()) || relevant[0]
      : relevant[0];

    if (!target) throw new Error(`No yield opportunities found for ${token}`);

    // 3. Risk check
    riskManager.check(userId, { type: "deposit", amountUsd: parseFloat(amount) * /* price */ 600 });

    // 4. Execute via adapter
    const { client } = walletManager.getClient(userId);
    let txHash: string;

    if (target.protocol === "Venus") {
      txHash = await venusAdapter.supply(token, amount, client);
    } else {
      // Simulated for protocols without testnet
      txHash = `0xsim_${Date.now().toString(16)}`;
    }

    // 5. Track position
    const position = positionTracker.open({
      user_id: userId,
      type: "yield",
      protocol: target.protocol,
      token,
      amount,
      entry_apy: target.apy,
      tx_hash: txHash,
      metadata: { pool: target.pool }
    });

    // 6. Log trade
    tradeLogger.log({
      user_id: userId,
      type: "deposit",
      protocol: target.protocol,
      to_token: token,
      to_amount: amount,
      tx_hash: txHash,
      position_id: position.id
    });

    return {
      positionId: position.id,
      protocol: target.protocol,
      apy: target.apy,
      txHash,
      amount,
      alternatives: relevant.slice(1, 4).map(y => ({ protocol: y.protocol, apy: y.apy }))
    };
  }

  async shouldRotate(positionId: string, minImprovementBps = 50): Promise<RotationPlan | null> {
    const pos = positionTracker.get(positionId);
    if (!pos || pos.status !== "open") return null;

    const yields = await getYields();
    const best = yields.filter(y => y.token === pos.token).sort((a, b) => b.apy - a.apy)[0];

    if (!best) return null;
    const improvement = (best.apy - (pos.entry_apy || 0)) * 100;
    if (improvement < minImprovementBps) return null;

    return {
      currentProtocol: pos.protocol,
      currentApy: pos.entry_apy || 0,
      targetProtocol: best.protocol,
      targetApy: best.apy,
      improvementBps: improvement,
      estimatedGasCost: "0 (gasless)",
      netBenefit: `+${(improvement / 100).toFixed(2)}% APY`
    };
  }

  async rotate(userId: string, positionId: string, minImprovementBps?: number): Promise<any> {
    const plan = await this.shouldRotate(positionId, minImprovementBps);
    if (!plan) throw new Error("No profitable rotation found");
    // 1. Withdraw from current
    // 2. Deposit into target
    // 3. Close old position, open new
    // 4. Log both trades
  }
}

export const yieldOptimizer = new YieldOptimizer();
```

### 10.6 Delta-Neutral Strategy (`core/strategy/deltaNeutral.ts`)

```typescript
// On testnet: long leg is real (buy BNB via PancakeSwap), short leg is simulated
// Funding rates pulled from Binance Futures API (real mainnet data applied to sim)

export class DeltaNeutralStrategy {
  async open(userId: string, token: string, notionalUsd: string, maxFundingRate: number) {
    // 1. Fetch current funding rate from Binance
    const fundingRate = await this.getFundingRate(token);
    if (fundingRate < -maxFundingRate) throw new Error(`Funding rate ${fundingRate}% exceeds max`);

    // 2. Buy spot (real tx on testnet)
    const spotPrice = await priceAggregator.getPrice(token, "USDT");
    const spotAmount = parseFloat(notionalUsd) / spotPrice;
    const spotTx = await pancakeAdapter.swap("USDT", token, spotAmount.toString(), walletManager.getClient(userId).client);

    // 3. Record virtual short (simulated)
    const position = positionTracker.open({
      user_id: userId,
      type: "delta_neutral",
      protocol: "DeFAI (simulated perp)",
      token,
      amount: spotAmount.toString(),
      entry_price: spotPrice,
      tx_hash: spotTx,
      metadata: {
        shortEntry: spotPrice,
        shortSize: notionalUsd,
        fundingRate,
        isSimulated: true
      }
    });

    return position;
  }

  async getFundingRate(token: string): Promise<number> {
    // Binance Futures API (free, no key)
    const res = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${token}USDT&limit=1`);
    const data = await res.json();
    return parseFloat(data[0]?.fundingRate || "0") * 100;
  }

  async getPnL(positionId: string) {
    const pos = positionTracker.get(positionId);
    const currentPrice = await priceAggregator.getPrice(pos.token, "USDT");
    const spotPnl = (currentPrice - pos.entry_price) * parseFloat(pos.amount);
    const shortPnl = (pos.metadata.shortEntry - currentPrice) * parseFloat(pos.amount);
    const fundingAccrued = /* calculate based on time held * funding rate */;
    return { spotPnl, shortPnl, fundingAccrued, netPnl: spotPnl + shortPnl + fundingAccrued };
  }
}
```

### 10.7 Arb Scanner (`core/strategy/arbScanner.ts`)

```typescript
interface ArbOpportunity {
  id: string;
  token: string;
  buyDex: string;
  buyPrice: number;
  sellDex: string;
  sellPrice: number;
  spreadBps: number;
  estimatedProfitUsd: number;
  viable: boolean;
}

export class ArbScanner {
  async scan(token = "BNB"): Promise<ArbOpportunity[]> {
    const quotes = await priceAggregator.getAllQuotes(token, "USDT", "1");
    const opportunities: ArbOpportunity[] = [];

    // Compare every pair of DEXs
    for (let i = 0; i < quotes.length; i++) {
      for (let j = i + 1; j < quotes.length; j++) {
        const [cheap, expensive] = quotes[i].effectivePrice < quotes[j].effectivePrice
          ? [quotes[i], quotes[j]] : [quotes[j], quotes[i]];

        const spread = ((expensive.effectivePrice - cheap.effectivePrice) / cheap.effectivePrice) * 10000;

        if (spread > 10) { // > 0.1% spread
          opportunities.push({
            id: `arb_${Date.now()}_${i}_${j}`,
            token,
            buyDex: cheap.dex,
            buyPrice: cheap.effectivePrice,
            sellDex: expensive.dex,
            sellPrice: expensive.effectivePrice,
            spreadBps: Math.round(spread),
            estimatedProfitUsd: (expensive.effectivePrice - cheap.effectivePrice),
            viable: spread > 30 // > 0.3% to cover potential slippage
          });
        }
      }
    }
    return opportunities.sort((a, b) => b.spreadBps - a.spreadBps);
  }

  async execute(userId: string, opportunityId: string, maxSlippageBps = 50) {
    // 1. Re-verify the opportunity still exists (prices may have moved)
    // 2. Buy on cheap DEX
    // 3. Sell on expensive DEX
    // 4. Track both trades
    // 5. Calculate actual profit
  }
}
```

### 10.8 Risk Manager (`core/riskManager.ts`)

```typescript
import { db } from "./db.js";

interface RiskConfig {
  maxPositionUsd: number;      // default: 1000
  maxSlippageBps: number;      // default: 50
  stopLossPct: number;         // default: 5
  maxTotalExposureUsd: number; // default: 5000
  allowedProtocols: string[];  // default: all
}

const DEFAULT_CONFIG: RiskConfig = {
  maxPositionUsd: 1000,
  maxSlippageBps: 50,
  stopLossPct: 5,
  maxTotalExposureUsd: 5000,
  allowedProtocols: [],
};

export class RiskManager {
  getConfig(userId: string): RiskConfig {
    const user = db.getUser(userId);
    return user?.risk_config ? { ...DEFAULT_CONFIG, ...JSON.parse(user.risk_config) } : DEFAULT_CONFIG;
  }

  configure(userId: string, update: Partial<RiskConfig>) {
    const current = this.getConfig(userId);
    const merged = { ...current, ...update };
    db.updateRiskConfig(userId, JSON.stringify(merged));
    return merged;
  }

  check(userId: string, action: { type: string; amountUsd: number }): { allowed: boolean; reason?: string } {
    const config = this.getConfig(userId);

    if (action.amountUsd > config.maxPositionUsd) {
      return { allowed: false, reason: `Amount $${action.amountUsd} exceeds max position $${config.maxPositionUsd}` };
    }

    // Check total exposure
    const positions = positionTracker.getByUser(userId, "open");
    const totalExposure = positions.reduce((s, p) => s + (p.current_value_usd || 0), 0);
    if (totalExposure + action.amountUsd > config.maxTotalExposureUsd) {
      return { allowed: false, reason: `Total exposure would exceed $${config.maxTotalExposureUsd}` };
    }

    return { allowed: true };
  }
}

export const riskManager = new RiskManager();
```

---

## 11. PROTOCOL ADAPTERS INTERFACE

```typescript
// adapters/types.ts
import type { Address } from "viem";

export interface TxResult {
  txHash: string;
  success: boolean;
  gasUsed?: string;
  error?: string;
}

export interface PriceQuote {
  dex: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  effectivePrice: number;
  priceImpact: number;
}

export interface ProtocolAdapter {
  name: string;
  supply?(token: string, amount: string, client: any): Promise<string>; // returns txHash
  withdraw?(token: string, amount: string, client: any): Promise<string>;
  swap?(from: string, to: string, amount: string, client: any): Promise<string>;
  getQuote?(from: string, to: string, amount: string): Promise<PriceQuote>;
  getApy?(token: string): Promise<number>;
  getBalance?(token: string, address: Address): Promise<string>;
}
```

---

## 12. FREE APIs & OPEN SOURCE REPOS

### Free APIs (No Key Required)
| API | URL | Data |
|---|---|---|
| Beefy Finance | `https://api.beefy.finance/apy` | All vault APYs |
| Beefy Vaults | `https://api.beefy.finance/vaults` | Vault metadata |
| CoinGecko | `https://api.coingecko.com/api/v3/simple/price` | Token prices |
| DexScreener | `https://api.dexscreener.com/latest/dex/tokens/{addr}` | DEX pair data |
| Venus API | `https://api.venus.io/api/governance/venus` | Supply/borrow APYs |
| PancakeSwap | `https://api.pancakeswap.finance/api/v3/` | Pool data |
| Binance Futures | `https://fapi.binance.com/fapi/v1/fundingRate` | Funding rates |
| DefiLlama | `https://yields.llama.fi/pools` | Aggregated yields |
| BSC Faucet | `https://testnet.bnbchain.org/faucet-smart` | Free testnet BNB |

### Free APIs (Key Required, Free Tier)
| API | Free Tier | Data |
|---|---|---|
| Pimlico | Free testnet usage | Bundler + Paymaster |
| Groq | Free tier (generous) | LLM inference |

### Open Source Repos
| Repo | Use For |
|---|---|
| [`modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | MCP server |
| [`pimlicolabs/permissionless.js`](https://github.com/pimlicolabs/permissionless.js) | Account Abstraction |
| [`wevm/viem`](https://github.com/wevm/viem) | Chain interactions |
| [`beefyfinance/beefy-api`](https://github.com/beefyfinance/beefy-api) | Vault interaction ref |
| [`VenusProtocol/venus-protocol`](https://github.com/VenusProtocol/venus-protocol) | Contract ABIs |
| [`pancakeswap/pancake-frontend`](https://github.com/pancakeswap/pancake-frontend) | ABI references |
| [`DefiLlama/yield-server`](https://github.com/DefiLlama/yield-server) | APY calculation ref |
| [`telegraf/telegraf`](https://github.com/telegraf/telegraf) | Telegram bot |

---

## 13. TELEGRAM BOT — PARALLEL ENDPOINT

**Keep it.** It calls the same core engine. Changes needed:

- Remove all Hinglish → English only
- Remove remittance → replace with arb + delta-neutral
- `/start` → user registration (collect private key via DM)
- `/scan` → `apyAggregator.getAll()`
- `/deposit <amount> <token>` → `yieldOptimizer.deposit(userId, ...)`
- `/rotate [position_id]` → `yieldOptimizer.rotate(userId, ...)`
- `/arb` → `arbScanner.scan()`
- `/delta <amount> <token>` → `deltaNeutral.open(userId, ...)`
- `/portfolio` → `positionTracker.getPortfolio(userId)`
- `/trades` → `tradeLogger.getHistory(userId)`
- `/risk` → show/set risk config
- `/link <api_key>` → link existing user account to this Telegram ID
- All resolved via `userResolver.resolveFromTelegram(ctx.from.id)`

---

## 14. ON-CHAIN ADDRESSES (BSC Testnet)

| Contract | Address | Notes |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Keep |
| SimpleAccountFactory v0.7 | `0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985` | Keep |
| Venus vBNB | `0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c` | Keep |
| Testnet USDT | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` | Keep |
| PancakeSwap V2 Router | `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` | Add |
| WBNB (Testnet) | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` | Add |
| Pimlico Paymaster | `0x0000000000000039cd5e8aE05257CE51C473ddd1` | Keep |

---

## 15. IMPLEMENTATION ROADMAP

### Phase 1 — Foundation (Days 1-2)
- [ ] Restructure project to new folder layout
- [ ] Remove India-specific code
- [ ] `npm install better-sqlite3 uuid jsonwebtoken @modelcontextprotocol/sdk express cors`
- [ ] Implement `core/db.ts` with full schema
- [ ] Implement `core/userResolver.ts`
- [ ] Implement `wallet/encryption.ts` (AES-256-GCM)
- [ ] Refactor `walletManager.ts` for multi-user with DB-backed users
- [ ] Build MCP server with `wallet_setup` + `ping` tools
- [ ] Test MCP with Claude Desktop

### Phase 2 — Market Scanner (Days 3-4)
- [ ] `core/scanner/apyAggregator.ts` (Venus + Beefy + DefiLlama)
- [ ] `core/scanner/priceAggregator.ts` (PancakeSwap + DexScreener)
- [ ] `core/scanner/fundingRates.ts` (Binance Futures API)
- [ ] `core/scanner/cache.ts` (TTL cache)
- [ ] Wire `scan_markets` MCP tool
- [ ] `monitor/snapshotLogger.ts` — cron to save market data to SQLite

### Phase 3 — Yield Optimizer (Days 5-6)
- [ ] Generalize Venus adapter (supply + withdraw)
- [ ] Add Beefy adapter (simulated if no testnet)
- [ ] `core/strategy/yieldOptimizer.ts` — deposit + rotate
- [ ] `core/positionTracker.ts` — SQLite-backed
- [ ] `core/tradeLogger.ts` — SQLite-backed
- [ ] Wire `yield_deposit` + `yield_rotate` + `portfolio` + `trade_history` MCP tools

### Phase 4 — DEX + Arb (Days 7-8)
- [ ] PancakeSwap swap adapter (V2 router on testnet)
- [ ] Thena / BiSwap adapters (simulated)
- [ ] `core/strategy/arbScanner.ts`
- [ ] Wire `swap_tokens` + `arb_execute` MCP tools
- [ ] `monitor/arbWatcher.ts` — cron

### Phase 5 — Delta-Neutral (Days 9-10)
- [ ] Simulated perp short tracking
- [ ] Binance funding rate integration
- [ ] `core/strategy/deltaNeutral.ts` — open, close, rebalance, PnL
- [ ] Wire `delta_neutral_open` MCP tool
- [ ] `monitor/positionHealth.ts` — cron

### Phase 6 — Risk + API (Days 11-12)
- [ ] `core/riskManager.ts`
- [ ] Wire `risk_config` + `set_alerts` MCP tools
- [ ] Build REST API (`api/server.ts` + routes)
- [ ] JWT auth middleware
- [ ] Refactor Telegram bot to use new core engine + userResolver

### Phase 7 — Dashboard (Days 13-15)
- [ ] Set up Vite + React + Tailwind
- [ ] Login page (API key → JWT)
- [ ] Dashboard page (portfolio summary + charts)
- [ ] Portfolio page (detailed positions)
- [ ] Trades page (history table)
- [ ] Markets page (live APY/price tables)
- [ ] Settings page (risk config, alerts, linked accounts)

### Phase 8 — Polish (Days 16-17)
- [ ] SSE transport for remote MCP access
- [ ] End-to-end testing across all transports
- [ ] Deploy: MCP server + API + dashboard
- [ ] Write documentation

---

## 16. VIBE CODE GUIDE — Step-by-Step Start

### Step 0: New Branch + Dependencies

```bash
git checkout -b mcp-refactor

npm install @modelcontextprotocol/sdk express cors better-sqlite3 uuid jsonwebtoken
npm install -D @types/express @types/better-sqlite3 @types/uuid @types/jsonwebtoken

# Verify existing deps
npm ls viem permissionless telegraf groq-sdk
```

### Step 1: Create Folders

```bash
mkdir -p src/mcp/tools src/mcp/resources
mkdir -p src/core/strategy src/core/scanner
mkdir -p src/adapters
mkdir -p src/api/middleware src/api/routes
mkdir -p abis docs data
echo "data/" >> .gitignore
```

### Step 2: Database First (`src/core/db.ts`)

Build this first — everything depends on it:

```typescript
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "defai.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run full schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users ( /* ... full schema from Section 3.2 ... */ );
  CREATE TABLE IF NOT EXISTS api_keys ( /* ... */ );
  CREATE TABLE IF NOT EXISTS positions ( /* ... */ );
  CREATE TABLE IF NOT EXISTS trades ( /* ... */ );
  CREATE TABLE IF NOT EXISTS alerts ( /* ... */ );
  CREATE TABLE IF NOT EXISTS market_snapshots ( /* ... */ );
  /* indexes */
`);

export { db };
```

Test: `npx ts-node -e "import { db } from './src/core/db'; console.log(db.prepare('SELECT 1').get());"`

### Step 3: Encryption Module (`src/wallet/encryption.ts`)

```typescript
import crypto from "crypto";

const ALGO = "aes-256-gcm";

export function encrypt(plaintext: string, passphrase: string): string {
  const key = crypto.scryptSync(passphrase, "defai-salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decrypt(ciphertext: string, passphrase: string): string {
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  const key = crypto.scryptSync(passphrase, "defai-salt", 32);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

Test: `npx ts-node -e "import { encrypt, decrypt } from './src/wallet/encryption'; const e = encrypt('hello', 'pass'); console.log(decrypt(e, 'pass'));"`

### Step 4: Minimal MCP Server with ping

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "defai-bnb", version: "0.1.0" });

server.tool("ping", "Test connectivity", {}, async () => ({
  content: [{ type: "text", text: "pong — DeFAI MCP is alive" }]
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
```

Add script: `"mcp": "ts-node src/mcp/server.ts"`

**Test with Claude Desktop** → add to config → restart → ask Claude to use ping tool.

### Step 5: wallet_setup tool (using real Pimlico code)

Wire `walletManager.ts` (Section 10.1) + `userResolver.ts` (Section 2.3) → add `wallet_setup` tool → test via Claude Desktop.

### Step 6: scan_markets tool

Wire `apyAggregator.ts` (Section 10.4) → add `scan_markets` tool → test.

### Step 7: yield_deposit + portfolio tools

Wire `yieldOptimizer.ts` + `positionTracker.ts` + `tradeLogger.ts` → add tools → test full deposit flow.

### Step 8: Continue one tool at a time

Follow the pattern: **core logic → adapter → MCP tool → test via Claude → wire Telegram command**.

```
Step 8a: swap_tokens
Step 8b: arb_execute  
Step 8c: yield_rotate
Step 8d: delta_neutral_open
Step 8e: risk_config + set_alerts
Step 8f: trade_history + link_telegram
```

### Step 9: REST API + Dashboard

Once all MCP tools work, the REST API is trivial — it calls the same functions. Then build the React dashboard.

### Step 10: Deploy

```bash
# Build
npm run build

# Run all services (production)
node dist/index.js  # starts MCP (stdio) + API server + Telegram bot + crons

# Or run separately
MCP_TRANSPORT=sse node dist/mcp/server.js  # MCP via SSE
node dist/api/server.js                     # Dashboard API
node dist/bot/index.js                      # Telegram bot
```

---

## 17. DEPENDENCY LIST (Final)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "better-sqlite3": "^11.0.0",
    "uuid": "^9.0.0",
    "jsonwebtoken": "^9.0.0",
    "viem": "^2.0.0",
    "permissionless": "^0.1.0",
    "telegraf": "^4.16.0",
    "groq-sdk": "^0.5.0",
    "node-cron": "^3.0.0",
    "pino": "^9.0.0",
    "supermemory": "^0.1.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^9.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/cors": "^2.8.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0"
  },
  "scripts": {
    "dev": "ts-node src/index.ts",
    "mcp": "ts-node src/mcp/server.ts",
    "mcp:sse": "MCP_TRANSPORT=sse ts-node src/mcp/server.ts",
    "api": "ts-node src/api/server.ts",
    "bot": "ts-node src/bot/index.ts",
    "build": "tsc",
    "test:wallet": "ts-node src/scripts/testWallet.ts",
    "test:mcp": "ts-node src/scripts/testMcp.ts",
    "seed": "ts-node src/scripts/seedTestData.ts"
  }
}
```

---

## 18. SUCCESS CRITERIA

When complete, the following should all work:

**Via MCP (Claude Desktop):**
1. "Set up my wallet with key 0x..." → get userId, smart account, API key
2. "Scan BSC markets" → APYs from Venus, Beefy, DefiLlama; prices; funding rates
3. "Deposit 0.05 BNB into best yield" → auto-selects highest APY → on-chain tx
4. "Rotate my yield if better exists" → checks, withdraws, redeposits
5. "Find arbitrage" → shows cross-DEX price spreads
6. "Execute that arb" → buys cheap, sells expensive
7. "Open delta-neutral on BNB" → buys spot + tracks virtual short
8. "Show portfolio" → all positions, PnL, yields, trade count
9. "Show trade history" → last 20 trades with tx hashes

**Via Telegram:**
10. Same commands via `/scan`, `/deposit`, `/arb`, `/delta`, `/portfolio`, `/trades`
11. Push alerts when APY drops or arb appears

**Via Dashboard:**
12. Login with API key → see full portfolio overview
13. Position detail pages with PnL charts
14. Trade history with BSCScan links
15. Live market data tables (auto-refresh)
16. Settings: risk config, alerts, linked accounts

**Cross-Transport:**
17. Deposit via MCP → appears in Telegram `/portfolio` → appears in dashboard
18. All three share the same userId, same SQLite data, same core engine
