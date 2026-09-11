import {
  V2_DEFAULT_PROVIDER_TYPE,
  isBlank,
  onboardingDefaultsForNewDraft,
} from './onboarding-defaults.policy';

// Sprint 09B.29 Phase 5 (C1) — the two defaults a new V2 draft may assume.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.6
//
// Every test here is really the same test asked six ways: **is this an
// overwrite?** The defaults exist because the approved V2 screens no longer ask
// for a provider type or a professional title, and the danger in filling a
// field nobody asked about is doing it to a field somebody already answered.

describe('what counts as blank', () => {
  it('treats null, undefined, empty and whitespace as unsaid', () => {
    // All three string cases are real: '' is what an empty control posts, and
    // '   ' is what one posts after somebody types a space and gives up.
    const blank: unknown[] = [null, undefined, '', '   ', '\t', '\n '];
    expect(blank.map(isBlank)).toEqual(blank.map(() => true));
  });

  it('treats any real content as said, including a single character', () => {
    const said: unknown[] = ['A', 'Painter', ' x ', 0, false];
    expect(said.map(isBlank)).toEqual(said.map(() => false));
  });
});

describe('providerType', () => {
  it('defaults to INDIVIDUAL when the profile has none', () => {
    expect(onboardingDefaultsForNewDraft({})).toMatchObject({
      providerType: V2_DEFAULT_PROVIDER_TYPE,
    });
    expect(V2_DEFAULT_PROVIDER_TYPE).toBe('INDIVIDUAL');
  });

  it('NEVER overwrites an existing type, individual or business', () => {
    // A profile that already says BUSINESS was set that way by somebody — the
    // V1 wizard, an admin, a migration — and V2 has no screen that could have
    // changed their mind.
    for (const existing of ['BUSINESS', 'INDIVIDUAL']) {
      expect(onboardingDefaultsForNewDraft({ existingProviderType: existing })).not.toHaveProperty(
        'providerType',
      );
    }
  });

  it('does not treat an unfamiliar legacy value as absent', () => {
    // The point of `isBlank` rather than an enum check: a value this build does
    // not recognise is still somebody's answer, and replacing it would be a
    // silent data change during an unrelated deployment.
    expect(
      onboardingDefaultsForNewDraft({ existingProviderType: 'SOLE_TRADER_LEGACY' }),
    ).not.toHaveProperty('providerType');
  });
});

describe('headline', () => {
  it('seeds the generated suggestion when the headline is blank', () => {
    expect(
      onboardingDefaultsForNewDraft({
        existingHeadline: null,
        suggestedTitle: 'Painting professional',
      }),
    ).toMatchObject({ headline: 'Painting professional' });
  });

  it('seeds over an empty or whitespace headline too', () => {
    // A whitespace headline would otherwise sit on a public profile for ever,
    // because nothing else in the journey asks about it any more.
    for (const existing of ['', '   ']) {
      expect(
        onboardingDefaultsForNewDraft({
          existingHeadline: existing,
          suggestedTitle: 'Electrician',
        }),
      ).toMatchObject({ headline: 'Electrician' });
    }
  });

  it('NEVER overwrites a headline the provider wrote', () => {
    expect(
      onboardingDefaultsForNewDraft({
        existingHeadline: 'The best painter in Aleppo',
        suggestedTitle: 'Painting professional',
      }),
    ).not.toHaveProperty('headline');
  });

  it('writes nothing when there is no suggestion to write', () => {
    // A provider who has not chosen a primary service yet — the ordinary case
    // on a first read. They get nothing rather than an empty string.
    expect(onboardingDefaultsForNewDraft({ suggestedTitle: null })).not.toHaveProperty('headline');
    expect(onboardingDefaultsForNewDraft({ suggestedTitle: '  ' })).not.toHaveProperty('headline');
  });

  it('trims the suggestion it stores', () => {
    expect(onboardingDefaultsForNewDraft({ suggestedTitle: '  Plumber  ' })).toMatchObject({
      headline: 'Plumber',
    });
  });
});

describe('the patch shape is the safety property', () => {
  it('returns an EMPTY patch when a profile is already complete', () => {
    // Empty rather than "the same values". A caller spreads this into an
    // update, so an empty object writes nothing at all — where a full value
    // set would rewrite both columns and make "did this change anything?" a
    // comparison. A comparison is how a coincidentally equal legacy value gets
    // overwritten and its `updatedAt` moved.
    const patch = onboardingDefaultsForNewDraft({
      existingProviderType: 'BUSINESS',
      existingHeadline: 'Established 1998',
      suggestedTitle: 'Painting professional',
    });

    expect(patch).toEqual({});
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('patches only the field that is missing', () => {
    // The mixed case, which is the common one: a legacy V1 profile with a type
    // and no headline.
    expect(
      onboardingDefaultsForNewDraft({
        existingProviderType: 'BUSINESS',
        existingHeadline: null,
        suggestedTitle: 'Painting professional',
      }),
    ).toEqual({ headline: 'Painting professional' });
  });

  it('never returns a key whose value is null or empty', () => {
    // A patch carrying `headline: null` would CLEAR the column rather than
    // leave it alone — the exact inversion of what this policy is for.
    const patches = [
      onboardingDefaultsForNewDraft({}),
      onboardingDefaultsForNewDraft({ existingHeadline: 'x' }),
      onboardingDefaultsForNewDraft({ suggestedTitle: '' }),
    ];

    for (const patch of patches) {
      for (const value of Object.values(patch)) {
        expect(value).not.toBeNull();
        expect(value).not.toBe('');
      }
    }
  });
});
