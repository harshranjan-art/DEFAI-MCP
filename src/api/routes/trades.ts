import { Router } from 'express';
import * as engine from '../../core/engine';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string | undefined;
    const trades = engine.getTradeHistory(req.userId!, { limit, type });
    res.json({ trades });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
