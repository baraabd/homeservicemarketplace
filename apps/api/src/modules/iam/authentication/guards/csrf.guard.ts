import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { CSRF_COOKIE } from '../helpers/cookies';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Applied globally. Runs AFTER JwtAuthGuard, so req.authTransport is set
// when the request carried a cookie-based access token. CSRF check only
// fires for:
//   - state-changing methods
//   - requests whose auth actually came from a cookie
// Mobile / Bearer-header flows are skipped.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();
    if (!STATE_CHANGING.has(method)) return true;
    if (req.authTransport !== 'cookie') return true;

    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[CSRF_COOKIE];
    const header = req.header('x-csrf-token');
    if (!cookie || !header || cookie !== header) {
      throw new ForbiddenException({ code: 'AUTH_CSRF_FAILED' });
    }
    return true;
  }
}
