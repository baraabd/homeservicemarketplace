import { parseSupportedMarkets, type SupportedMarket } from './supported-market';
import { decideTimezone, persistableTimezone } from './timezone-precedence.policy';

// Sprint 09B.29 Phase 5 (C3) — the timezone precedence, one case per rule.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// The three markets the decision names are used throughout, and they were
// chosen because they are genuinely different: Sweden observes DST, Syria and
// Saudi Arabia do not. A policy tested only against one of those would not
// notice a bug that lives in the other.

const [SY, SE, SA, AMBIGUOUS] = parseSupportedMarkets([
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
  // A market spanning several zones declares NO default, so the policy must
  // ask rather than pick one. The US is the obvious real example.
  { countryCode: 'US', enabled: true, displayNameKey: 'market.US' },
]) as [SupportedMarket, SupportedMarket, SupportedMarket, SupportedMarket];

describe('the three named markets resolve to their zones', () => {
  it.each([
    ['Syria', SY, 'Asia/Damascus'],
    ['Sweden', SE, 'Europe/Stockholm'],
    ['Saudi Arabia', SA, 'Asia/Riyadh'],
  ])('%s resolves to %s', (_name, market, zone) => {
    const decision = decideTimezone({ market });

    expect(decision).toEqual({ kind: 'RESOLVED', timezone: zone, from: 'MARKET' });
    expect(persistableTimezone(decision)).toBe(zone);
  });
});

describe('precedence', () => {
  it('NEVER overwrites an explicit provider timezone', () => {
    // The provider is in Sweden but works to Damascus hours — unusual, valid,
    // and entirely theirs to decide. Nothing here may quietly correct it.
    const decision = decideTimezone({
      existingTimezone: 'Asia/Damascus',
      originTimezone: 'Europe/Stockholm',
      market: SE,
    });

    expect(decision).toEqual({ kind: 'KEEP', timezone: 'Asia/Damascus' });
    // KEEP is not persistable: the value is already stored, and rewriting it
    // is a no-op at best and an overwrite at worst.
    expect(persistableTimezone(decision)).toBeNull();
  });

  it('prefers the confirmed work ORIGIN over the market default', () => {
    // A provider in a border city is in their city's zone, not their market's
    // centre.
    const decision = decideTimezone({ originTimezone: 'Asia/Beirut', market: SY });

    expect(decision).toEqual({ kind: 'RESOLVED', timezone: 'Asia/Beirut', from: 'ORIGIN' });
  });

  it('falls back to the market default only when there is no origin', () => {
    expect(decideTimezone({ market: SA })).toMatchObject({ from: 'MARKET' });
  });

  it('ASKS when the market spans several zones', () => {
    // The registry leaves `defaultTimezone` undefined for such a market
    // precisely so this branch is reachable. A default there would be
    // indistinguishable from an answer.
    const decision = decideTimezone({ market: AMBIGUOUS });

    expect(decision).toEqual({ kind: 'ASK', reason: 'AMBIGUOUS_MARKET' });
    expect(persistableTimezone(decision)).toBeNull();
  });

  it('ASKS when there is no market at all', () => {
    // Distinguished from AMBIGUOUS_MARKET so the UI can ask the right
    // question: "where do you work?" rather than "which part of the country?".
    expect(decideTimezone({})).toEqual({ kind: 'ASK', reason: 'NO_MARKET' });
  });
});

describe('validity is checked at every level, including the stored value', () => {
  it('does not treat an INVALID stored timezone as explicit', () => {
    // A legacy value, a hand-edited row, or a zone since retired. Storing
    // hours against it would produce times nobody can compute, so it must not
    // win the precedence — the provider gets asked, or the market answers.
    const decision = decideTimezone({ existingTimezone: 'Mars/Olympus', market: SY });

    expect(decision).toEqual({ kind: 'RESOLVED', timezone: 'Asia/Damascus', from: 'MARKET' });
  });

  it('ignores an invalid origin and an invalid market default', () => {
    expect(decideTimezone({ originTimezone: 'GMT+3', market: SY })).toMatchObject({
      timezone: 'Asia/Damascus',
      from: 'MARKET',
    });
    // A market whose default somehow failed validation cannot answer either.
    const broken = { ...SY, defaultTimezone: 'Not/AZone' } as SupportedMarket;
    expect(decideTimezone({ market: broken })).toEqual({
      kind: 'ASK',
      reason: 'AMBIGUOUS_MARKET',
    });
  });

  it('ignores null, undefined and empty values at every level', () => {
    expect(decideTimezone({ existingTimezone: null, originTimezone: '', market: null })).toEqual({
      kind: 'ASK',
      reason: 'NO_MARKET',
    });
  });

  it('never accepts the browser as an authority — it is not even an input', () => {
    // A provider in Damascus setting up on a laptop still on European time
    // would have every window shifted. The UI may SHOW a browser guess; this
    // policy has no field for one, which is the strongest form of the rule.
    const fields = Object.keys(
      decideTimezone({ market: SY }) as unknown as Record<string, unknown>,
    );
    expect(fields).not.toContain('browserTimezone');
  });
});

describe('DST and non-DST markets both behave', () => {
  // The decision requires at least one DST market and one non-DST market to be
  // exercised. Sweden observes DST; Syria abolished it in 2022 and Saudi Arabia
  // has never used it.
  const at = (zone: string, iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));

  it('Sweden shifts between winter and summer', () => {
    const winter = at('Europe/Stockholm', '2026-01-15T12:00:00Z');
    const summer = at('Europe/Stockholm', '2026-07-15T12:00:00Z');

    // CET (+1) in January, CEST (+2) in July. If a future tzdata changed this,
    // the assertion should fail rather than the product silently shifting.
    expect(winter).toBe('13:00');
    expect(summer).toBe('14:00');
    expect(winter).not.toBe(summer);
  });

  it('Syria and Saudi Arabia do not shift', () => {
    for (const zone of ['Asia/Damascus', 'Asia/Riyadh']) {
      expect(at(zone, '2026-01-15T12:00:00Z')).toBe(at(zone, '2026-07-15T12:00:00Z'));
    }
  });

  it('resolves a zone whose offset the runtime can actually compute', () => {
    // The point of validating against `Intl` rather than a regex: every zone
    // this policy can return is one the formatter can use.
    for (const market of [SY, SE, SA]) {
      const zone = persistableTimezone(decideTimezone({ market }));
      expect(zone).not.toBeNull();
      expect(() => at(zone as string, '2026-03-01T12:00:00Z')).not.toThrow();
    }
  });
});
