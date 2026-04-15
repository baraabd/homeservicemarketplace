// Pins the JwtAuthGuard contract: @Public() routes bypass entirely, any
// passport failure normalizes to a single AUTH_INVALID_CREDENTIALS code
// (no passport-internal leakage).

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

function baseCtx(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('short-circuits for @Public() routes without invoking passport', () => {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation(((metadataKey: unknown) =>
        metadataKey === IS_PUBLIC_KEY ? true : undefined) as never);
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(baseCtx())).toBe(true);
  });

  it('handleRequest normalizes any passport error to AUTH_INVALID_CREDENTIALS', () => {
    const guard = new JwtAuthGuard(new Reflector());
    expect(() => guard.handleRequest(new Error('jwt expired'), null)).toThrow(
      UnauthorizedException,
    );
    try {
      guard.handleRequest(new Error('any passport-internal message'), null);
      fail('expected UnauthorizedException');
    } catch (err) {
      const response = (err as UnauthorizedException).getResponse() as { code: string };
      expect(response.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
  });

  it('handleRequest rejects missing user (e.g. extractor returned null)', () => {
    const guard = new JwtAuthGuard(new Reflector());
    expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
  });

  it('handleRequest returns the user when auth succeeded', () => {
    const guard = new JwtAuthGuard(new Reflector());
    const user = { id: 'u', sessionId: 's', jti: 'j', roles: ['customer'] };
    expect(guard.handleRequest(null, user)).toBe(user);
  });
});
