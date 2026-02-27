import { Router } from 'express';
import { getYields } from '../../core/scanner/apyAggregator';
import { getAllQuotes } from '../../core/scanner/priceAggregator';
import { getFundingRates } from '../../core/scanner/fundingRates';
import * as dbOps from '../../core/db';

const router = Router();

// Public — no auth required

router.get('/yields', async (_req, res) => {
  try {
    const yields = await getYields();
    res.json({ yields });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/prices', async (req, res) => {
  try {
    const token = (req.query.token as string) || 'BNB';
    const quote = (req.query.quote as string) || 'USDT';
    const quotes = await getAllQuotes(token, quote);
    res.json({ quotes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/funding', async (_req, res) => {
  try {
    const rates = await getFundingRates();
    res.json({ rates });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const rows = dbOps.db.prepare(
      'SELECT * FROM market_snapshots ORDER BY recorded_at DESC LIMIT ?'
    ).all(limit);
    res.json({ snapshots: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
