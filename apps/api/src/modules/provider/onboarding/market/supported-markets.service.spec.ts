import { ADMIN_SETTINGS_SCHEMA, settingDefault } from '@homeservicemarketplace/contracts';

import { ProviderProfileRepository } from '../../../../infrastructure/persistence/bids/provider-profile.repository';
import { PlatformSettingRepository } from '../../../../infrastructure/persistence/settings/platform-setting.repository';
import {
  checkRadius,
  resolveRadiusPolicy,
  RADIUS_MAX_SETTING,
  RADIUS_MIN_SETTING,
  RADIUS_SETTING_BY_MODE,
} from '../service-area/radius-policy';
import { MarketLocationResolverPort } from './market-location-resolver.port';
import { MarketRegistryService } from './market-registry.service';
import { SupportedMarketsService } from './supported-markets.service';
import type { SupportedMarket } from './supported-market';
import { checkTimezoneAgainstMarket } from './timezone-precedence.policy';

// Sprint 09B.29 Phase 5 — the market picker's read model.
//
// WHY THIS SPEC EXISTS
//
// On the developer database this service answered `radius: {minKm: 0, maxKm: 0,
// defaultKm: 0}` for every market, because none of the radius settings had a row
// and its fallback was a literal zero — while the LOCATION write path, falling
// back to the admin schema, went on enforcing 1–100 km. The picker drew a slider
// the provider could not move and the server accepted values it never offered.
//
// The defect was invisible to every existing test: the registry spec covers the
// registry, the radius-policy spec covers the write path, and nothing asserted
// that the two agree about what an ABSENT row means. That is what is pinned here.
//
// TWO INVARIANTS, ASSERTED SEPARATELY
//
// The first block pins the read model against the admin schema directly — the
// numbers a provider is actually offered. The second pins the stronger property:
// what the picker OFFERS is exactly what `resolveRadiusPolicy` ACCEPTS, so the
// two cannot drift apart even if the schema moves underneath both. Losing either
// block leaves a way for the screen and the server to disagree again.

/** The schema's own numbers, read the way the service and the writer read them. */
const schemaNumber = (key: string): number => {
  const value = settingDefault(key);
  if (typeof value !== 'number') throw new Error(`${key} is not an integer setting`);
  return value;
};

describe('SupportedMarketsService radius bounds', () => {
  const MARKETS: SupportedMarket[] = [
    {
      countryCode: 'SY',
      enabled: true,
      displayNameKey: 'market.SY',
      defaultTimezone: 'Asia/Damascus',
    },
    {
      countryCode: 'CA',
      enabled: true,
      displayNameKey: 'market.CA',
      timezones: ['America/Toronto', 'America/Vancouver'],
    },
  ];

  /** The service with an EMPTY settings table — the state the bug needed. */
  function service(rows: Record<string, unknown> = {}, profileCountry: string | null = null) {
    const findByKey = jest.fn(async (key: string) =>
      key in rows
        ? { key, value: rows[key] as never, updatedAt: new Date(), updatedBy: null }
        : null,
    );
    const svc = new SupportedMarketsService(
      { enabled: async () => MARKETS } as never,
      { findByKey } as never,
      { findByUserId: async () => ({ serviceAreaCountryCode: profileCountry }) } as never,
      { isAvailable: false } as never,
    );
    return { svc, findByKey };
  }

  it('falls back to the admin schema, not to zero, when no row is set', async () => {
    const { svc } = service();

    const { markets } = await svc.list('user-1');

    for (const market of markets) {
      expect(market.radius).toEqual({
        minKm: schemaNumber(RADIUS_MIN_SETTING),
        maxKm: schemaNumber(RADIUS_MAX_SETTING),
        defaultKm: schemaNumber(RADIUS_SETTING_BY_MODE.ON_FOOT),
      });
    }
  });

  it('never advertises a range the provider cannot move', async () => {
    const { markets } = await service().svc.list('user-1');

    for (const market of markets) {
      expect(market.radius.minKm).toBeGreaterThan(0);
      expect(market.radius.maxKm).toBeGreaterThan(market.radius.minKm);
      expect(market.radius.defaultKm).toBeGreaterThanOrEqual(market.radius.minKm);
      expect(market.radius.defaultKm).toBeLessThanOrEqual(market.radius.maxKm);
    }
  });

  it('prefers the operator row over the schema default', async () => {
    const { markets } = await service({
      [RADIUS_MIN_SETTING]: 2,
      [RADIUS_MAX_SETTING]: 40,
      [RADIUS_SETTING_BY_MODE.ON_FOOT]: 9,
    }).svc.list('user-1');

    expect(markets[0].radius).toEqual({ minKm: 2, maxKm: 40, defaultKm: 9 });
  });

  it('clamps an operator suggestion that sits outside their own bounds', async () => {
    const { markets } = await service({
      [RADIUS_MIN_SETTING]: 5,
      [RADIUS_MAX_SETTING]: 20,
      // An admin may edit the per-mode suggestion and the ceiling independently;
      // offering 99 km when 20 is the most they may keep is worse than offering 20.
      [RADIUS_SETTING_BY_MODE.ON_FOOT]: 99,
    }).svc.list('user-1');

    expect(markets[0].radius.defaultKm).toBe(20);
  });

  it('ignores a non-numeric row rather than serving it', async () => {
    const { markets } = await service({ [RADIUS_MIN_SETTING]: 'twelve' }).svc.list('user-1');

    expect(markets[0].radius.minKm).toBe(schemaNumber(RADIUS_MIN_SETTING));
  });

  it('every radius setting the picker reads is whitelisted in the admin schema', () => {
    // The fallback is only as good as the schema entry behind it. A key the
    // admin surface does not know about would silently collapse back to zero.
    const keys = [RADIUS_MIN_SETTING, RADIUS_MAX_SETTING, ...Object.values(RADIUS_SETTING_BY_MODE)];

    for (const key of keys) {
      const field = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key);
      // Compared against itself so a miss names WHICH setting the admin
      // surface does not know about, rather than failing on a bare undefined.
      expect(field ? key : `${key} (not admin-editable)`).toBe(key);
      expect(typeof field?.default).toBe('number');
    }
  });

  it('reports the stored country even when the platform has withdrawn from it', async () => {
    // The correction path: a provider sitting in a market that is no longer
    // enabled has to be TOLD, not shown an empty selection.
    const { selectedCountryCode, markets } = await service({}, 'IQ').svc.list('user-1');

    expect(selectedCountryCode).toBe('IQ');
    expect(markets.map((m) => m.countryCode)).not.toContain('IQ');
  });
});

