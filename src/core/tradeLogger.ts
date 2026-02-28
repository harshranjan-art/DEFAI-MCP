import { v4 as uuid } from 'uuid';
import * as dbOps from './db';
import { logger } from '../utils/logger';

export interface Trade {
  id: string;
  user_id: string;
  type: 'swap' | 'deposit' | 'withdraw' | 'arb_buy' | 'arb_sell' | 'rotation' | 'delta_spot_buy' | 'delta_spot_sell' | 'delta_short_open' | 'delta_short_close' | 'transfer';
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

export function logTrade(trade: Omit<Trade, 'id' | 'executed_at'>): Trade {
  const id = `trd_${uuid().slice(0, 8)}`;
  dbOps.insertTrade({
    id,
    user_id: trade.user_id,
    type: trade.type,
    protocol: trade.protocol,
    from_token: trade.from_token,
    to_token: trade.to_token,
    from_amount: trade.from_amount,
    to_amount: trade.to_amount,
    price_usd: trade.price_usd,
    gas_usd: trade.gas_usd,
    tx_hash: trade.tx_hash,
    position_id: trade.position_id,
  });
  logger.info('Trade logged: %s (%s on %s, tx: %s)', id, trade.type, trade.protocol, trade.tx_hash);
  return getTrade(id)!;
}

export function getTrade(id: string): Trade | null {
  const rows = dbOps.getTrades('', { limit: 1 });
  // Direct lookup
  const row = dbOps.db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
  return row || null;
}

export function getHistory(userId: string, opts?: { limit?: number; type?: string }): Trade[] {
  return dbOps.getTrades(userId, opts);
}
