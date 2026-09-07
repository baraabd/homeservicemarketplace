import {
  PROVIDER_ONBOARDING_STEPS,
  STEP_TO_V2_TASK,
  type ProviderOnboardingIssue,
  type ReviewTerms,
} from '@homeservicemarketplace/contracts';

import { buildReview, type ReviewSource } from './onboarding-review-resolver';

// Sprint 9B.23 — the review projection, asserted without a database.

const TERMS_OK: ReviewTerms = {
  version: 'v2',
  locale: 'en',
  accepted: true,
  acceptedVersion: 'v2',
  acceptedAt: '2026-08-29T00:00:00.000Z',
};

function source(over: Partial<ReviewSource> = {}): ReviewSource {
  return {
    issues: [],
    lifecycleState: 'DRAFT',
    draftVersion: 7,
    terms: TERMS_OK,
    pendingSpecialtyCount: 0,
    awaitingPortfolioReviewCount: 0,
    portfolioEmpty: false,
    ...over,
  };
}

const group = (r: ReturnType<typeof buildReview>, kind: string) =>
  r.groups.find((g) => g.kind === kind)!;

describe('the deep-link map', () => {
  it('covers every wizard step, so a blocker can always be opened', () => {
    // A step with no task is a blocker the provider is told about but cannot
    // be sent to — the "disabled button that cannot say what to do" defect.
    for (const step of PROVIDER_ONBOARDING_STEPS) {
      expect(STEP_TO_V2_TASK[step]).toBeTruthy();
    }
  });

  it('maps every step onto one of the six V2 tasks', () => {
    const TASKS = [
      'BASICS_IDENTITY',
      'SERVICES_EXPERIENCE',
      'WORK_AREA',
      'WORKING_HOURS',
      'PORTFOLIO',
      'REVIEW_SUBMISSION',
    ];
    for (const step of PROVIDER_ONBOARDING_STEPS) {
      expect(TASKS).toContain(STEP_TO_V2_TASK[step]);
    }
  });
});

describe('a complete application', () => {
  it('can submit, and offers no blocked reason', () => {
    const r = buildReview(source());
    expect(r.canSubmit).toBe(true);
    expect(r.blockedReason).toBeNull();
    expect(group(r, 'BLOCKING').items).toEqual([]);
  });

  it('carries the concurrency and consent tokens the submit must echo', () => {
    const r = buildReview(source());
    expect(r.draftVersion).toBe(7);
    expect(r.terms.version).toBe('v2');
  });
});

describe('a blocked application always says what to do next', () => {
  const issues: ProviderOnboardingIssue[] = [
    { field: 'bio', code: 'TOO_SHORT' },
    { field: 'serviceAreaCity', code: 'REQUIRED' },
  ];

  it('refuses submission', () => {
    expect(buildReview(source({ issues })).canSubmit).toBe(false);
  });

  it('names ONE next action, not a count of problems', () => {
    const r = buildReview(source({ issues }));
    expect(r.blockedReason).not.toBeNull();
    expect(r.blockedReason!.field).toBe('bio');
    expect(r.blockedReason!.code).toBe('TOO_SHORT');
  });

  it('gives every blocker a task to open', () => {
    const r = buildReview(source({ issues }));
    for (const item of group(r, 'BLOCKING').items) {
      expect(item.taskId).toBeTruthy();
    }
  });

  it('routes a profile blocker to the profile task and an area one to the area task', () => {
    const r = buildReview(source({ issues }));
    const byField = Object.fromEntries(group(r, 'BLOCKING').items.map((i) => [i.field, i.taskId]));
    expect(byField['bio']).toBe('PORTFOLIO');
    expect(byField['serviceAreaCity']).toBe('WORK_AREA');
  });

  it('sends prose to nobody — field and code only', () => {
    // The client owns the sentence. A server-sent message would decide the
    // app's language.
    const raw = JSON.stringify(buildReview(source({ issues })));
    expect(raw).not.toMatch(/too short/i);
    expect(raw).not.toMatch(/required field/i);
  });
});

