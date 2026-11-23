import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../authentication/types/authenticated-user';
import { hasCurrentAdminMembership } from '../current-admin';

/**
 * K06 — re-reads live admin membership on every request.
 *
 * RolesGuard trusts the token's `admin` claim, which outlives an out-of-band
 * role removal by up to the access-token lifetime. Use this AFTER RolesGuard
 * on admin controllers whose routes have no fresh permission check of their
 * own. It answers 403 exactly as RolesGuard does, so it reveals nothing new.
 */
@Injectable()
export class CurrentAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !(await hasCurrentAdminMembership(this.prisma.client, user.id))) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}
