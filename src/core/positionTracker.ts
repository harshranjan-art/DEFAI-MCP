import { v4 as uuid } from 'uuid';
import * as dbOps from './db';
import { logger } from '../utils/logger';

export interface Position {
  id: string;
  user_id: string;
  type: 'yield' | 'delta_neutral' | 'lp' | 'spot';
  protocol: string;
  token: string;
  amount: string;
  entry_price?: number;
  entry_apy?: number;
  current_value_usd?: number;
  pnl_usd: number;
  status: 'open' | 'closed';
  tx_hash?: string;
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

function parseRow(row: any): Position {
  return {
    ...row,
    pnl_usd: row.pnl_usd || 0,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

export function openPosition(pos: {
  user_id: string;
  type: Position['type'];
  protocol: string;
  token: string;
  amount: string;
  entry_price?: number;
  entry_apy?: number;
  tx_hash?: string;
  metadata?: Record<string, any>;
}): Position {
  const id = `pos_${uuid().slice(0, 8)}`;
  dbOps.insertPosition({
    id,
    user_id: pos.user_id,
    type: pos.type,
    protocol: pos.protocol,
    token: pos.token,
    amount: pos.amount,
    entry_price: pos.entry_price,
    entry_apy: pos.entry_apy,
    tx_hash: pos.tx_hash,
    metadata: JSON.stringify(pos.metadata || {}),
  });
  logger.info('Position opened: %s (%s %s on %s)', id, pos.amount, pos.token, pos.protocol);
  return getPosition(id)!;
}

export function closePosition(positionId: string, closeTxHash?: string): Position {
  dbOps.closePosition(positionId, closeTxHash);
  logger.info('Position closed: %s', positionId);
  return getPosition(positionId)!;
}

export function getPosition(id: string): Position | null {
  const row = dbOps.getPosition(id);
  return row ? parseRow(row) : null;
}

export function getByUser(userId: string, status = 'open'): Position[] {
  return dbOps.getPositions(userId, status).map(parseRow);
}

export function getAllOpenPositions(): Position[] {
  const rows = dbOps.db.prepare('SELECT * FROM positions WHERE status = ?').all('open') as any[];
  return rows.map(parseRow);
}

export function getPortfolio(userId: string): Portfolio {
  const user = dbOps.getUser(userId);
  const positions = getByUser(userId, 'open');

  return {
    userId,
    smartAccountAddress: user?.smart_account_address || '',
    totalValueUsd: positions.reduce((s, p) => s + (p.current_value_usd || 0), 0),
    pnl24h: 0, // TODO: calculate from closed positions in last 24h
    yieldEarned: positions
      .filter(p => p.type === 'yield')
      .reduce((s, p) => s + p.pnl_usd, 0),
    arbProfits: positions
      .filter(p => p.type === 'spot' && p.metadata?.isArb)
      .reduce((s, p) => s + p.pnl_usd, 0),
    positions,
  };
}
