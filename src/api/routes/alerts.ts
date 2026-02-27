import { Router } from 'express';
import * as engine from '../../core/engine';
import * as dbOps from '../../core/db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, (req, res) => {
  try {
    const alerts = engine.getAlerts(req.userId!);
    res.json({ alerts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/unread', authMiddleware, (req, res) => {
  try {
    const notifications = dbOps.db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 50'
    ).all(req.userId!);
    res.json({ notifications });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/mark-read', authMiddleware, (req, res) => {
  try {
    const { notification_ids } = req.body;
    if (!Array.isArray(notification_ids)) {
      res.status(400).json({ error: 'notification_ids must be an array.' });
      return;
    }
    for (const id of notification_ids) {
      dbOps.db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
        .run(id, req.userId!);
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
