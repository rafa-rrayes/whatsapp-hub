import { Request, Response, NextFunction } from 'express';

/**
 * Adds Deprecation and Sunset headers on unversioned `/api/` access.
 * Clients should migrate to `/api/v1/`.
 */
export function deprecationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only tag unversioned access — /api/v1/ requests don't go through this
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Wed, 01 Mar 2027 00:00:00 GMT');
  res.setHeader('Link', '</api/v1/>; rel="successor-version"');
  next();
}
