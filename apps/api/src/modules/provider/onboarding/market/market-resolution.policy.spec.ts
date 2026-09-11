import {
  persistableCountryCode,
  resolveMarket,
  type MarketResolutionInput,
} from './market-resolution.policy';
import { parseSupportedMarkets, type SupportedMarket } from './supported-market';

// Sprint 09B.29 Phase 5 — the market precedence, one case per rule.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// The properties here are security properties, not bookkeeping ones. The
// decision draws one line — between sources that may be PERSISTED and sources
// that may only be SUGGESTED — and every test below is about keeping something
// on the correct side of it.

const MARKETS: SupportedMarket[] = parseSupportedMarkets([
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
  { countryCode: 'SA', enabled: true, displayNameKey: 'market.SA', defaultTimezone: 'Asia/Riyadh' },
  { countryCode: 'AQ', enabled: false, displayNameKey: 'market.AQ' },
]);

const resolve = (over: Partial<MarketResolutionInput> = {}) =>
  resolveMarket({ markets: MARKETS, ...over });

describe('precedence among authoritative sources', () => {
  it('a persisted country wins over everything else', () => {
    // The provider already told us, and the answer is in the database. No
    // suggestion, cookie or fresh confirmation may quietly move them.
    const result = resolve({
      persistedCountryCode: 'SY',
      confirmedCountryCode: 'SE',
      resolvedAndConfirmedCountryCode: 'SA',
      cookieCountryCode: 'SE',
      hints: { ipCountryCode: 'SE' },
    });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'PERSISTED' });
    expect(persistableCountryCode(result)).toBe('SY');
  });

  it('an explicit confirmation wins over a resolved one and over the cookie', () => {
    const result = resolve({
      confirmedCountryCode: 'SE',
      resolvedAndConfirmedCountryCode: 'SA',
      cookieCountryCode: 'SY',
    });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'CONFIRMED' });
    expect(persistableCountryCode(result)).toBe('SE');
  });

  it('a confirmed geolocation result wins over the cookie', () => {
    const result = resolve({ resolvedAndConfirmedCountryCode: 'SA', cookieCountryCode: 'SY' });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'RESOLVED_AND_CONFIRMED' });
    expect(persistableCountryCode(result)).toBe('SA');
  });

  it('the cookie is authoritative only when nothing better exists', () => {
    const result = resolve({ cookieCountryCode: 'SE' });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'COOKIE' });
    expect(persistableCountryCode(result)).toBe('SE');
  });

  it('the cookie NEVER overrides authenticated database state', () => {
    // The decision states this in as many words, and it is the case a stolen
    // or stale cookie would exploit.
    const result = resolve({ persistedCountryCode: 'SY', cookieCountryCode: 'SE' });

    expect(persistableCountryCode(result)).toBe('SY');
  });
});

describe('hints may suggest and may never persist', () => {
  it.each([
    ['geolocationCountryCode', 'GEOLOCATION'],
    ['ipCountryCode', 'IP'],
    ['localeCountryCode', 'LOCALE'],
    ['browserTimezoneCountryCode', 'BROWSER_TIMEZONE'],
  ])('%s produces a SUGGESTION that cannot be written', (field, source) => {
    const result = resolve({ hints: { [field]: 'SE' } });

    expect(result).toMatchObject({ kind: 'SUGGESTED', source });
    // The whole point: a suggestion has no persistable value.
    expect(persistableCountryCode(result)).toBeNull();
  });

  it('an UNCONFIRMED geolocation fix is only a suggestion', () => {
    // "We think you are in Sweden" and "you are in Sweden" are different
    // claims, and only the confirmed one may be stored.
    const unconfirmed = resolve({ hints: { geolocationCountryCode: 'SE' } });
    const confirmed = resolve({ resolvedAndConfirmedCountryCode: 'SE' });

    expect(persistableCountryCode(unconfirmed)).toBeNull();
    expect(persistableCountryCode(confirmed)).toBe('SE');
  });

  it('ranks hints by confidence, geolocation first and browser timezone last', () => {
    const result = resolve({
      hints: {
        geolocationCountryCode: 'SE',
        ipCountryCode: 'SY',
        localeCountryCode: 'SA',
        browserTimezoneCountryCode: 'SY',
      },
    });

    expect(result).toMatchObject({ kind: 'SUGGESTED', source: 'GEOLOCATION' });
  });

  it('never lets a pile of hints add up to an authoritative answer', () => {
    // Four agreeing low-confidence signals are still four low-confidence
    // signals. There is no quorum rule, deliberately.
    const result = resolve({
      hints: {
        geolocationCountryCode: 'SE',
        ipCountryCode: 'SE',
        localeCountryCode: 'SE',
        browserTimezoneCountryCode: 'SE',
      },
    });

    expect(result.kind).toBe('SUGGESTED');
    expect(persistableCountryCode(result)).toBeNull();
  });

  it('an authoritative source outranks every hint', () => {
    const result = resolve({
      cookieCountryCode: 'SY',
      hints: { geolocationCountryCode: 'SE', ipCountryCode: 'SE' },
    });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'COOKIE' });
  });
});

