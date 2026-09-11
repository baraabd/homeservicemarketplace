import { Injectable } from '@nestjs/common';

import {
  areValidCoordinates,
  LocationResolutionFailure,
  MarketLocationResolverPort,
  type MarketLocationInput,
  type MarketLocationResult,
} from './market-location-resolver.port';

// Sprint 09B.29 Phase 5 — the deterministic resolver every test uses.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// The decision forbids canonical tests from reaching an external geocoder, and
// this is what makes that easy rather than a discipline nobody keeps: the fake
// is the DEFAULT binding, and a production adapter has to be wired
// deliberately. A test that forgot to inject a double therefore gets
// determinism, not a network call.
//
// WHY BOUNDING BOXES AND NOT A GEOCODER
//
// A box per market is wrong at borders and completely right for a test: it is
// deterministic, it needs no data file, and it makes "Damascus resolves to SY"
// a statement someone can read and check. The boxes are deliberately coarse and
// this class is deliberately not exported as a production answer — see
// `isRealResolver`.
//
// NOT SUITABLE FOR PRODUCTION, and it says so in a way code can check: the
// service that persists a resolved country can refuse to trust a resolver that
// admits it is a fake, exactly as the evidence scanner refuses to mark a file
// CLEAN on a test adapter.

interface Box {
  readonly countryCode: string;
  readonly timezone: string;
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

/** The three markets the decision names, plus one neighbour so an
 *  "unsupported market" case has somewhere real to stand. */
const BOXES: readonly Box[] = Object.freeze([
  // Syria — Damascus is 33.51, 36.29.
  {
    countryCode: 'SY',
    timezone: 'Asia/Damascus',
    minLat: 32.3,
    maxLat: 37.3,
    minLng: 35.7,
    maxLng: 42.4,
  },
  // Sweden — Stockholm is 59.33, 18.07. A DST market.
  {
    countryCode: 'SE',
    timezone: 'Europe/Stockholm',
    minLat: 55.3,
    maxLat: 69.1,
    minLng: 11.0,
    maxLng: 24.2,
  },
  // Saudi Arabia — Riyadh is 24.71, 46.68.
  {
    countryCode: 'SA',
    timezone: 'Asia/Riyadh',
    minLat: 16.3,
    maxLat: 32.2,
    minLng: 34.5,
    maxLng: 55.7,
  },
  // Great Britain — London is 51.51, -0.13. Present so a test can resolve a
  // real country the operator has NOT enabled, which is a different case from
  // resolving nothing.
  {
    countryCode: 'GB',
    timezone: 'Europe/London',
    minLat: 49.9,
    maxLat: 58.7,
    minLng: -8.2,
    maxLng: 1.8,
  },
]);

/**
 * Accuracy at which a fix stops being a country answer.
 *
 * 50 km is wider than the distance from Damascus to the Lebanese border, so a
 * fix that vague genuinely cannot name a country and must not pretend to.
 */
export const LOW_CONFIDENCE_ACCURACY_METERS = 50_000;

@Injectable()
export class FakeMarketLocationResolver extends MarketLocationResolverPort {
  /** Declared so a persistence path can refuse to trust it, the same way
   *  `EvidenceScanService` refuses to write CLEAN on a test scanner. */
  readonly isRealResolver = false;

  async resolve(input: MarketLocationInput): Promise<MarketLocationResult> {
    if (!areValidCoordinates(input)) {
      // Rejected before any lookup: a malformed or hostile payload must cost a
      // validation branch rather than a vendor call.
      throw new LocationResolutionFailure(
        'INVALID_COORDINATES',
        'latitude must be within [-90, 90] and longitude within [-180, 180]',
      );
    }

    const box = BOXES.find(
      (b) =>
        input.latitude >= b.minLat &&
        input.latitude <= b.maxLat &&
        input.longitude >= b.minLng &&
        input.longitude <= b.maxLng,
    );

    if (!box) {
      // The middle of an ocean is a valid coordinate and not a country.
      throw new LocationResolutionFailure(
        'UNRESOLVED',
        'no country could be resolved from those coordinates',
      );
    }

    const vague =
      typeof input.accuracyMeters === 'number' &&
      input.accuracyMeters >= LOW_CONFIDENCE_ACCURACY_METERS;

    return {
      countryCode: box.countryCode,
      timezone: box.timezone,
      // A vague fix still names a country, but says how much to trust it. The
      // UI shows a LOW answer as a question rather than a statement.
      confidence: vague ? 'LOW' : 'HIGH',
    };
  }
}
