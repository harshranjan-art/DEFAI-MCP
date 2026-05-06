import { Router } from 'express';
import * as engine from '../../core/engine';
import * as walletManager from '../../core/walletManager';
import { authMiddleware } from '../middleware/auth';
import { isOk, isNeedsConfirmation } from '../../core/result';

const router = Router();

// POST /api/transactions/send
// Body: { token, amount, to_address, client_op_id?, confirmation_token? }
//
// Two-phase: first call returns 202 with a confirmation_token + preview;
// caller must POST again with confirmation_token to execute.
router.post('/send', authMiddleware, async (req, res) => {
  const { token, amount, to_address, client_op_id, confirmation_token } = req.body;

  if (!token || !amount || !to_address) {
    res.status(400).json({ error: 'Missing required fields: token, amount, to_address' });
    return;
  }

  try {
    await walletManager.activate(req.userId!);
    const result = await engine.sendTokens({
      userId: req.userId!,
      token,
      amount,
      toAddress: to_address,
      client_op_id,
      confirmation_token,
    });
    if (isOk(result)) {
      res.json({ ok: true, data: result.data, trace_id: result.trace_id });
      return;
    }
    if (isNeedsConfirmation(result)) {
      res.status(202).json({ ok: false, needsConfirmation: result.needsConfirmation, trace_id: result.trace_id });
      return;
    }
    res.status(400).json({ ok: false, error: result.error, trace_id: result.trace_id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
