import { FakeMarketLocationResolver } from '../../../../../test/support/fake-market-location-resolver';
import { LocationResolutionFailure, areValidCoordinates } from './market-location-resolver.port';
import { MarketRegistryService } from './market-registry.service';
import { SUPPORTED_MARKETS_SETTING } from './supported-market';
import type { AppError } from '../../../../shared/errors/app-error';

// Sprint 09B.29 Phase 5 — reading the registry, and resolving a fix into a
// market, at the seam where both meet the rest of the application.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5

const THREE = [
  {
    countryCode: 'SY',
    enabled: true,
    displayNameKey: 'market.SY',
    defaultTimezone: 'Asia/Damascus',
  },
  {
    countryCode: 'SE',
    enabled: true,
    displayNameKey: 'market.SE',
    defaultTimezone: 'Europe/Stockholm',
  },
  { countryCode: 'AQ', enabled: false, displayNameKey: 'market.AQ' },
];

function service(value: unknown, present = true) {
  const findByKey = jest.fn(async (key: string) =>
    present && key === SUPPORTED_MARKETS_SETTING
      ? { key, value, updatedAt: new Date(), updatedBy: null }
      : null,
  );
  return {
    svc: new MarketRegistryService({ findByKey } as never),
    findByKey,
  };
}

/** Capture the AppError a misconfiguration produces, with its stable reason. */
async function misconfiguration(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected the registry read to fail, but it succeeded');
}

describe('MarketRegistryService', () => {
  it('reads the operator’s markets from the audited setting', async () => {
    const { svc, findByKey } = service(THREE);

    expect((await svc.all()).map((m) => m.countryCode)).toEqual(['SY', 'SE', 'AQ']);
    // The audited PlatformSetting mechanism, not a new table and not an env var.
    expect(findByKey).toHaveBeenCalledWith(SUPPORTED_MARKETS_SETTING, undefined);
  });

  it('offers only the ENABLED markets for selection', async () => {
    const { svc } = service(THREE);

    expect((await svc.enabled()).map((m) => m.countryCode)).toEqual(['SY', 'SE']);
    expect(await svc.findEnabled('AQ')).toBeNull();
    expect((await svc.findEnabled('se'))?.countryCode).toBe('SE');
  });

  it('fails with a CONFIGURATION reason when the setting is absent', async () => {
    // Nobody has configured this platform. It is not the provider's fault and
    // there is nothing they can do, so it is a 500 with a stable reason rather
    // than a 400 that blames the request or a 404 that implies non-existence.
    const { svc } = service(null, false);
    const err = await misconfiguration(() => svc.all());

    expect(err.status).toBe(500);
    expect((err.details as { reason: string }).reason).toBe('MARKET_REGISTRY_MISSING');
  });

  it('fails with the parser’s reason when the setting is malformed', async () => {
    const cases: [unknown, string][] = [
      [[], 'MARKET_REGISTRY_EMPTY'],
      [
        [{ countryCode: 'ZZ', enabled: true, displayNameKey: 'x' }],
        'MARKET_REGISTRY_INVALID_COUNTRY_CODE',
      ],
      [
        [{ countryCode: 'SY', enabled: false, displayNameKey: 'x' }],
        'MARKET_REGISTRY_NO_ENABLED_MARKET',
      ],
      ['not-an-array', 'MARKET_REGISTRY_NOT_AN_ARRAY'],
    ];

    for (const [value, reason] of cases) {
      const { svc } = service(value);
      const err = await misconfiguration(() => svc.all());
      expect((err.details as { reason: string }).reason).toBe(reason);
    }
  });

  it('never leaks the operator’s configuration detail to the caller', async () => {
    // An operator needs `market at index 0 has countryCode "ZZ"`; a provider
    // needs "this is not something you can fix". The detail goes to the log.
    const { svc } = service([{ countryCode: 'ZZ', enabled: true, displayNameKey: 'x' }]);
    const err = await misconfiguration(() => svc.all());

    expect(err.message).not.toContain('ZZ');
    expect(err.message).not.toContain('index');
    expect(err.message).not.toContain(SUPPORTED_MARKETS_SETTING);
  });

  it('does NOT cache, so disabling a market takes effect at once', async () => {
    // A cache here would mean an operator withdrawing from a market watched it
    // keep working for an unpredictable interval — the one behaviour a
    // withdrawal must not have.
    const { svc, findByKey } = service(THREE);

    await svc.enabled();
    await svc.enabled();

    expect(findByKey).toHaveBeenCalledTimes(2);
  });
});

describe('coordinate validation', () => {
  it('accepts real coordinates and refuses everything else', () => {
    expect(areValidCoordinates({ latitude: 33.51, longitude: 36.29 })).toBe(true);
    expect(areValidCoordinates({ latitude: -90, longitude: 180 })).toBe(true);

    const bad: { latitude: unknown; longitude: unknown }[] = [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: -91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      // NaN and the infinities pass a naive >= / <= pair, which is the reason
      // `Number.isFinite` is in there.
      { latitude: Number.NaN, longitude: 0 },
      { latitude: Number.POSITIVE_INFINITY, longitude: 0 },
      { latitude: '33.51', longitude: '36.29' },
      { latitude: null, longitude: null },
    ];
    expect(bad.map(areValidCoordinates)).toEqual(bad.map(() => false));
  });
});

describe('the deterministic resolver used by every canonical test', () => {
  const resolver = new FakeMarketLocationResolver();

  it('declares itself a fake, so a persistence path can refuse to trust it', () => {
    // The same guard `EvidenceScanService` applies to a test scanner: an
    // adapter that admits it is not real must not be able to produce a
    // persisted fact.
    expect(resolver.isRealResolver).toBe(false);
  });

  it.each([
    ['Damascus', 33.51, 36.29, 'SY', 'Asia/Damascus'],
    ['Stockholm', 59.33, 18.07, 'SE', 'Europe/Stockholm'],
    ['Riyadh', 24.71, 46.68, 'SA', 'Asia/Riyadh'],
    ['London', 51.51, -0.13, 'GB', 'Europe/London'],
  ])('resolves %s to %s', async (_city, latitude, longitude, country, timezone) => {
    await expect(resolver.resolve({ latitude, longitude })).resolves.toEqual({
      countryCode: country,
      timezone,
      confidence: 'HIGH',
    });
  });

  it('lowers its confidence when the fix is too vague to name a country', async () => {
    // 50 km is wider than the distance from Damascus to the Lebanese border.
    const result = await resolver.resolve({
      latitude: 33.51,
      longitude: 36.29,
      accuracyMeters: 60_000,
    });

    expect(result).toMatchObject({ countryCode: 'SY', confidence: 'LOW' });
  });

  it('refuses invalid coordinates BEFORE any lookup', async () => {
    await expect(resolver.resolve({ latitude: 999, longitude: 0 })).rejects.toMatchObject({
      reason: 'INVALID_COORDINATES',
    });
  });

  it('reports UNRESOLVED for a valid coordinate that is not in a country', async () => {
    // The middle of the South Atlantic. A valid fix, and not a market.
    await expect(resolver.resolve({ latitude: -40, longitude: -20 })).rejects.toBeInstanceOf(
      LocationResolutionFailure,
    );
  });

  it('resolves a real country the operator has not enabled', async () => {
    // GB resolves fine; the REGISTRY is what refuses it. Keeping those two
    // steps separate is what lets the UI say "we do not operate there yet"
    // rather than "we could not find you".
    await expect(resolver.resolve({ latitude: 51.51, longitude: -0.13 })).resolves.toMatchObject({
      countryCode: 'GB',
    });
  });
});
