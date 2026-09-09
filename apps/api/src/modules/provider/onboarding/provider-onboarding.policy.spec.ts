import type { ProviderOnboardingIssue } from '@homeservicemarketplace/contracts';

import {
  ISSUE_OWNER,
  MIN_BIO_LENGTH,
  MIN_HEADLINE_LENGTH,
  ONBOARDING_ISSUE_CODES,
  evaluateOnboarding,
  isOnboardingComplete,
  isProviderActionIssue,
  isProviderInputComplete,
  moderationIssues,
  ownerOfIssue,
  providerActionIssues,
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

// ── Sprint 09B.29 — the two axes ────────────────────────────────────────────
//
// The deadlock these tests pin the end of: a provider whose only outstanding
// item was an administrator's approval could not be "complete", so could not
// submit, so the approval was never prompted for.
describe('provider-action issues versus moderation issues', () => {
  // A candidate whose ONLY gap is a specialty sitting in the approval queue:
  // the leaf count is zero, and a pending application explains why.
  const awaitingModeration = () =>
    complete({ serviceCategoryCount: 0, leafSpecialtyCount: 0, pendingSpecialtyCount: 1 });

  // The same shape with nothing pending — the provider simply has not chosen.
  const nothingChosen = () =>
    complete({ serviceCategoryCount: 0, leafSpecialtyCount: 0, pendingSpecialtyCount: 0 });

  it('still RAISES the moderation issue — the policy is not weakened', () => {
    // The repair is in how consumers read the answer, not in what is reported.
    // Dropping the issue would hide the moderation axis entirely.
    const issues = evaluateOnboarding(awaitingModeration());
    expect(issues).toEqual(
      expect.arrayContaining([{ field: 'specialties', code: 'AWAITING_REVIEW' }]),
    );
  });

  it('classifies AWAITING_REVIEW as ours and everything else as theirs', () => {
    expect(isProviderActionIssue({ field: 'specialties', code: 'AWAITING_REVIEW' })).toBe(false);
    expect(isProviderActionIssue({ field: 'bio', code: 'REQUIRED' })).toBe(true);
    expect(isProviderActionIssue({ field: 'headline', code: 'TOO_SHORT' })).toBe(true);
    expect(isProviderActionIssue({ field: 'phoneNumber', code: 'NOT_VERIFIED' })).toBe(true);
  });

  it('treats a provider whose only gap is OUR approval as PROVIDER-INPUT complete', () => {
    // The precise function, not the ambiguous one. `isOnboardingComplete` asks
    // whether anything at all is outstanding — a queued approval is — and it is
    // deliberately still false here; see the dedicated comparison suite below.
    expect(isProviderInputComplete(awaitingModeration())).toBe(true);
    expect(isOnboardingComplete(awaitingModeration())).toBe(false);
    expect(providerActionIssues(evaluateOnboarding(awaitingModeration()))).toEqual([]);
    expect(moderationIssues(evaluateOnboarding(awaitingModeration())).map((i) => i.field)).toEqual(
      expect.arrayContaining(['serviceCategories', 'specialties']),
    );
  });

  it('does NOT treat "you have not chosen a specialty" as complete', () => {
    // The guard that stops the rule above from being a hole. No pending
    // application means the provider genuinely has not done this.
    expect(isOnboardingComplete(nothingChosen())).toBe(false);
    expect(providerActionIssues(evaluateOnboarding(nothingChosen()))).toEqual(
      expect.arrayContaining([{ field: 'specialties', code: 'REQUIRED' }]),
    );
  });

  it('a real gap still blocks even while moderation is pending', () => {
    const both = awaitingModeration();
    both.bio = null;
    expect(isOnboardingComplete(both)).toBe(false);
    expect(providerActionIssues(evaluateOnboarding(both)).map((i) => i.field)).toContain('bio');
    // ...and the moderation item is never reported as something to go and fix.
    expect(providerActionIssues(evaluateOnboarding(both)).map((i) => i.code)).not.toContain(
      'AWAITING_REVIEW',
    );
  });

  it('preserves policy order, so "the first blocker" is still the first', () => {
    const messy = complete({
      displayName: null,
      bio: null,
      serviceCategoryCount: 0,
      leafSpecialtyCount: 0,
      pendingSpecialtyCount: 1,
    });
    const fields = providerActionIssues(evaluateOnboarding(messy)).map((i) => i.field);
    expect(fields.indexOf('displayName')).toBeLessThan(fields.indexOf('bio'));
  });
});

// ── Sprint 09B.29 — issue ownership is canonical and exhaustive ─────────────
//
// One mapping, in the policy layer, that every other layer reads. The property
// under test is not "AWAITING_REVIEW is platform-owned" — that is one row. It
// is that NO code can exist without an explicit owner, so a future code cannot
// default into being the provider's problem and quietly re-create the deadlock.
describe('canonical issue ownership', () => {
  it('classifies every code the shared contract defines', () => {
    // If a code is added to the contract and not to the map, TypeScript fails
    // at the policy file first. This is the runtime backstop for anyone who
    // reaches the map through JavaScript, and for the case where the contract
    // and the map are edited in the same commit but the list below is not.
    for (const code of ONBOARDING_ISSUE_CODES) {
      expect(ISSUE_OWNER[code]).toBeDefined();
      expect(['PROVIDER', 'PLATFORM']).toContain(ISSUE_OWNER[code]);
    }
    expect(Object.keys(ISSUE_OWNER).sort()).toEqual([...ONBOARDING_ISSUE_CODES].sort());
  });

  it('owns AWAITING_REVIEW by the PLATFORM and everything else by the PROVIDER', () => {
    expect(ISSUE_OWNER.AWAITING_REVIEW).toBe('PLATFORM');
    for (const code of ONBOARDING_ISSUE_CODES) {
      if (code === 'AWAITING_REVIEW') continue;
      expect(ISSUE_OWNER[code]).toBe('PROVIDER');
    }
  });

  it('has no unmapped code — an unknown code must not read as provider-actionable', () => {
    // The failure this forbids: a `default: 'PROVIDER'` branch, or an
    // `issue.code !== 'AWAITING_REVIEW'` shortcut, either of which silently
    // classifies a code nobody has thought about yet.
    const unknown = 'SOME_FUTURE_CODE' as unknown as ProviderOnboardingIssue['code'];
    expect(ISSUE_OWNER[unknown]).toBeUndefined();
  });

  it('routes every helper through the same map', () => {
    const provider: ProviderOnboardingIssue = { field: 'bio', code: 'REQUIRED' };
    const platform: ProviderOnboardingIssue = { field: 'specialties', code: 'AWAITING_REVIEW' };

    expect(ownerOfIssue(provider)).toBe('PROVIDER');
    expect(ownerOfIssue(platform)).toBe('PLATFORM');
    expect(isProviderActionIssue(provider)).toBe(true);
    expect(isProviderActionIssue(platform)).toBe(false);
    expect(providerActionIssues([provider, platform])).toEqual([provider]);
    expect(moderationIssues([provider, platform])).toEqual([platform]);
  });

  it('does not depend on message text', () => {
    // Ownership is a property of the CODE. Nothing may branch on prose, which
    // is translated and therefore not a contract.
    const a: ProviderOnboardingIssue = { field: 'bio', code: 'AWAITING_REVIEW' };
    const b: ProviderOnboardingIssue = { field: 'specialties', code: 'AWAITING_REVIEW' };
    expect(ownerOfIssue(a)).toBe(ownerOfIssue(b));
  });
});

// ── Sprint 09B.29 — the two completion questions are different questions ────
describe('isOnboardingComplete versus isProviderInputComplete', () => {
  const awaitingModeration = () =>
    complete({ serviceCategoryCount: 0, leafSpecialtyCount: 0, pendingSpecialtyCount: 1 });

  it('AWAITING_REVIEW makes full completion false but provider input true', () => {
    // The whole distinction, in one case. `isOnboardingComplete` answers "is
    // anything outstanding at all, us included" — an approval in a queue is.
    // `isProviderInputComplete` answers "have they finished their part" — they
    // have.
    expect(isOnboardingComplete(awaitingModeration())).toBe(false);
    expect(isProviderInputComplete(awaitingModeration())).toBe(true);
  });

  it('a provider-action issue makes BOTH false', () => {
    const gap = complete({ bio: null });
    expect(isOnboardingComplete(gap)).toBe(false);
    expect(isProviderInputComplete(gap)).toBe(false);
  });

  it('no issues at all makes BOTH true', () => {
    expect(isOnboardingComplete(complete())).toBe(true);
    expect(isProviderInputComplete(complete())).toBe(true);
  });

  it('a provider-action issue alongside pending moderation makes both false', () => {
    const both = awaitingModeration();
    both.bio = null;
    expect(isOnboardingComplete(both)).toBe(false);
    expect(isProviderInputComplete(both)).toBe(false);
  });

  it('neither function is a work-access or activation decision', () => {
    // Documented here as an executable reminder rather than only in prose: the
    // functions answer questions about the ONBOARDING axis. Work access is a
    // grant an administrator issues and is read by ProviderCapabilityService;
    // activation is the verification decision. A candidate object carries
    // neither, so neither function could decide them even if a caller tried.
    const c = awaitingModeration();
    expect(Object.keys(c)).not.toContain('workAccess');
    expect(Object.keys(c)).not.toContain('verificationState');
    expect(Object.keys(c)).not.toContain('status');
  });
});
