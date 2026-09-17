import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/** Set before guards so denied responses are not cacheable either. No request body logging. */
@Injectable()
export class DisputePrivacyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (/^\/v1\/me\/disputes(?:[/?]|$)/.test(req.originalUrl)) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Referrer-Policy', 'no-referrer');
    }
    next();
  }
}
