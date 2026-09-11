import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../../../infrastructure/persistence/persistence.module';
import { PrismaModule } from '../../../../infrastructure/prisma/prisma.module';
import { MARKET_LOCATION_RESOLVER_PORT } from './market-location-resolver.port';
import { MarketRegistryService } from './market-registry.service';
import { SupportedMarketsService } from './supported-markets.service';
import { UnavailableMarketLocationResolver } from './unavailable-market-location-resolver.adapter';

// Sprint 09B.29 Phase 5 — the market subsystem's production wiring.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1
//
// THE BINDING IS THE SAFETY PROPERTY
//
// `MARKET_LOCATION_RESOLVER_PORT` binds to `UnavailableMarketLocationResolver`
// and to nothing else. There is no environment variable that swaps in a
// deterministic fake, because the fake does not live in `src/` at all — the
// production build sets `rootDir: ./src`, so importing it from here would not
// trip a lint rule, it would fail to compile.
//
// That is the same shape as the evidence scanner, and for the same reason: a
// fake that CAN be reached is a fake that will be reached, and this one would
// fabricate a country, a timezone and a confidence for a real person.
//
// A real geocoding adapter, when a vendor is chosen, replaces the binding here
// and nowhere else — which is the whole point of the port.
//
// WHY THE ABSENCE OF A GEOCODER IS NOT AN OUTAGE
//
// Manual market selection is the canonical path and needs no resolver at all.
// Location suggestion is an optional enhancement layered on top, and
// `isAvailable` lets the client omit the control rather than offer one that
// always fails. Onboarding completes either way.

@Module({
  // PersistenceModule owns PlatformSettingRepository and is @Global, but it
  // needs Prisma itself — importing both is what lets this module compile
  // standalone in a test harness rather than only inside the whole app.
  imports: [PrismaModule, PersistenceModule],
  providers: [
    MarketRegistryService,
    SupportedMarketsService,
    {
      // Bound to the honest adapter. See the header for why there is no
      // conditional here and no way to reach a fake.
      provide: MARKET_LOCATION_RESOLVER_PORT,
      useClass: UnavailableMarketLocationResolver,
    },
  ],
  exports: [MarketRegistryService, SupportedMarketsService, MARKET_LOCATION_RESOLVER_PORT],
})
export class MarketModule {}
