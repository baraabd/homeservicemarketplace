import { Inject, Injectable } from '@nestjs/common';
import type {
  ProviderSupportedMarketsResponse,
  SupportedMarketView,
} from '@homeservicemarketplace/contracts';

import { ProviderProfileRepository } from '../../../../infrastructure/persistence/bids/provider-profile.repository';
import { PlatformSettingRepository } from '../../../../infrastructure/persistence/settings/platform-setting.repository';
import {
  RADIUS_MAX_SETTING,
  RADIUS_MIN_SETTING,
  RADIUS_SETTING_BY_MODE,
} from '../service-area/radius-policy';
import {
  MARKET_LOCATION_RESOLVER_PORT,
  MarketLocationResolverPort,
} from './market-location-resolver.port';
import { MarketRegistryService } from './market-registry.service';
import { decideTimezone } from './timezone-precedence.policy';
import type { SupportedMarket } from './supported-market';

// Sprint 09B.29 Phase 5 (C2) — the read model behind the market picker.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.8
//
// THE PROJECTION IS THE SECURITY BOUNDARY
//
// The registry row is operator configuration. This turns it into exactly what
// a provider needs to choose a market and understand the consequence, and
// nothing else: no disabled markets, no audit fields, no resolver
// configuration, no internal ids. A future field added to the setting is
// invisible here until somebody decides otherwise, which is the point.
//
// WHY THE RADIUS BOUNDS TRAVEL WITH THE MARKET
//
// Choosing a country decides how far a provider may travel, and a picker that
// cannot say so makes the decision look arbitrary. The numbers come from the
// same operator settings the write path validates against, so the screen and
// the server cannot disagree — and they are still enforced on every write,
// because a client is not a validator.

@Injectable()
export class SupportedMarketsService {
  constructor(
    private readonly registry: MarketRegistryService,
    private readonly settings: PlatformSettingRepository,
    private readonly profiles: ProviderProfileRepository,
    @Inject(MARKET_LOCATION_RESOLVER_PORT)
    private readonly locations: MarketLocationResolverPort,
  ) {}

  async list(userId: string): Promise<ProviderSupportedMarketsResponse> {
    const [markets, profile, minKm, maxKm, defaultKm] = await Promise.all([
      this.registry.enabled(),
      this.profiles.findByUserId(userId),
      this.numberSetting(RADIUS_MIN_SETTING),
      this.numberSetting(RADIUS_MAX_SETTING),
      // The on-foot number is the starting suggestion for a provider who has
      // not said how they travel — the most conservative one, and the same
      // choice `resolveRadiusPolicy` makes for the same reason.
      this.numberSetting(RADIUS_SETTING_BY_MODE.ON_FOOT),
    ]);

    return {
      markets: markets.map((m) => this.toView(m, { minKm, maxKm, defaultKm })),
      // Reported even when the market is no longer enabled, so the UI can say
      // "we have withdrawn from your market" rather than silently showing an
      // empty selection.
      selectedCountryCode: profile?.serviceAreaCountryCode ?? null,
      // A deployment fact the browser cannot discover for itself.
      locationSuggestionAvailable: this.locations.isAvailable,
    };
  }

  private toView(
    market: SupportedMarket,
    radius: { minKm: number; maxKm: number; defaultKm: number },
  ): SupportedMarketView {
    // The SAME policy the Working Hours step will apply, called with only the
    // market — so the picker's promise and the later decision cannot diverge.
    const timezone = decideTimezone({ market });

    return {
      countryCode: market.countryCode,
      displayNameKey: market.displayNameKey,
      radius: {
        minKm: radius.minKm,
        maxKm: radius.maxKm,
        // Clamped for the same reason the policy clamps: an operator may set a
        // per-mode suggestion outside the floor and ceiling, and offering a
        // number the provider is not allowed to keep is worse than offering a
        // conservative one.
        defaultKm: Math.min(Math.max(radius.defaultKm, radius.minKm), radius.maxKm),
      },
      timezone:
        timezone.kind === 'RESOLVED'
          ? { kind: 'RESOLVED', id: timezone.timezone }
          : { kind: 'ASK' },
    };
  }

  private async numberSetting(key: string): Promise<number> {
    const row = await this.settings.findByKey(key);
    return typeof row?.value === 'number' && Number.isFinite(row.value) ? row.value : 0;
  }
}
