import { Router } from 'express';
import * as engine from '../../core/engine';
import * as walletManager from '../../core/walletManager';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/transactions/send
// Body: { token: string, amount: string, to_address: string }
router.post('/send', authMiddleware, async (req, res) => {
  const { token, amount, to_address } = req.body;

  if (!token || !amount || !to_address) {
    res.status(400).json({ error: 'Missing required fields: token, amount, to_address' });
    return;
  }

  try {
    await walletManager.activate(req.userId!);
    const result = await engine.sendTokens(req.userId!, token, amount, to_address);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
