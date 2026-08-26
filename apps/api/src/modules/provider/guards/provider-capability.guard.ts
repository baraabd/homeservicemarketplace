import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderCapabilityService } from '../capability/provider-capability.service';
import { REQUIRED_PROVIDER_CAPABILITY } from './require-capability.decorator';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Sprint 9B.8 — one guard, and the route says what it needs.
//
// docs/sprint-09b8/ROUTE_CAPABILITY_MATRIX.md
//
// This decides nothing. It reads the capability the route declared, asks
// ProviderCapabilityService, and translates the answer into HTTP — the same
// division ProviderActiveGuard established in Sprint 7 and which ADR 0006
// requires, so that a rule lives in one file rather than in every call site
// that used to compare an enum.
//
// THE DEFAULT IS DELIBERATELY THE STRICTEST COMMON ONE
//
// A route that declares nothing gets VIEW_MARKETPLACE, which is what every
// route got before this sprint. So forgetting the decorator cannot silently
// widen access: it reproduces the old behaviour, and the old behaviour was the
// strict one. Getting it wrong in the other direction — defaulting to
// something permissive — would mean a new route family shipped ungated and
// nothing would fail.
//
// THE RESPONSE IS DELIBERATELY UNIFORM
//
// A stable `{ code: 'FORBIDDEN' }` envelope with no reason, so a caller cannot
// distinguish "no profile" from "not verified" from "grant expired" from
// "suspended" by probing. Providers who want to know why ask
// GET /v1/me/provider/capabilities, which answers for their own account only.
@Injectable()
export class ProviderCapabilityGuard implements CanActivate {
  constructor(
    private readonly capabilities: ProviderCapabilityService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const required =
      this.reflector.getAllAndOverride<ProviderCapability | undefined>(
        REQUIRED_PROVIDER_CAPABILITY,
        [ctx.getHandler(), ctx.getClass()],
      ) ?? ProviderCapability.ViewMarketplace;

    const allowed = await this.capabilities.can(user.id, required);
    if (!allowed) throw new ForbiddenException({ code: 'FORBIDDEN' });
    return true;
  }
}
