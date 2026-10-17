import type { NextFunction, Request, Response } from 'express';

/** Install before parsers and guards so private error responses are covered.
 * A later route may replace this default for explicitly public immutable media.
 */
export function privateApiCacheControl(req: Request, res: Response, next: NextFunction): void {
  // Express routes are case-insensitive by default; the privacy boundary must
  // cover the same /v1 namespace, including its otherwise-unmatched root.
  if (/^\/v1(?:\/|$)/i.test(req.path)) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
