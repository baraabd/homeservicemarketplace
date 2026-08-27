import {
  MIN_BIO_LENGTH,
  MIN_HEADLINE_LENGTH,
  evaluateOnboarding,
  isOnboardingComplete,
  type OnboardingCandidate,
} from './provider-onboarding.policy';

// Phase 4 — the provider onboarding completeness policy.
//
// This is the single definition consumed by GET /v1/me/provider/onboarding,
// POST /v1/me/provider/submit-for-review, and (through the former) the
// Provider app's Submit button. Pinning it here is what stops the app and the
// server drifting into a Submit button that is enabled and then 422s.

function complete(over: Partial<OnboardingCandidate> = {}): OnboardingCandidate {
  return {
    displayName: 'Ada Lovelace Services',
    headline: 'Certified electrician, 10 years experience',
    bio: 'I handle residential and light commercial electrical work, including rewiring and fault finding.',
    phoneNumber: '+46701234567',
    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    serviceAreaRadiusKm: 25,
    serviceCategoryCount: 2,
    emailVerified: true,
    ...over,
  };
}

const fieldsOf = (candidate: OnboardingCandidate) =>
  evaluateOnboarding(candidate).map((i) => i.field);

describe('provider onboarding completeness policy', () => {
  it('accepts a fully completed profile', () => {
    expect(evaluateOnboarding(complete())).toEqual([]);
    expect(isOnboardingComplete(complete())).toBe(true);
  });

  describe('required fields', () => {
    it.each([
      ['displayName', { displayName: null }],
      ['headline', { headline: null }],
      ['bio', { bio: null }],
      ['phoneNumber', { phoneNumber: null }],
      ['serviceAreaCity', { serviceAreaCity: null }],
      ['serviceAreaCountry', { serviceAreaCountry: null }],
      ['serviceAreaRadiusKm', { serviceAreaRadiusKm: null }],
      ['serviceCategories', { serviceCategoryCount: 0 }],
    ] as Array<[string, Partial<OnboardingCandidate>]>)(
      'reports %s as REQUIRED when it is missing',
      (field, over) => {
        const issues = evaluateOnboarding(complete(over));
        expect(issues).toContainEqual({ field, code: 'REQUIRED' });
      },
    );

    it.each([
      ['displayName', { displayName: '   ' }],
      ['headline', { headline: '  \t ' }],
      ['bio', { bio: '' }],
      ['phoneNumber', { phoneNumber: ' ' }],
      ['serviceAreaCity', { serviceAreaCity: '  ' }],
    ] as Array<[string, Partial<OnboardingCandidate>]>)(
      'treats a whitespace-only %s as missing, not present',
      (field, over) => {
        expect(fieldsOf(complete(over))).toContain(field);
      },
    );

    it('rejects a zero or negative service radius — that matches no request at all', () => {
      expect(evaluateOnboarding(complete({ serviceAreaRadiusKm: 0 }))).toContainEqual({
        field: 'serviceAreaRadiusKm',
        code: 'REQUIRED',
      });
      expect(evaluateOnboarding(complete({ serviceAreaRadiusKm: -5 }))).toContainEqual({
        field: 'serviceAreaRadiusKm',
        code: 'REQUIRED',
      });
    });
  });

  describe('minimum useful length', () => {
    it('distinguishes TOO_SHORT from REQUIRED for the headline', () => {
      // Present but useless is a different problem from absent, and the app
      // should tell the user which one it is.
      const issues = evaluateOnboarding(
        complete({ headline: 'a'.repeat(MIN_HEADLINE_LENGTH - 1) }),
      );
      expect(issues).toContainEqual({ field: 'headline', code: 'TOO_SHORT' });
      expect(issues).not.toContainEqual({ field: 'headline', code: 'REQUIRED' });
    });

    it('accepts a headline exactly at the minimum length', () => {
      expect(fieldsOf(complete({ headline: 'a'.repeat(MIN_HEADLINE_LENGTH) }))).not.toContain(
        'headline',
      );
    });

    it('distinguishes TOO_SHORT from REQUIRED for the bio', () => {
      const issues = evaluateOnboarding(complete({ bio: 'a'.repeat(MIN_BIO_LENGTH - 1) }));
      expect(issues).toContainEqual({ field: 'bio', code: 'TOO_SHORT' });
    });

    it('accepts a bio exactly at the minimum length', () => {
      expect(fieldsOf(complete({ bio: 'a'.repeat(MIN_BIO_LENGTH) }))).not.toContain('bio');
    });
  });

  describe('contact verification', () => {
    it('reports UNVERIFIED (not REQUIRED) for an unverified email', () => {
      // A provider application is reviewable only from an identity we can
      // actually contact; "present but unverified" is its own state.
      const issues = evaluateOnboarding(complete({ emailVerified: false }));
      expect(issues).toContainEqual({ field: 'emailVerified', code: 'UNVERIFIED' });
      expect(isOnboardingComplete(complete({ emailVerified: false }))).toBe(false);
    });
  });

  it('reports EVERY unmet requirement at once, not just the first', () => {
    // One-at-a-time validation turns onboarding into a guessing game.
    const issues = evaluateOnboarding({
      displayName: null,
      headline: null,
      bio: null,
      phoneNumber: null,
      serviceAreaCity: null,
      serviceAreaCountry: null,
      serviceAreaRadiusKm: null,
      serviceCategoryCount: 0,
      emailVerified: false,
    });
    expect(issues.map((i) => i.field).sort()).toEqual(
      [
        'bio',
        'displayName',
        'emailVerified',
        'headline',
        'phoneNumber',
        'serviceAreaCity',
        'serviceAreaCountry',
        'serviceAreaRadiusKm',
        'serviceCategories',
      ].sort(),
    );
  });

  it('emits stable machine-readable codes, never prose', () => {
    // The app maps these to localised copy; if they ever become sentences the
    // client has to string-match to know what failed.
    for (const issue of evaluateOnboarding({
      displayName: null,
      headline: 'x',
      bio: null,
      phoneNumber: null,
      serviceAreaCity: null,
      serviceAreaCountry: null,
      serviceAreaRadiusKm: null,
      serviceCategoryCount: 0,
      emailVerified: false,
    })) {
      expect(['REQUIRED', 'TOO_SHORT', 'UNVERIFIED']).toContain(issue.code);
      expect(issue.field).toMatch(/^[a-zA-Z]+$/);
    }
  });
  // ── Sprint 9B.13 ───────────────────────────────────────────────────────
  //
  // The wizard no longer SUPPLIES phoneVerified, because nothing in the system
  // can set it (see provider-onboarding-wizard.service.ts). These two tests pin
  // both halves of that decision, so neither can be lost by accident: the rule
  // is intact for anyone who does supply an answer, and a candidate that is
  // silent on the question is not judged on it.

  it(`still refuses a candidate that reports an unverified phone`, () => {
    // A number nobody proved they control is a contact method that does not
    // work, and it is the channel a seeker uses when a provider is late. The
    // day a verification channel ships, this is the rule that starts biting
    // again — with no change here.
    expect(fieldsOf(complete({ phoneVerified: false }))).toContain(`phoneNumber`);
  });

  it(`does not judge a candidate that is SILENT about phone verification`, () => {
    // undefined means "not asked", which is the contract this policy already
    // defines for every Sprint 8 field, so legacy profiles are not failed on
    // data nobody ever collected from them.
    expect(fieldsOf(complete({ phoneVerified: undefined }))).not.toContain(`phoneNumber`);
  });
});