describe('supported-market radius agrees with the write policy', () => {
  function harness(values: Record<string, unknown>) {
    const settings = {
      findByKey: jest.fn(async (key: string) =>
        key in values ? { key, value: values[key] } : null,
      ),
    };
    const service = new SupportedMarketsService(
      {
        enabled: async () => [
          {
            countryCode: 'SY',
            enabled: true,
            displayNameKey: 'countries.SY',
            defaultTimezone: 'Asia/Damascus',
          },
        ],
      } as unknown as MarketRegistryService,
      settings as unknown as PlatformSettingRepository,
      { findByUserId: async () => null } as unknown as ProviderProfileRepository,
      { isAvailable: false } as MarketLocationResolverPort,
    );
    // This is the writer's setting precedence: stored finite number, then
    // the shared admin schema default. Do not invent a UI radius fallback.
    const read = async (key: string) =>
      typeof values[key] === 'number' && Number.isFinite(values[key])
        ? (values[key] as number)
        : schemaNumber(key);
    return { service, read };
  }

  it.each([
    ['all radius rows absent', {}],
    ['only the floor configured', { [RADIUS_MIN_SETTING]: 5 }],
    ['invalid persisted numbers', { [RADIUS_MIN_SETTING]: null, [RADIUS_MAX_SETTING]: '100' }],
    [
      'operator overrides with an out-of-bounds suggestion',
      {
        [RADIUS_MIN_SETTING]: 2,
        [RADIUS_MAX_SETTING]: 20,
        [RADIUS_SETTING_BY_MODE.ON_FOOT]: 50,
      },
    ],
  ] as const)('%s', async (_name, values) => {
    const { service, read } = harness(values);
    const response = await service.list('provider-owner');
    const policy = await resolveRadiusPolicy(null, read);
    const offered = response.markets[0].radius;

    expect(offered).toEqual({
      minKm: policy.minKm,
      maxKm: policy.maxKm,
      defaultKm: policy.suggestedKm,
    });
    expect(checkRadius(offered.defaultKm, policy)).toEqual({ ok: true });
    expect(offered.defaultKm).toBeGreaterThanOrEqual(1);
  });
});

describe('supported-market timezone choices agree with the write policy', () => {
  const canada: SupportedMarket = {
    countryCode: 'CA',
    enabled: true,
    displayNameKey: 'CA',
    timezones: ['America/Vancouver', 'America/Toronto'],
  };

  function serviceFor(market: SupportedMarket) {
    return new SupportedMarketsService(
      { enabled: async () => [market] } as unknown as MarketRegistryService,
      { findByKey: async () => null } as unknown as PlatformSettingRepository,
      { findByUserId: async () => null } as unknown as ProviderProfileRepository,
      { isAvailable: false } as MarketLocationResolverPort,
    );
  }

  it('projects permitted choices for a multi-zone market without a default', async () => {
    const response = await serviceFor(canada).list('provider-owner');

    expect(response.markets[0].timezone).toEqual({
      kind: 'ASK',
      allowedIds: ['America/Vancouver', 'America/Toronto'],
    });
    for (const timezone of canada.timezones!) {
      expect(checkTimezoneAgainstMarket(timezone, canada)).toEqual({ kind: 'COMPATIBLE' });
    }
    expect(checkTimezoneAgainstMarket('Asia/Riyadh', canada).kind).toBe('NOT_IN_MARKET');
    expect(response.markets[0]).not.toHaveProperty('timezones');
    expect(response.markets[0]).not.toHaveProperty('enabled');
  });

  it('does not invent choices when the market has no declared zones', async () => {
    const response = await serviceFor({ ...canada, timezones: undefined }).list('provider-owner');
    expect(response.markets[0].timezone).toEqual({ kind: 'ASK', allowedIds: [] });
  });

  it('keeps the existing single-zone response shape', async () => {
    const response = await serviceFor({
      countryCode: 'SY',
      enabled: true,
      displayNameKey: 'SY',
      defaultTimezone: 'Asia/Damascus',
    }).list('provider-owner');
    expect(response.markets[0].timezone).toEqual({ kind: 'RESOLVED', id: 'Asia/Damascus' });
  });
});
