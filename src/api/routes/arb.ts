import { Router } from 'express';
import * as dbOps from '../../core/db';
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

export default router;
