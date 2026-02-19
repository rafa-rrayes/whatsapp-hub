import { Request, Response, NextFunction } from 'express';

/**
 * Sec-Fetch-* header validation middleware.
 * Blocks browser requests where Sec-Fetch-Site is "cross-site".
 * Non-browser clients (curl, Postman, etc.) don't send these headers and pass through.
 */
export function secFetchMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secFetchSite = req.headers['sec-fetch-site'] as string | undefined;

  // No Sec-Fetch headers = non-browser client → pass through
  if (!secFetchSite) {
    return next();
  }

  // Allow same-origin, same-site, and none (direct navigation / bookmark)
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site' || secFetchSite === 'none') {
    return next();
  }

  // Block cross-site requests from browsers
  res.status(403).json({ error: 'Cross-site API requests are not allowed' });
}
