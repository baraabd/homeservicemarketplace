import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Sprint 5.1.2 — marketplace gate.
//
// `RolesGuard('provider')` answers "may this user reach the Provider
// app at all?". Once the marketplace endpoints land (Sprint 5.2:
// available-requests feed, submit-bid, my-bids), they need an
// additional check: the provider's profile must be approved
// (`status === ACTIVE`). DRAFT and PENDING_REVIEW providers can sign
// in and finish onboarding; SUSPENDED and REJECTED providers can sign
// in to see the locked-state surface; none of them may bid.
//
// This guard is shipped now so the rule has a single owner and a test
// suite. It is NOT mounted on any route yet — that wiring belongs to
// the marketplace slice. Mounting it on a route also requires the
// caller to use `RolesGuard('provider')` first, since this guard
// assumes a session and queries by userId.
@Injectable()
export class ProviderActiveGuard implements CanActivate {
  constructor(private readonly providers: ProviderProfileRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });
    const profile = await this.providers.findByUserId(user.id);
    // Missing profile rejects with the same shape RolesGuard uses, so
    // the wire envelope is consistent and the client cannot probe the
    // existence of a profile separately from the active check.
    if (!profile) throw new ForbiddenException({ code: 'FORBIDDEN' });
    if (profile.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}
