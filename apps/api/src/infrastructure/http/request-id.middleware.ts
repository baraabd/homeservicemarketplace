import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // pino-http validates or generates an id before this middleware runs.
    // Reuse it so request logs, response headers and error envelopes agree.
    const existing = typeof req.id === 'string' && SAFE_ID.test(req.id) ? req.id : undefined;
    const incoming = req.header(REQUEST_ID_HEADER);
    const id =
      existing ??
      (typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID());
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
