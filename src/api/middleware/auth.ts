import { Request, Response, NextFunction } from 'express';
import { config } from '../../config.js';
import { timingSafeEqual, extractBearerToken } from '../../utils/security.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/api/health') {
    return next();
  }

  const queryKey = config.security.disableHttpQueryAuth
    ? undefined
    : (req.query['api_key'] as string);

  const apiKey =
    (req.headers['x-api-key'] as string) ||
    extractBearerToken(req.headers['authorization'] as string) ||
    queryKey ||
    '';

  if (!apiKey || !timingSafeEqual(apiKey, config.apiKey)) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
}