describe('terms', () => {
  it('blocks submission when the current version was never accepted', () => {
    const terms: ReviewTerms = {
      ...TERMS_OK,
      accepted: false,
      acceptedVersion: null,
      acceptedAt: null,
    };
    const r = buildReview(source({ terms }));
    expect(r.canSubmit).toBe(false);
    expect(r.blockedReason!.code).toBe('REQUIRED');
    expect(r.blockedReason!.taskId).toBe('REVIEW_SUBMISSION');
  });

  it('blocks submission when only an OLDER version was accepted', () => {
    // Accepting v1 is not consent to v2. The tick must not survive a version
    // change.
    const terms: ReviewTerms = { ...TERMS_OK, accepted: false, acceptedVersion: 'v1' };
    const r = buildReview(source({ terms }));
    expect(r.canSubmit).toBe(false);
    expect(r.blockedReason!.code).toBe('STALE_VERSION');
  });

  it('does not block a complete application whose consent is current', () => {
    expect(buildReview(source()).canSubmit).toBe(true);
  });

  it('raises consent ONCE, even though two rules can see it', () => {
    // `evaluateOnboarding` raises `consent: REQUIRED` on its own now. This
    // resolver was written when it did not, and appended its own terms blocker
    // unconditionally — so a provider whose only outstanding item was consent
    // got two cards saying the same thing, one after the other.
    const terms: ReviewTerms = {
      ...TERMS_OK,
      accepted: false,
      acceptedVersion: null,
      acceptedAt: null,
    };
    const r = buildReview(source({ terms, issues: [{ field: 'consent', code: 'REQUIRED' }] }));

    const consentItems = group(r, 'BLOCKING').items.filter(
      (i) => i.field === 'consent' || i.field === 'acceptedConsentVersion',
    );
    expect(consentItems).toHaveLength(1);
    expect(r.canSubmit).toBe(false);
  });

  it('still raises STALE_VERSION, which the policy cannot see', () => {
    // The policy only knows whether a version string is stored. Whether that
    // version is the LIVE one is a comparison only this resolver makes, so a
    // provider who agreed to superseded terms must still be told — and the
    // policy stays silent, because the field is not empty.
    const terms: ReviewTerms = { ...TERMS_OK, accepted: false, acceptedVersion: 'v1' };
    const r = buildReview(source({ terms }));

    const stale = group(r, 'BLOCKING').items.filter((i) => i.code === 'STALE_VERSION');
    expect(stale).toHaveLength(1);
  });
});

// Which layer owns which consent rule, asserted rather than assumed.
//
//   REQUIRED       — "no consent on file". Owned by `evaluateOnboarding`,
//                    which can see the stored value. This resolver PROJECTS
//                    that issue and adds nothing.
//   STALE_VERSION  — "consent on file, but to superseded terms". Owned HERE:
//                    it is a comparison against the live version, which the
//                    policy is not given.
//
// The resolver keeps a fallback for REQUIRED because it must still work
// against a caller that does not run the policy over consent — but it must
// never produce a second card when the policy already did.
const consentItems = (r: ReturnType<typeof buildReview>) =>
  group(r, 'BLOCKING').items.filter(
    (i) => i.field === 'consent' || i.field === 'acceptedConsentVersion',
  );

