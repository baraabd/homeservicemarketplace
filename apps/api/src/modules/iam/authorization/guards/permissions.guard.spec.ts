import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { PermissionResolverService } from '../services/permission-resolver.service';
import { PermissionsGuard } from './permissions.guard';

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
  jest
    .spyOn(r, 'getAllAndOverride')
    .mockImplementation(((metadataKey: unknown) =>
      metadataKey === PERMISSIONS_KEY ? required : undefined) as never);
  return r;
}

function resolverReturning(granted: string[]): PermissionResolverService {
  return {
    resolveForRoles: jest.fn().mockResolvedValue(new Set(granted)),
  } as unknown as PermissionResolverService;
}

describe('PermissionsGuard', () => {
  it('allows routes with no @Permissions metadata without querying the resolver', async () => {
    const resolver = resolverReturning([]);
    const g = new PermissionsGuard(reflectorWith(undefined), resolver);
    await expect(
      g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: [] })),
    ).resolves.toBe(true);
    expect(resolver.resolveForRoles).not.toHaveBeenCalled();
  });

  it('rejects when the user is not present', async () => {
    const g = new PermissionsGuard(reflectorWith(['user:read:any']), resolverReturning([]));
    await expect(g.canActivate(ctxWith(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('rejects when even one required permission is missing', async () => {
    const g = new PermissionsGuard(
      reflectorWith(['user:read:any', 'user:write:any']),
      resolverReturning(['user:read:any']),
    );
    await expect(
      g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: ['admin'] })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows when the resolved set contains every required permission', async () => {
    const g = new PermissionsGuard(
      reflectorWith(['user:read:any', 'user:write:any']),
      resolverReturning(['user:read:any', 'user:write:any', 'role:read']),
    );
    await expect(
      g.canActivate(ctxWith({ id: 'u', sessionId: 's', jti: 'j', roles: ['admin'] })),
    ).resolves.toBe(true);
  });
});
