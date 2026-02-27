import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'defai.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema (idempotent) ───

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    encrypted_private_key TEXT NOT NULL,
    smart_account_address TEXT NOT NULL,
    pimlico_api_key TEXT,
    telegram_id INTEGER UNIQUE,
    risk_config TEXT DEFAULT '{}',
    alert_config TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    protocol TEXT NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL,
    entry_price REAL,
    entry_apy REAL,
    current_value_usd REAL,
    pnl_usd REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    tx_hash TEXT,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    metadata TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    threshold REAL NOT NULL,
    active INTEGER DEFAULT 1,
    last_triggered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    alert_type TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol TEXT NOT NULL,
    token TEXT NOT NULL,
    apy REAL,
    price_usd REAL,
    tvl_usd REAL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, executed_at);
  CREATE INDEX IF NOT EXISTS idx_snapshots_time ON market_snapshots(recorded_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
`);

logger.info('SQLite database initialized at %s', DB_PATH);

// ─── User Helpers ───

export function getUser(id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any | undefined;
}

export function getUserByTelegramId(telegramId: number) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as any | undefined;
}

export function getUserByApiKey(apiKey: string) {
  const row = db.prepare(
    'SELECT u.* FROM users u JOIN api_keys ak ON u.id = ak.user_id WHERE ak.key = ?'
  ).get(apiKey) as any | undefined;
  return row;
}

export function saveUser(user: {
  id: string;
  encrypted_private_key: string;
  smart_account_address: string;
  pimlico_api_key?: string;
  telegram_id?: number;
  risk_config?: string;
  alert_config?: string;
}) {
  db.prepare(`
    INSERT INTO users (id, encrypted_private_key, smart_account_address, pimlico_api_key, telegram_id, risk_config, alert_config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.encrypted_private_key,
    user.smart_account_address,
    user.pimlico_api_key || null,
    user.telegram_id || null,
    user.risk_config || '{}',
    user.alert_config || '{}',
  );
}

export function saveApiKey(key: string, userId: string, label?: string) {
  db.prepare('INSERT INTO api_keys (key, user_id, label) VALUES (?, ?, ?)').run(key, userId, label || null);
}

export function setTelegramId(userId: string, telegramId: number) {
  db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').run(telegramId, userId);
}

export function updateRiskConfig(userId: string, config: string) {
  db.prepare('UPDATE users SET risk_config = ? WHERE id = ?').run(config, userId);
}

export function updateAlertConfig(userId: string, config: string) {
  db.prepare('UPDATE users SET alert_config = ? WHERE id = ?').run(config, userId);
}

export function getUserCount(): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  return row.count;
}

// ─── Position Helpers ───

export function getPositions(userId: string, status = 'open') {
  return db.prepare(
    'SELECT * FROM positions WHERE user_id = ? AND status = ? ORDER BY opened_at DESC'
  ).all(userId, status) as any[];
}

export function getPosition(id: string) {
  return db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as any | undefined;
}

export function insertPosition(pos: {
  id: string; user_id: string; type: string; protocol: string; token: string;
  amount: string; entry_price?: number; entry_apy?: number; tx_hash?: string; metadata?: string;
}) {
  db.prepare(`
    INSERT INTO positions (id, user_id, type, protocol, token, amount, entry_price, entry_apy, tx_hash, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pos.id, pos.user_id, pos.type, pos.protocol, pos.token, pos.amount,
    pos.entry_price ?? null, pos.entry_apy ?? null, pos.tx_hash ?? null, pos.metadata || '{}');
}

export function closePosition(id: string, closeTxHash?: string) {
  db.prepare(`
    UPDATE positions SET status = 'closed', closed_at = CURRENT_TIMESTAMP,
    metadata = json_set(metadata, '$.close_tx', ?) WHERE id = ?
  `).run(closeTxHash || null, id);
}

// ─── Trade Helpers ───

export function getTrades(userId: string, opts?: { limit?: number; type?: string }) {
  const limit = opts?.limit || 50;
  if (opts?.type) {
    return db.prepare(
      'SELECT * FROM trades WHERE user_id = ? AND type = ? ORDER BY executed_at DESC LIMIT ?'
    ).all(userId, opts.type, limit) as any[];
  }
  return db.prepare(
    'SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?'
  ).all(userId, limit) as any[];
}

export function insertTrade(trade: {
  id: string; user_id: string; type: string; protocol: string; tx_hash: string;
  from_token?: string; to_token?: string; from_amount?: string; to_amount?: string;
  price_usd?: number; gas_usd?: number; position_id?: string;
}) {
  db.prepare(`
    INSERT INTO trades (id, user_id, type, protocol, from_token, to_token, from_amount, to_amount, price_usd, gas_usd, tx_hash, position_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trade.id, trade.user_id, trade.type, trade.protocol, trade.from_token ?? null,
    trade.to_token ?? null, trade.from_amount ?? null, trade.to_amount ?? null,
    trade.price_usd ?? null, trade.gas_usd ?? null, trade.tx_hash, trade.position_id ?? null);
}

// ─── Alert Helpers ───

export function getAlerts(userId: string) {
  return db.prepare('SELECT * FROM alerts WHERE user_id = ? AND active = 1').all(userId) as any[];
}

export function insertAlert(alert: { id: string; user_id: string; type: string; threshold: number }) {
  db.prepare('INSERT INTO alerts (id, user_id, type, threshold) VALUES (?, ?, ?, ?)').run(
    alert.id, alert.user_id, alert.type, alert.threshold
  );
}

export function updateAlertTriggered(alertId: string) {
  db.prepare('UPDATE alerts SET last_triggered_at = CURRENT_TIMESTAMP WHERE id = ?').run(alertId);
}

// ─── Notification Helpers ───

export function insertNotification(n: { id: string; user_id: string; alert_type: string; message: string }) {
  db.prepare('INSERT INTO notifications (id, user_id, alert_type, message) VALUES (?, ?, ?, ?)').run(
    n.id, n.user_id, n.alert_type, n.message
  );
}

export function getUnreadNotifications(userId: string) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC'
  ).all(userId) as any[];
}

export function markNotificationsRead(userId: string) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
}

// ─── Market Snapshot Helpers ───

export function insertSnapshot(s: { protocol: string; token: string; apy?: number; price_usd?: number; tvl_usd?: number }) {
  db.prepare(
    'INSERT INTO market_snapshots (protocol, token, apy, price_usd, tvl_usd) VALUES (?, ?, ?, ?, ?)'
  ).run(s.protocol, s.token, s.apy ?? null, s.price_usd ?? null, s.tvl_usd ?? null);
}

export function getMarketSnapshots(opts?: { hours?: number; protocol?: string }) {
  const hours = opts?.hours || 24;
  if (opts?.protocol) {
    return db.prepare(
      "SELECT * FROM market_snapshots WHERE protocol = ? AND recorded_at > datetime('now', ?) ORDER BY recorded_at ASC"
    ).all(opts.protocol, `-${hours} hours`) as any[];
  }
  return db.prepare(
    "SELECT * FROM market_snapshots WHERE recorded_at > datetime('now', ?) ORDER BY recorded_at ASC"
  ).all(`-${hours} hours`) as any[];
}

export { db };
