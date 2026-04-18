import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });
    const hasAny = user.roles.some((r) => required.includes(r));
    if (!hasAny) throw new ForbiddenException({ code: 'FORBIDDEN' });
    return true;
  }
}
