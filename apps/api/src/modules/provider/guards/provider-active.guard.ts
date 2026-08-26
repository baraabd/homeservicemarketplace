import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ProviderCapabilityService } from '../capability/provider-capability.service';
import { ProviderCapabilityGuard } from './provider-capability.guard';

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
// Sprint 9B.8 — this is now the VIEW_MARKETPLACE specialisation of
// ProviderCapabilityGuard, and nothing more.
//
// The Sprint 7 comment above said VIEW_MARKETPLACE is "the capability these
// routes actually require: the feed, bids, bookings, and earnings surfaces are
// all marketplace work." That was true of the feed and wrong of the rest, and
// the audit found the cost: rank 4 (RESTRICTED) deliberately grants
// MANAGE_BOOKINGS and VIEW_EARNINGS while withholding VIEW_MARKETPLACE, so a
// restricted provider was locked out of bookings the capability service had
// explicitly decided they should keep — punishing the seeker on the other end
// of an accepted job, which is the exact outcome rank 4's comment says it
// exists to avoid.
//
// Routes now declare their capability with @RequireCapability. This subclass
// survives for the surfaces where VIEW_MARKETPLACE really is the right
// question — the job feed and the available-requests list — and because it
// inherits canActivate, a @RequireCapability on a route it guards still wins.
@Injectable()
export class ProviderActiveGuard extends ProviderCapabilityGuard {
  // An explicit constructor, not an inherited one: TypeScript emits
  // design:paramtypes only where a constructor is declared, and Nest resolves
  // dependencies from that metadata. A subclass with no constructor fails to
  // inject at runtime while typechecking perfectly.
  constructor(capabilities: ProviderCapabilityService, reflector: Reflector) {
    super(capabilities, reflector);
  }
}
