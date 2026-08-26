import { SetMetadata } from '@nestjs/common';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

// Sprint 9B.8 — a route says which capability it needs, in one place.
//
// docs/adr/0006-provider-capability-service.md
// docs/sprint-09b8/ROUTE_CAPABILITY_MATRIX.md
//
// Before this, every provider route family mounted `ProviderActiveGuard`, and
// that guard asked for exactly one capability — VIEW_MARKETPLACE — whatever
// the route did. Bidding, managing an accepted booking, reading earnings and
// messaging a seeker were all gated on the same answer.
//
// That was not merely coarse, it inverted a rule the capability service states
// deliberately. Rank 4 (RESTRICTED) grants MANAGE_BOOKINGS and VIEW_EARNINGS
// while withholding VIEW_MARKETPLACE, with the comment "Bookings already
// accepted are obligations to a seeker. Cutting them off punishes the customer
// for the provider's restriction." The route asked the wrong question, so the
// customer was punished anyway.
//
// The decorator is the fix: the capability is declared where the route is
// declared, next to what the route actually does.

export const REQUIRED_PROVIDER_CAPABILITY = 'provider:required-capability';

/**
 * Declare the capability a route (or a whole controller) requires.
 *
 * Handler-level wins over controller-level, so a controller can state the rule
 * for most of its routes and one route can differ — which is the common shape:
 * a bookings controller is MANAGE_BOOKINGS throughout, a profile controller
 * reads with VIEW_OWN_PROFILE and writes with EDIT_OWN_PROFILE.
 */
export const RequireCapability = (capability: ProviderCapability) =>
  SetMetadata(REQUIRED_PROVIDER_CAPABILITY, capability);