describe('consent ownership and composition', () => {
  const NO_CONSENT: ReviewTerms = {
    ...TERMS_OK,
    accepted: false,
    acceptedVersion: null,
    acceptedAt: null,
  };

  it('policy only: the projected issue is the single blocker', () => {
    // terms.accepted is true, so the resolver's own fallback does not fire;
    // the policy's issue is all there is, and it must survive projection.
    const r = buildReview(source({ issues: [{ field: 'consent', code: 'REQUIRED' }] }));
    expect(consentItems(r)).toHaveLength(1);
    expect(consentItems(r)[0]!.field).toBe('consent');
    expect(r.canSubmit).toBe(false);
  });

  it('resolver only: the fallback still covers a caller the policy did not', () => {
    const r = buildReview(source({ terms: NO_CONSENT }));
    expect(consentItems(r)).toHaveLength(1);
    expect(consentItems(r)[0]!.code).toBe('REQUIRED');
    expect(r.canSubmit).toBe(false);
  });

  it('both layers: still exactly one, and still refused', () => {
    const r = buildReview(
      source({ terms: NO_CONSENT, issues: [{ field: 'consent', code: 'REQUIRED' }] }),
    );
    expect(consentItems(r)).toHaveLength(1);
    expect(r.canSubmit).toBe(false);
  });

  it('current consent: no consent blocker, and submission is permitted', () => {
    const r = buildReview(source());
    expect(consentItems(r)).toHaveLength(0);
    expect(r.canSubmit).toBe(true);
  });

  it('an unrelated blocker is NOT swallowed by the consent dedupe', () => {
    // The dedupe keys on the consent field alone. A bug that keyed on "any
    // blocker exists" would silently drop everything else.
    const r = buildReview(
      source({
        terms: NO_CONSENT,
        issues: [
          { field: 'consent', code: 'REQUIRED' },
          { field: 'bio', code: 'REQUIRED' },
        ],
      }),
    );
    const blocking = group(r, 'BLOCKING').items;
    expect(consentItems(r)).toHaveLength(1);
    expect(blocking.filter((i) => i.field === 'bio')).toHaveLength(1);
    expect(blocking.length).toBeGreaterThanOrEqual(2);
  });

  it('every item in the composed review has a unique id', () => {
    // The invariant the duplicate consent card violated, stated for the whole
    // projection rather than for consent alone.
    //
    // Keyed on `id`, not on field:code. COMPLETE items carry field: null and
    // code: null — they are identified by their STEP — so a field:code key
    // collapses all of them onto one another and reports duplicates that are
    // not there. `id` is what the resolver assigns to be unique, and it is
    // what a client uses for a React key.
    const r = buildReview(
      source({
        terms: NO_CONSENT,
        issues: [
          { field: 'consent', code: 'REQUIRED' },
          { field: 'bio', code: 'REQUIRED' },
          { field: 'displayName', code: 'REQUIRED' },
        ],
        pendingSpecialtyCount: 2,
        portfolioEmpty: true,
      }),
    );
    const ids = r.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no field:code pair repeats WITHIN the blocking group', () => {
    // Blocking items are the ones a provider reads as a list of things to fix,
    // and the ones that carry a real field and code. Two entries saying the
    // same thing is the defect; this is that statement, generalised.
    const r = buildReview(
      source({
        terms: NO_CONSENT,
        issues: [
          { field: 'consent', code: 'REQUIRED' },
          { field: 'bio', code: 'REQUIRED' },
          { field: 'displayName', code: 'REQUIRED' },
        ],
      }),
    );
    const pairs = group(r, 'BLOCKING').items.map((i) => `${i.field}:${i.code}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('groups keep a stable order, so the screen does not reshuffle on refetch', () => {
    const order = (r: ReturnType<typeof buildReview>) => r.groups.map((g) => g.kind);
    expect(order(buildReview(source()))).toEqual(['BLOCKING', 'WAITING', 'OPTIONAL', 'COMPLETE']);
    expect(
      order(
        buildReview(source({ terms: NO_CONSENT, issues: [{ field: 'bio', code: 'REQUIRED' }] })),
      ),
    ).toEqual(['BLOCKING', 'WAITING', 'OPTIONAL', 'COMPLETE']);
  });

  it('blocking items keep the policy order, with the resolver fallback last', () => {
    // `blockedReason` is blocking[0], so order decides which single sentence
    // the provider is shown. It must be the policy's first issue, not whatever
    // the resolver happened to append.
    const r = buildReview(
      source({
        terms: NO_CONSENT,
        issues: [
          { field: 'displayName', code: 'REQUIRED' },
          { field: 'bio', code: 'REQUIRED' },
        ],
      }),
    );
    const fields = group(r, 'BLOCKING').items.map((i) => i.field);
    expect(fields).toEqual(['displayName', 'bio', 'acceptedConsentVersion']);
    expect(r.blockedReason!.field).toBe('displayName');
  });
});

describe('waiting is not blocking', () => {
  it('a pending specialty waits, and never refuses the submission', () => {
    const r = buildReview(source({ pendingSpecialtyCount: 3 }));
    expect(r.canSubmit).toBe(true);
    const w = group(r, 'WAITING').items;
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('SPECIALTY_REVIEW');
    expect(w[0].count).toBe(3);
  });

  it('offers no deep link for something the provider cannot act on', () => {
    const r = buildReview(source({ pendingSpecialtyCount: 1 }));
    expect(group(r, 'WAITING').items[0].taskId).toBeNull();
  });

  it('reports photos awaiting review without calling them a problem', () => {
    const r = buildReview(source({ awaitingPortfolioReviewCount: 2 }));
    expect(r.canSubmit).toBe(true);
    expect(group(r, 'WAITING').items.map((i) => i.code)).toContain('PORTFOLIO_REVIEW');
    expect(group(r, 'BLOCKING').items).toEqual([]);
  });
});

describe('optional advice never blocks', () => {
  it('an empty portfolio is a recommendation, not a requirement', () => {
    const r = buildReview(source({ portfolioEmpty: true }));
    expect(r.canSubmit).toBe(true);
    expect(group(r, 'OPTIONAL').items.map((i) => i.code)).toEqual(['PORTFOLIO_EMPTY']);
    expect(group(r, 'BLOCKING').items).toEqual([]);
  });
});

describe('completed work is shown, not only problems', () => {
  it('lists the finished steps', () => {
    const r = buildReview(source());
    const done = group(r, 'COMPLETE').items.map((i) => i.step);
    expect(done.length).toBeGreaterThan(0);
    // REVIEW owns nothing of its own and is not a "completed step" to show.
    expect(done).not.toContain('REVIEW');
  });

  it('does not count a step that still has an unmet requirement', () => {
    const r = buildReview(source({ issues: [{ field: 'bio', code: 'REQUIRED' }] }));
    expect(group(r, 'COMPLETE').items.map((i) => i.step)).not.toContain('PROFILE');
  });
});

describe('an already-submitted application', () => {
  it('reports its lifecycle state so the screen can stop offering a button', () => {
    const r = buildReview(source({ lifecycleState: 'DOCUMENTS_REQUIRED' }));
    expect(r.lifecycleState).toBe('DOCUMENTS_REQUIRED');
  });
});
