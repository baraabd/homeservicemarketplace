import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function ctxWith(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function reflectorWith(required?: string[]): Reflector {
  const r = new Reflector();
  // Reflector.getAllAndOverride is a typed generic; the mock signature must
  // accept the same (metadataKey, targets) pair. Using `as never` opts out
  // of the generic constraint cleanly without losing test intent.
  jest
    .spyOn(r, 'getAllAndOverride')
    .mockImplementation(((metadataKey: unknown) =>
      metadataKey === ROLES_KEY ? required : undefined) as never);
  return r;
}

describe('RolesGuard', () => {
  it('allows routes without @Roles metadata', () => {
    const g = new RolesGuard(reflectorWith(undefined));
    expect(g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: [] }))).toBe(true);
  });

  it('rejects when user is missing', () => {
    const g = new RolesGuard(reflectorWith(['admin']));
    expect(() => g.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });

  it('rejects when user has none of the required roles', () => {
    const g = new RolesGuard(reflectorWith(['admin']));
    expect(() =>
      g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: ['customer'] })),
    ).toThrow(ForbiddenException);
  });

  it('allows when the user holds at least one of the required roles', () => {
    const g = new RolesGuard(reflectorWith(['admin', 'provider']));
    expect(g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: ['provider'] }))).toBe(
      true,
    );
  });
});
