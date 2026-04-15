// CsrfGuard only fires when the request is both (a) state-changing and
// (b) authenticated via a cookie. Mobile / Bearer-header flows bypass.

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import { CSRF_COOKIE } from '../helpers/cookies';
import { CsrfGuard } from './csrf.guard';

function ctxFor(
  req: Partial<Request> & { cookies?: Record<string, string>; authTransport?: 'cookie' | 'header' },
): ExecutionContext {
  const fullReq = {
    method: 'POST',
    header: (name: string) =>
      (req as unknown as { headers?: Record<string, string> }).headers?.[name.toLowerCase()],
    ...req,
  } as unknown as Request;
  return {
    switchToHttp: () => ({
      getRequest: () => fullReq,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  it('allows GET requests regardless of transport', () => {
    const g = new CsrfGuard();
    expect(g.canActivate(ctxFor({ method: 'GET', authTransport: 'cookie' }))).toBe(true);
  });

  it('allows state-changing requests authenticated via header (mobile)', () => {
    const g = new CsrfGuard();
    expect(g.canActivate(ctxFor({ method: 'POST', authTransport: 'header' }))).toBe(true);
  });

  it('rejects state-changing cookie-auth requests with no CSRF header', () => {
    const g = new CsrfGuard();
    expect(() =>
      g.canActivate(
        ctxFor({
          method: 'POST',
          authTransport: 'cookie',
          cookies: { [CSRF_COOKIE]: 'abc' },
          headers: {},
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects state-changing cookie-auth requests when the header does not match the cookie', () => {
    const g = new CsrfGuard();
    expect(() =>
      g.canActivate(
        ctxFor({
          method: 'POST',
          authTransport: 'cookie',
          cookies: { [CSRF_COOKIE]: 'abc' },
          headers: { 'x-csrf-token': 'wrong' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows when cookie and header match exactly', () => {
    const g = new CsrfGuard();
    expect(
      g.canActivate(
        ctxFor({
          method: 'POST',
          authTransport: 'cookie',
          cookies: { [CSRF_COOKIE]: 'abc' },
          headers: { 'x-csrf-token': 'abc' },
        }),
      ),
    ).toBe(true);
  });

  it('covers every state-changing verb (POST/PUT/PATCH/DELETE)', () => {
    const g = new CsrfGuard();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        g.canActivate(
          ctxFor({ method, authTransport: 'cookie', cookies: { [CSRF_COOKIE]: 'a' }, headers: {} }),
        ),
      ).toThrow(ForbiddenException);
    }
  });
});
