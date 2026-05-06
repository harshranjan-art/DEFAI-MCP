import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger';

/**
 * JWT signing secret. Required at runtime — no fallback.
 * Lazy-evaluated so unit tests can set process.env.JWT_SECRET before each test.
 */
function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'JWT_SECRET env var is required and must be >= 32 chars. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return s;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <jwt>' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch (e: any) {
    logger.warn('Auth: invalid token: %s', e.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
