import { Injectable, Logger } from '@nestjs/common';

import {
  LocationResolutionFailure,
  MarketLocationResolverPort,
  type MarketLocationInput,
  type MarketLocationResult,
} from './market-location-resolver.port';

// Sprint 09B.29 Phase 5 — what the port binds to when no geocoder is configured.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.3
//
// This repository ships no reverse-geocoding vendor: selecting one is an
// explicit product decision with cost, privacy and availability consequences,
// and it has not been made. So the honest production binding is an adapter that
// says so.
//
// WHY AN ADAPTER RATHER THAN AN ABSENT PROVIDER
//
// Leaving the token unbound would make every injection site optional and push
// the "is it there?" question into each of them, where one caller would
// eventually forget and crash. A bound adapter that always refuses gives the
// same guarantee in one place, and gives the UI something to ask.
//
// WHY IT REFUSES INSTEAD OF GUESSING
//
// The alternative — a coarse IP or locale guess — would be indistinguishable
// from an answer to everything downstream. The market precedence already
// classifies those as HINTS that can never be persisted, and manufacturing one
// here would smuggle a hint in wearing a resolver's clothes.
//
// ONBOARDING IS NOT BLOCKED BY THIS. Manual market selection is the canonical
// path and works with no resolver at all; location suggestion is an optional
// enhancement on top of it. `isAvailable` is what lets the client tell the
// difference and simply not offer a control that cannot work.

@Injectable()
export class UnavailableMarketLocationResolver extends MarketLocationResolverPort {
  private readonly log = new Logger(UnavailableMarketLocationResolver.name);

  /** No geocoder is configured. The read model surfaces this so the UI can
   *  omit "Use my location" rather than offering a control that always fails. */
  readonly isAvailable = false;

  /** Truthful in the other direction too: this is not a fake pretending to be
   *  real, it is a real adapter that has nothing to talk to. */
  readonly isRealResolver = true;

  async resolve(_input: MarketLocationInput): Promise<MarketLocationResult> {
    // Logged WITHOUT coordinates. A refusal is operationally interesting; a
    // provider's position is not ours to write down for it.
    this.log.debug({ msg: 'market.location.resolver.not_configured' });

    throw new LocationResolutionFailure(
      'NOT_CONFIGURED',
      'no reverse-geocoding resolver is configured; use manual market selection',
    );
  }
}
