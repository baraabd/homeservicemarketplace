import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../../shared/errors/app-error';

// D-1 — the global throttler guard, with two corrections over the stock one.
//
// 1. Stable error envelope. `ThrottlerException` is constructed with the
//    string "ThrottlerException: Too Many Requests", which AllExceptionsFilter
//    surfaces verbatim as `error.message`. Shipping a framework class name to
//    clients is exactly the internal-detail leak the error-mapping rules
//    forbid. We throw an AppError with the stable `RATE_LIMITED` code and a
//    user-facing message instead.
//
// 2. Explicit, proxy-aware tracker. The stock guard tracks `req.ip`, which is
//    only trustworthy once Express `trust proxy` is configured — that is done
//    from TRUST_PROXY_HOPS in main.ts. Normalising here keeps IPv6-mapped IPv4
//    (`::ffff:203.0.113.5`) and its bare form in ONE bucket rather than two.
//
// `Retry-After` is still set by the base class before it calls
// throwThrottlingException, so the header survives this override.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    // req.ip already honours `trust proxy`; never read X-Forwarded-For here.
    const ip = typeof request.ip === 'string' ? request.ip : '';
    const fallback = request.socket?.remoteAddress ?? '';
    return normalizeTrackerIp(ip || fallback);
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppError('RATE_LIMITED', 'Too many requests. Please try again shortly.', 429);
  }
}

export function normalizeTrackerIp(raw: string): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value || 'unknown';
}
