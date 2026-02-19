import { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';
import { timingSafeEqual } from '../../utils/security.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  const apiKey =
    (req.headers['x-api-key'] as string) ||
    (req.headers['authorization']?.replace('Bearer ', '') as string) ||
    (req.query['api_key'] as string) ||
    '';

  if (!apiKey || !timingSafeEqual(apiKey, config.apiKey)) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
}
