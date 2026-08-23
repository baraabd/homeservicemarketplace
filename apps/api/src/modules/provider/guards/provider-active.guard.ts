import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderCapabilityService } from '../capability/provider-capability.service';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Marketplace gate for the provider route families.
//
// Sprint 7 — this guard no longer decides anything. It asks
// ProviderCapabilityService and translates the answer into an HTTP response.
//
// It previously read `profile.status !== 'ACTIVE'` directly, which had two
// problems worth recording:
//
//   1. It NEVER looked at the User account. A suspended, locked, or deleted
//      account whose provider row still said ACTIVE was refused only because
//      `assertSessionActive` happened to run first. The guard read as though
//      it were the authority and was not, and the guarantee rested on one
//      other call site continuing to be reached. Rank 0 of the capability
//      service now states it explicitly (docs/adr/0005).
//
//   2. Every route family had to remember the same string comparison.
//      `/v1/provider/*` and `/v1/me/provider/*` serve the same surfaces; a
//      rule added to one and not the other is a silent authorization split.
//      Both now resolve the same service, and a parity test walks both
//      families over the same fixtures.
//
// The observable contract is unchanged: a stable `{ code: 'FORBIDDEN' }`
// envelope, so a caller cannot distinguish "no profile" from "not approved"
// from "account suspended" by probing. Providers who want to know WHY ask
// GET /v1/me/provider/capabilities, which answers for their own account only.
@Injectable()
export class ProviderActiveGuard implements CanActivate {
  constructor(private readonly capabilities: ProviderCapabilityService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });

    // VIEW_MARKETPLACE is the capability these routes actually require: the
    // feed, bids, bookings, and earnings surfaces are all marketplace work.
    // Naming the capability rather than a status is what lets Sprint 9 move
    // the gate onto work-access grants without touching this file.
    const allowed = await this.capabilities.can(user.id, ProviderCapability.ViewMarketplace);
    if (!allowed) throw new ForbiddenException({ code: 'FORBIDDEN' });
    return true;
  }
}
