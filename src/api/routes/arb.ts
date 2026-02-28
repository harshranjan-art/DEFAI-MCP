import { Router } from 'express';
import * as dbOps from '../../core/db';
import * as engine from '../../core/engine';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const session = dbOps.getAutoArbSession(req.userId!);
    res.json({ session: session || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/executions', authMiddleware, (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    // Get both arb_buy and arb_sell trades, sorted by timestamp
    const buyTrades = engine.getTradeHistory(req.userId!, { limit: limit * 2, type: 'arb_buy' });
    const sellTrades = engine.getTradeHistory(req.userId!, { limit: limit * 2, type: 'arb_sell' });

    // Merge and sort by timestamp descending, keeping only the limit
    const allTrades = [...buyTrades, ...sellTrades]
      .sort((a: any, b: any) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime())
      .slice(0, limit);

    res.json({ executions: allTrades });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