describe('the enabled registry is checked at every level', () => {
  it('refuses a country the operator never configured, from any source', () => {
    // GB is a real country and is not in the registry. It must not become a
    // market however it arrives.
    for (const input of [
      { persistedCountryCode: 'GB' },
      { confirmedCountryCode: 'GB' },
      { resolvedAndConfirmedCountryCode: 'GB' },
      { cookieCountryCode: 'GB' },
      { hints: { geolocationCountryCode: 'GB' } },
    ]) {
      expect(resolve(input).kind).toBe('NONE');
    }
  });

  it('refuses a DISABLED market, including one that was persisted', () => {
    // The operator has withdrawn from AQ. Continuing to treat the stored value
    // as authoritative would quietly keep a provider working in a market the
    // platform no longer serves.
    expect(resolve({ persistedCountryCode: 'AQ' }).kind).toBe('NONE');
    expect(resolve({ cookieCountryCode: 'AQ' }).kind).toBe('NONE');
  });

  it('falls THROUGH a disabled persisted country to the next valid source', () => {
    // Not a hard failure: the provider gets asked again, and an explicit
    // confirmation for a market that IS enabled still works.
    const result = resolve({ persistedCountryCode: 'AQ', confirmedCountryCode: 'SE' });

    expect(result).toMatchObject({ kind: 'RESOLVED', source: 'CONFIRMED' });
  });

  it('refuses a code that is not a country at all', () => {
    expect(resolve({ confirmedCountryCode: 'ZZ' }).kind).toBe('NONE');
    expect(resolve({ confirmedCountryCode: '' }).kind).toBe('NONE');
    expect(resolve({ confirmedCountryCode: null }).kind).toBe('NONE');
  });

  it('canonicalises spelling from every source', () => {
    // A cookie writes uppercase, a geocoder may not, and a request body is
    // whatever the client sent.
    expect(persistableCountryCode(resolve({ confirmedCountryCode: 'se' }))).toBe('SE');
    expect(persistableCountryCode(resolve({ cookieCountryCode: ' sy ' }))).toBe('SY');
  });
});

describe('when nothing resolves', () => {
  it('answers NONE rather than inventing a market', () => {
    // The single most important assertion in this file. There is no default
    // country anywhere in the policy, so a provider with no signal is ASKED.
    expect(resolve()).toEqual({ kind: 'NONE' });
    expect(persistableCountryCode(resolve())).toBeNull();
  });

  it('answers NONE even when the registry has exactly one enabled market', () => {
    // The tempting shortcut — "there is only one market, so use it" — is
    // exactly the single-country assumption this phase exists to remove. A
    // one-market operator today is a two-market operator later, and code that
    // guessed would silently keep guessing.
    const single = parseSupportedMarkets([
      { countryCode: 'SY', enabled: true, displayNameKey: 'market.SY' },
    ]);

    expect(resolveMarket({ markets: single })).toEqual({ kind: 'NONE' });
  });
});
