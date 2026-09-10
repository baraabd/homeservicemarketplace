import * as marketModule from './supported-market';
import {
  MarketRegistryError,
  SUPPORTED_MARKETS_SETTING,
  enabledMarkets,
  findEnabledMarket,
  isValidCountryCode,
  isValidTimezone,
  parseSupportedMarkets,
  type SupportedMarket,
} from './supported-market';

// Sprint 09B.29 Phase 5 — the supported-market registry, one case per rule.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// This is the module that replaces "any two uppercase letters is a country".
// The properties under test are configuration-safety properties: an operator
// mistake must be loud, and there must be NO path by which a country the
// operator never enabled becomes a provider's market.
//
// The three markets used throughout are SY, SE and SA, because the decision
// names them and the repository's own demo data already spans them — and
// because they exercise three different timezone situations: a non-DST zone, a
// DST zone, and a second non-DST zone in a different region.

const market = (over: Partial<SupportedMarket> = {}): SupportedMarket => ({
  countryCode: 'SY',
  enabled: true,
  displayNameKey: 'market.SY',
  defaultTimezone: 'Asia/Damascus',
  ...over,
});

const THREE = [
  market(),
  market({ countryCode: 'SE', displayNameKey: 'market.SE', defaultTimezone: 'Europe/Stockholm' }),
  market({ countryCode: 'SA', displayNameKey: 'market.SA', defaultTimezone: 'Asia/Riyadh' }),
];

/** Assert the thrown error and its stable code, not just that it threw. */
function refusal(fn: () => unknown): MarketRegistryError {
  try {
    fn();
  } catch (err) {
    if (err instanceof MarketRegistryError) return err;
    throw err;
  }
  throw new Error('expected the registry to be refused, but it was accepted');
}

describe('country and timezone validity', () => {
  it('accepts the assigned ISO codes and refuses the unassigned ones', () => {
    // Mapped rather than looped with a per-case message: Jest's `expect` takes
    // no message argument, and comparing the whole mapping makes a failure name
    // the offending code by itself.
    const assigned = ['SY', 'SE', 'SA', 'AQ', 'GB'];
    expect(assigned.map(isValidCountryCode)).toEqual(assigned.map(() => true));

    // ZZ and XX are user-assigned/unassigned; they are the exact values the
    // old `/^[A-Z]{2}$/` check let through.
    const rejected = ['ZZ', 'XX', 'QQ', 'S', 'SYR', '', '12'];
    expect(rejected.map(isValidCountryCode)).toEqual(rejected.map(() => false));
  });

  it('requires the canonical uppercase form', () => {
    // Canonicalisation is the CALLER's job (`findEnabledMarket` does it). A
    // stored registry carrying `sy` is a config mistake, and accepting it here
    // would mean two spellings of one market could both be stored.
    expect(isValidCountryCode('sy')).toBe(false);
    expect(isValidCountryCode('Sy')).toBe(false);
  });

  it('validates timezones against the runtime IANA database', () => {
    const real = ['Asia/Damascus', 'Europe/Stockholm', 'Asia/Riyadh'];
    expect(real.map(isValidTimezone)).toEqual(real.map(() => true));

    // 'GMT+3' is a POSIX-style offset, not an IANA zone, and a trailing space
    // is the kind of thing a hand-edited JSON blob carries.
    const fake: unknown[] = ['Not/AZone', 'GMT+3', 'Asia/Damascus ', '', null, 42];
    expect(fake.map(isValidTimezone)).toEqual(fake.map(() => false));
  });

  it('refuses UTC and the Etc/* aliases as a MARKET default', () => {
    // Not an oversight. `Intl.supportedValuesOf('timeZone')` returns only
    // canonical GEOGRAPHIC zones, and a market's default timezone describes a
    // place where providers work — "UTC" is not one. A market configured with
    // UTC would silently shift every working-hours window a provider entered.
    //
    // Asserted rather than left implicit, because the behaviour comes from the
    // runtime rather than from code in this repository, and a future Node
    // could change it.
    expect(isValidTimezone('UTC')).toBe(false);
    expect(isValidTimezone('Etc/UTC')).toBe(false);
    expect(isValidTimezone('Etc/GMT+3')).toBe(false);
  });
});

