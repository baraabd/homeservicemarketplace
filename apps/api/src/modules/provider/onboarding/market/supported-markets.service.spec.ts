import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';

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

describe('supported-market radius agrees with the write policy', () => {
  const defaults = (key: string): number =>
    ADMIN_SETTINGS_SCHEMA.find((field) => field.key === key)?.default as number;

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
        : defaults(key);
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
