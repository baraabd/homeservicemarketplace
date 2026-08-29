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
