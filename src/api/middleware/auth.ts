import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'defai-dev-secret';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <jwt>' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch (e: any) {
    logger.warn('Auth: invalid token: %s', e.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
