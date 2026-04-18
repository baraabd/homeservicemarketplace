import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionResolverService } from '../services/permission-resolver.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const granted = await this.resolver.resolveForRoles(user.roles);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) throw new ForbiddenException({ code: 'FORBIDDEN' });
    return true;
  }
}
