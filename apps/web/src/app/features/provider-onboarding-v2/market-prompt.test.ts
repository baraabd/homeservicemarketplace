import { describe, expect, it } from 'vitest';
import type {
  ProviderOnboardingDraftView,
  ProviderSupportedMarketsResponse,
  SupportedMarketView,
} from '@homeservicemarketplace/contracts';

import { marketPrompt } from '../../hooks/provider/useSupportedMarkets';

// Sprint 09B.29 Phase 5B — G-01, as a pure decision.
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md
//
// WHAT THIS PINS
//
// The approved work-area screen has no country control, and `serviceAreaCountry`
// is REQUIRED for submission. A provider whose market was never recorded could
// therefore finish every task and be refused at the end with no screen able to
// fix it — the one gap in the register that can stop somebody submitting.
//
// The answer is a SUBSTATE rather than a permanent field, so the settled case
// must render nothing at all: that is what keeps the frozen reference honest.
// Every branch below is a server answer, never a client guess. Nothing here
// infers a country from a locale, a timezone or a cookie.

const MARKET = (over: Partial<SupportedMarketView> = {}): SupportedMarketView => ({
  countryCode: 'SY',
  displayNameKey: 'SY',
  radius: { minKm: 3, maxKm: 25, defaultKm: 15 },
  timezone: { kind: 'RESOLVED', id: 'Asia/Damascus' },
  ...over,
});

const RESPONSE = (
  over: Partial<ProviderSupportedMarketsResponse> = {},
): ProviderSupportedMarketsResponse => ({
  markets: [MARKET()],
  selectedCountryCode: 'SY',
  locationSuggestionAvailable: false,
  ...over,
});

const DRAFT = (data: Record<string, unknown> = {}): ProviderOnboardingDraftView =>
  ({
    data: { serviceAreaCountryCode: null, timezone: null, ...data },
  }) as unknown as ProviderOnboardingDraftView;

describe('the settled case asks nothing', () => {
  it('renders no question when the market is recorded and still open', () => {
    const prompt = marketPrompt(RESPONSE(), DRAFT({ serviceAreaCountryCode: 'SY' }));
    expect(prompt).toEqual({ kind: 'SETTLED', market: MARKET() });
  });

  it('says nothing at all before the server has answered', () => {
    // A picker flashed at somebody who already chose a country reads as data
    // loss. No answer yet is not the same as no market.
    expect(marketPrompt(undefined, DRAFT({ serviceAreaCountryCode: 'SY' }))).toBeNull();
  });
});

describe('the cases that would otherwise block submission', () => {
  it('asks for a country when none is recorded anywhere', () => {
    const prompt = marketPrompt(RESPONSE({ selectedCountryCode: null }), DRAFT());
    expect(prompt).toEqual({ kind: 'CHOOSE' });
  });

  it('explains a withdrawal instead of pretending the answer was never given', () => {
    // The code is still on the profile and absent from the enabled list. Both
    // halves are needed: "choose a country" to somebody who already chose one
    // reads as though their answer was lost.
    const prompt = marketPrompt(
      RESPONSE({ markets: [MARKET({ countryCode: 'SE', displayNameKey: 'SE' })] }),
      DRAFT({ serviceAreaCountryCode: 'SY' }),
    );
    expect(prompt).toEqual({ kind: 'WITHDRAWN', previousCountryCode: 'SY' });
  });

  it('asks for a timezone when the country does not pin one', () => {
    const ask = MARKET({ timezone: { kind: 'ASK' } });
    const prompt = marketPrompt(RESPONSE({ markets: [ask] }), DRAFT());
    expect(prompt).toEqual({ kind: 'CONFIRM_TIMEZONE', market: ask });
  });

  it('stops asking once a timezone has been stored', () => {
    const ask = MARKET({ timezone: { kind: 'ASK' } });
    const prompt = marketPrompt(
      RESPONSE({ markets: [ask] }),
      DRAFT({ timezone: 'Europe/Stockholm' }),
    );
    expect(prompt).toEqual({ kind: 'SETTLED', market: ask });
  });
});

describe('what it refuses to infer', () => {
  it('falls back to the DRAFT only when the registry has no selection', () => {
    // Two sources, one meaning. The registry is authoritative; the draft is
    // the fallback for the window between a write and the registry refetch.
    const prompt = marketPrompt(
      RESPONSE({ selectedCountryCode: null }),
      DRAFT({ serviceAreaCountryCode: 'SY' }),
    );
    expect(prompt).toEqual({ kind: 'SETTLED', market: MARKET() });
  });

  it('never invents a market from an empty registry', () => {
    // An operator who has opened nothing means nobody can be onboarded, and
    // saying "choose a country" with no countries is the honest rendering of
    // that — not a guess at one.
    const prompt = marketPrompt(RESPONSE({ markets: [], selectedCountryCode: null }), DRAFT());
    expect(prompt).toEqual({ kind: 'CHOOSE' });
  });

  it('treats a recorded country that the operator never opened as a withdrawal', () => {
    // Same shape as a withdrawal and deliberately so: from the provider's side
    // "we do not operate there" is one fact, however it came about.
    const prompt = marketPrompt(RESPONSE({ markets: [], selectedCountryCode: 'ZZ' }), DRAFT());
    expect(prompt).toEqual({ kind: 'WITHDRAWN', previousCountryCode: 'ZZ' });
  });
});
