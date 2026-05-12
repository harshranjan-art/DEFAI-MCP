import { Router } from 'express';
import * as userResolver from '../../core/userResolver';
import * as dbOps from '../../core/db';
import { generateToken } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../../utils/logger';

const router = Router();

// Phase 6.5 — slow brute-force / account-farming attempts.
// Registers a fresh account is more constrained than logging in because
// creating accounts has lasting state (encrypted private key in DB).
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 3 });   // 3 per IP per hour
const loginLimiter    = rateLimit({ windowMs: 15 * 60_000, max: 5 });   // 5 per IP per 15 min

/**
 * POST /api/auth/register
 * Body: { private_key }
 * Returns: { userId, apiKey, smartAccountAddress, jwt }
 */
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { private_key } = req.body;
    if (!private_key) {
      res.status(400).json({ error: 'private_key is required.' });
      return;
    }

    const result = await userResolver.createUser({
      privateKey: private_key,
      label: 'api-register',
    });

    const token = generateToken(result.id);

    res.json({
      userId: result.id,
      apiKey: result.apiKey,
      smartAccountAddress: result.smartAccountAddress,
      jwt: token,
    });
  } catch (e: any) {
    logger.error('Auth register error: %s', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/auth/login
 * Body: { api_key }
 * Returns: { jwt, userId, smartAccountAddress }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { api_key } = req.body;
    if (!api_key) {
      res.status(400).json({ error: 'api_key is required.' });
      return;
    }

    const userId = userResolver.resolveFromApiKey(api_key);
    if (!userId) {
      res.status(401).json({ error: 'Invalid API key.' });
      return;
    }

    const user = dbOps.getUser(userId);
    const token = generateToken(userId);

    res.json({
      jwt: token,
      userId,
      smartAccountAddress: user?.smart_account_address || '',
    });
  } catch (e: any) {
    logger.error('Auth login error: %s', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