describe('parsing a stored registry', () => {
  it('accepts a multi-country registry and freezes it', () => {
    const parsed = parseSupportedMarkets(THREE);

    expect(parsed.map((m) => m.countryCode)).toEqual(['SY', 'SE', 'SA']);
    expect(Object.isFrozen(parsed[0])).toBe(true);
  });

  it('keeps a market with no default timezone, rather than inventing one', () => {
    // A country spanning several zones must NOT carry a default: the timezone
    // precedence requires it to ask the provider instead, and a default here
    // would be indistinguishable from an answer.
    const parsed = parseSupportedMarkets([market({ defaultTimezone: undefined })]);

    expect(parsed[0].defaultTimezone).toBeUndefined();
    expect('defaultTimezone' in parsed[0]).toBe(false);
  });

  it('REFUSES an empty registry rather than falling back to a country', () => {
    // The decision is explicit: an empty registry fails safely and never
    // silently invents a market. This is the assertion that keeps that true.
    expect(refusal(() => parseSupportedMarkets([])).code).toBe('EMPTY');
  });

  it('REFUSES a registry where every market is disabled', () => {
    // Structurally valid and operationally useless: onboarding would have
    // nowhere to send a provider, and the failure would surface as a confusing
    // empty picker rather than a configuration error.
    const off = THREE.map((m) => ({ ...m, enabled: false }));

    expect(refusal(() => parseSupportedMarkets(off)).code).toBe('NO_ENABLED_MARKET');
  });

  it('REFUSES a country code that is not a country', () => {
    expect(refusal(() => parseSupportedMarkets([market({ countryCode: 'ZZ' })])).code).toBe(
      'INVALID_COUNTRY_CODE',
    );
  });

  it('REFUSES a duplicated market, because the registry would be ambiguous', () => {
    const dupe = [market(), market({ displayNameKey: 'market.SY.again' })];

    expect(refusal(() => parseSupportedMarkets(dupe)).code).toBe('DUPLICATE_COUNTRY_CODE');
  });

  it('REFUSES a timezone that is not an IANA identifier', () => {
    const bad = [market({ defaultTimezone: 'GMT+3' })];

    expect(refusal(() => parseSupportedMarkets(bad)).code).toBe('INVALID_TIMEZONE');
  });

  it('REFUSES a missing or non-boolean enabled flag', () => {
    const missing = [{ countryCode: 'SY', displayNameKey: 'market.SY' }];
    const truthy = [{ countryCode: 'SY', displayNameKey: 'market.SY', enabled: 'yes' }];

    expect(refusal(() => parseSupportedMarkets(missing)).code).toBe('INVALID_ENABLED');
    // 'yes' is truthy, so a loose check would enable this market by accident.
    expect(refusal(() => parseSupportedMarkets(truthy)).code).toBe('INVALID_ENABLED');
  });

  it('REFUSES a market with no localisation key', () => {
    const blank = [market({ displayNameKey: '   ' })];

    expect(refusal(() => parseSupportedMarkets(blank)).code).toBe('INVALID_DISPLAY_NAME_KEY');
  });

  it('REFUSES anything that is not an array of objects', () => {
    expect(refusal(() => parseSupportedMarkets(null)).code).toBe('NOT_AN_ARRAY');
    expect(refusal(() => parseSupportedMarkets({ SY: true })).code).toBe('NOT_AN_ARRAY');
    expect(refusal(() => parseSupportedMarkets(['SY'])).code).toBe('NOT_AN_OBJECT');
  });

  it('names the setting key in its complaints, so an operator can find it', () => {
    expect(refusal(() => parseSupportedMarkets([])).message).toContain(SUPPORTED_MARKETS_SETTING);
  });

  it('drops one bad row by refusing the WHOLE registry', () => {
    // Not a style preference. Dropping the bad row would leave the operator
    // believing a market is live when it is not, and nothing would say so.
    const mixed = [market(), market({ countryCode: 'ZZ' })];

    expect(() => parseSupportedMarkets(mixed)).toThrow(MarketRegistryError);
  });
});

describe('looking a market up', () => {
  const parsed = parseSupportedMarkets([
    ...THREE,
    market({
      countryCode: 'AQ',
      enabled: false,
      displayNameKey: 'market.AQ',
      defaultTimezone: undefined,
    }),
  ]);

  it('returns the enabled market for a code, in any spelling', () => {
    // The code arrives from a request body, a cookie and a geocoder — three
    // sources with three conventions. All must resolve to one row or none.
    const spellings = ['SE', 'se', ' Se ', 'sE'];
    expect(spellings.map((s) => findEnabledMarket(parsed, s)?.countryCode)).toEqual(
      spellings.map(() => 'SE'),
    );
  });

  it('answers null for a configured but DISABLED market', () => {
    // "Configured but off" and "never heard of it" are the same answer to the
    // question the caller is actually asking.
    expect(findEnabledMarket(parsed, 'AQ')).toBeNull();
  });

  it('answers null for an unknown or malformed code', () => {
    // GB is a real country that is simply not configured; the rest are junk.
    // Both must answer the same way, so a caller cannot distinguish "not a
    // market" from "not a country" and branch on it.
    const codes: unknown[] = ['GB', 'ZZ', '', null, undefined, 42, {}];
    expect(codes.map((c) => findEnabledMarket(parsed, c))).toEqual(codes.map(() => null));
  });

  it('lists the enabled markets in the operator’s own order', () => {
    // Not alphabetical: the server cannot localise a country name, so the only
    // ordering it can honour is the one the operator configured.
    expect(enabledMarkets(parsed).map((m) => m.countryCode)).toEqual(['SY', 'SE', 'SA']);
  });

  it('is the ONLY way a country becomes a market — there is no default', () => {
    // The module exports no fallback country and no "primary market". A caller
    // that wants one has to add it, and this assertion is what makes that
    // visible in review rather than discovered in production.
    const exported = Object.keys(marketModule);

    expect(exported).not.toContain('DEFAULT_MARKET');
    expect(exported).not.toContain('DEFAULT_COUNTRY_CODE');
    expect(exported).not.toContain('FALLBACK_MARKET');
    expect(exported).not.toContain('PRIMARY_MARKET');
  });
});
