import { Router } from 'express';
import * as engine from '../../core/engine';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const portfolio = engine.getPortfolio(req.userId!);
    res.json(portfolio);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
