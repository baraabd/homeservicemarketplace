import { buildHub } from './hub/onboarding-hub-resolver';
import { buildReview } from './review/onboarding-review-resolver';
import {
  evaluateOnboarding,
  providerActionIssues,
  type OnboardingCandidate,
} from './provider-onboarding.policy';

// Sprint 09B.29, Phase 3 — the pending-specialty moderation deadlock.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// WHY THIS FILE EXISTS SEPARATELY
//
// The repair spans five decision sites in three modules. Asserting it only
// inside each module's own spec proves each layer in isolation and proves
// nothing about them agreeing, which is the property that actually failed: the
// policy said "waiting on us", the hub turned that into "blocked", and the
// review screen turned it into "cannot submit". So the matrix below drives the
// POLICY, the HUB and the REVIEW resolver from one candidate and asserts all
// three answers together.
//
// TEST SENSITIVITY
//
// Every case here is written to fail if `AWAITING_REVIEW` is treated as a
// provider-action blocker. That was proved by mutation rather than asserted:
// `isProviderActionIssue` was forced to `true` in an isolated worktree and this
// file was re-run — see SPRINT_09B29_VERIFICATION.md §3.3 for the before/after
// artefacts. Cases that must hold under BOTH behaviours (the control cases) are
// marked, so a reader can tell which lines carry the regression and which guard
// it.
//
// The specialty axis is modelled the way the wizard reports it:
//   leafSpecialtyCount    granted leaves       — an APPROVED application
//   pendingSpecialtyCount applications open    — a PENDING application
//   serviceCategoryCount  every granted row    — legacy roots included
// A REJECTED application is neither granted nor pending, so it is simply
// absent from all three, which is exactly how a historical rejection should
// behave.

/** Everything the policy asks for EXCEPT the specialty axis, which each case
 *  sets deliberately. */
function candidate(over: Partial<OnboardingCandidate> = {}): OnboardingCandidate {
  return {
    displayName: 'Nadia Haddad',
    headline: 'Certified electrician for homes and small businesses',
    bio: 'Twelve years of residential and light commercial electrical work, including rewiring and fault finding.',
    phoneNumber: '+963900000777',
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'SY',
    serviceAreaRadiusKm: 20,
    emailVerified: true,
    providerType: 'INDIVIDUAL',
    yearsOfExperience: 12,
    availabilityIntervalCount: 1,
    acceptedConsentVersion: 'v1',
    // The specialty axis defaults to "one approved", so the base candidate is a
    // provider with nothing outstanding at all. Every case below overrides
    // these three deliberately, and `serviceCategoryCount` is required by
    // `OnboardingCandidate` rather than optional — omitting it compiled under
    // ts-jest and failed `tsc --noEmit`, which is why it is set here.
    serviceCategoryCount: 1,
    leafSpecialtyCount: 1,
    pendingSpecialtyCount: 0,
    ...over,
  };
}

/** No specialty chosen at all. */
const NOTHING_CHOSEN = () =>
  candidate({ serviceCategoryCount: 0, leafSpecialtyCount: 0, pendingSpecialtyCount: 0 });
/** One application open, nothing granted. */
const ONE_PENDING = () =>
  candidate({ serviceCategoryCount: 0, leafSpecialtyCount: 0, pendingSpecialtyCount: 1 });
/** One application approved. */
const ONE_APPROVED = () =>
  candidate({ serviceCategoryCount: 1, leafSpecialtyCount: 1, pendingSpecialtyCount: 0 });
/** One approved and a second still open. */
const APPROVED_PLUS_PENDING = () =>
  candidate({ serviceCategoryCount: 1, leafSpecialtyCount: 1, pendingSpecialtyCount: 1 });

const TERMS_OK = {
  version: 'v1',
  locale: 'en' as const,
  accepted: true,
  acceptedVersion: 'v1',
  acceptedAt: '2026-01-01T00:00:00.000Z',
};

const hubOf = (c: OnboardingCandidate, lifecycleState = 'DRAFT') =>
  buildHub({ issues: evaluateOnboarding(c), lifecycleState });

const reviewOf = (c: OnboardingCandidate, over: Record<string, unknown> = {}) =>
  buildReview({
    issues: evaluateOnboarding(c),
    lifecycleState: 'DRAFT',
    draftVersion: 7,
    terms: TERMS_OK,
    pendingSpecialtyCount: c.pendingSpecialtyCount ?? 0,
    awaitingPortfolioReviewCount: 0,
    portfolioEmpty: false,
    ...over,
  });

const taskOf = (hub: ReturnType<typeof buildHub>, id: string) =>
  hub.tasks.find((t) => t.id === id)!;
const itemsOf = (r: ReturnType<typeof buildReview>, kind: string) =>
  r.groups.find((g) => g.kind === kind)!.items;
const codesOf = (c: OnboardingCandidate) => evaluateOnboarding(c).map((i) => i.code);

// ── 1. no selected specialty ────────────────────────────────────────────────
//
// CONTROL CASE: holds under both the old and the repaired behaviour. It is the
// guard that stops the repair being read as "pending applications are ignored".
describe('1 — no specialty selected', () => {
  it('is provider-incomplete, and says REQUIRED rather than AWAITING_REVIEW', () => {
    expect(codesOf(NOTHING_CHOSEN())).toContain('REQUIRED');
    expect(codesOf(NOTHING_CHOSEN())).not.toContain('AWAITING_REVIEW');
    expect(providerActionIssues(evaluateOnboarding(NOTHING_CHOSEN())).length).toBeGreaterThan(0);
  });

  it('blocks review and submission', () => {
    const hub = hubOf(NOTHING_CHOSEN());
    expect(taskOf(hub, 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
    expect(reviewOf(NOTHING_CHOSEN()).canSubmit).toBe(false);
  });

  it('points the next action at the services task', () => {
    expect(hubOf(NOTHING_CHOSEN()).nextAction).toEqual({
      kind: 'COMPLETE_TASK',
      taskId: 'SERVICES_EXPERIENCE',
    });
  });
});

// ── 2. one PENDING specialty ────────────────────────────────────────────────
//
// THE REGRESSION. Every assertion here fails if AWAITING_REVIEW is treated as
// a provider-action blocker.
describe('2 — one PENDING specialty', () => {
  it('reports the provider’s services input as complete', () => {
    expect(providerActionIssues(evaluateOnboarding(ONE_PENDING()))).toEqual([]);
  });

  it('still reports the moderation issue — the policy is not weakened', () => {
    expect(codesOf(ONE_PENDING())).toContain('AWAITING_REVIEW');
  });

  it('shows the services task as WAITING and counts it as done', () => {
    const hub = hubOf(ONE_PENDING());
    expect(taskOf(hub, 'SERVICES_EXPERIENCE').status).toBe('WAITING');
    expect(hub.progress).toEqual({ complete: 5, total: 6 });
  });

  it('opens final review and does not make the waiting task the next action', () => {
    const hub = hubOf(ONE_PENDING());
    expect(taskOf(hub, 'REVIEW_SUBMISSION').status).toBe('AVAILABLE');
    expect(hub.nextAction).toEqual({ kind: 'SUBMIT' });
  });

  it('allows submission once terms are accepted, with no blocking reason', () => {
    const r = reviewOf(ONE_PENDING());
    expect(r.canSubmit).toBe(true);
    expect(r.blockedReason).toBeNull();
  });

  it('represents moderation on the WAITING axis and never as a blocker', () => {
    const r = reviewOf(ONE_PENDING());
    expect(itemsOf(r, 'WAITING').map((i) => i.code)).toContain('SPECIALTY_REVIEW');
    expect(itemsOf(r, 'BLOCKING').map((i) => i.code)).not.toContain('AWAITING_REVIEW');
  });

  it('keeps WAITING distinct from COMPLETE, so approval is still visible as a change', () => {
    // If WAITING collapsed into COMPLETE the provider could never tell the
    // difference between "we are looking at it" and "it was approved".
    expect(taskOf(hubOf(ONE_PENDING()), 'SERVICES_EXPERIENCE').status).toBe('WAITING');
    expect(taskOf(hubOf(ONE_APPROVED()), 'SERVICES_EXPERIENCE').status).toBe('COMPLETE');
  });
});

// ── 3. one APPROVED specialty ───────────────────────────────────────────────
describe('3 — one APPROVED specialty', () => {
  it('is provider-complete with no moderation item at all', () => {
    expect(evaluateOnboarding(ONE_APPROVED())).toEqual([]);
  });

  it('opens review and submission', () => {
    const hub = hubOf(ONE_APPROVED());
    expect(taskOf(hub, 'SERVICES_EXPERIENCE').status).toBe('COMPLETE');
    expect(taskOf(hub, 'REVIEW_SUBMISSION').status).toBe('AVAILABLE');
    expect(reviewOf(ONE_APPROVED()).canSubmit).toBe(true);
  });

  it('reports nothing on the WAITING axis', () => {
    expect(itemsOf(reviewOf(ONE_APPROVED()), 'WAITING')).toEqual([]);
  });
});

// ── 4. an active REJECTED selection ─────────────────────────────────────────
//
// CONTROL CASE. A rejected application is neither granted nor pending, so the
// provider is back to having chosen nothing — which is provider work, with a
// deep link to the screen where they choose again.
describe('4 — the only selection was REJECTED', () => {
  const rejectedOnly = NOTHING_CHOSEN;

  it('requires provider action, not moderation waiting', () => {
    expect(codesOf(rejectedOnly())).toContain('REQUIRED');
    expect(codesOf(rejectedOnly())).not.toContain('AWAITING_REVIEW');
  });

  it('deep-links to the services task and blocks review', () => {
    const r = reviewOf(rejectedOnly());
    expect(r.canSubmit).toBe(false);
    const blocker = itemsOf(r, 'BLOCKING').find((i) => i.field === 'specialties');
    expect(blocker?.taskId).toBe('SERVICES_EXPERIENCE');
    expect(taskOf(hubOf(rejectedOnly()), 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
  });
});

// ── 5. a historical rejection, no longer the current selection ──────────────
describe('5 — a historical REJECTED application alongside a granted one', () => {
  it('adds no current blocker: the granted specialty is what counts', () => {
    // The rejected row is history. It is neither granted nor pending, so it
    // contributes nothing to the candidate and cannot deadlock the draft.
    expect(evaluateOnboarding(ONE_APPROVED())).toEqual([]);
    expect(reviewOf(ONE_APPROVED()).canSubmit).toBe(true);
  });
});

// ── 6. mixed APPROVED and PENDING ───────────────────────────────────────────
describe('6 — one APPROVED and one PENDING', () => {
  it('is provider-complete', () => {
    expect(providerActionIssues(evaluateOnboarding(APPROVED_PLUS_PENDING()))).toEqual([]);
  });

  it('represents the outstanding moderation accurately', () => {
    // The granted specialty satisfies the requirement, so the policy raises no
    // issue at all — and the pending application is still reported, from the
    // count rather than from an issue.
    expect(evaluateOnboarding(APPROVED_PLUS_PENDING())).toEqual([]);
    expect(itemsOf(reviewOf(APPROVED_PLUS_PENDING()), 'WAITING').map((i) => i.code)).toContain(
      'SPECIALTY_REVIEW',
    );
  });

  it('does not deadlock submission', () => {
    expect(reviewOf(APPROVED_PLUS_PENDING()).canSubmit).toBe(true);
    expect(hubOf(APPROVED_PLUS_PENDING()).nextAction).toEqual({ kind: 'SUBMIT' });
  });
});

// ── 7. mixed PENDING and historical REJECTED ────────────────────────────────
describe('7 — one PENDING and a historical REJECTED', () => {
  it('behaves exactly as a single PENDING: history does not deadlock the draft', () => {
    const c = ONE_PENDING();
    expect(providerActionIssues(evaluateOnboarding(c))).toEqual([]);
    expect(reviewOf(c).canSubmit).toBe(true);
    expect(taskOf(hubOf(c), 'SERVICES_EXPERIENCE').status).toBe('WAITING');
  });
});

// ── 10. terms missing ───────────────────────────────────────────────────────
//
// CONTROL CASE. Consent is the provider's move and must still block, and the
// reason given must be consent — never the moderation item.
describe('10 — terms not accepted, moderation pending', () => {
  it('blocks submission for the terms, not for the pending specialty', () => {
    const r = reviewOf(ONE_PENDING(), {
      terms: { ...TERMS_OK, accepted: false, acceptedVersion: null },
    });
    expect(r.canSubmit).toBe(false);
    expect(itemsOf(r, 'BLOCKING').map((i) => i.code)).not.toContain('AWAITING_REVIEW');
    expect(itemsOf(r, 'BLOCKING').map((i) => i.field)).toContain('acceptedConsentVersion');
  });
});

// ── 11. another missing required input ──────────────────────────────────────
//
// CONTROL CASE. A real gap still blocks while moderation is pending, and the
// refusal names only what the provider can act on.
describe('11 — a provider-actionable field is missing while moderation is pending', () => {
  const withGap = () => ({ ...ONE_PENDING(), bio: null });

  it('remains blocked, naming the field and not the queue', () => {
    const actionable = providerActionIssues(evaluateOnboarding(withGap()));
    expect(actionable.map((i) => i.field)).toContain('bio');
    expect(actionable.map((i) => i.code)).not.toContain('AWAITING_REVIEW');
  });

  it('blocks review and reports the provider’s own field as the reason', () => {
    const r = reviewOf(withGap());
    expect(r.canSubmit).toBe(false);
    expect(r.blockedReason?.field).toBe('bio');
  });

  it('keeps the services task WAITING even though another task is outstanding', () => {
    // The two axes are independent: an unrelated gap does not turn our
    // approval back into their homework.
    const hub = hubOf(withGap());
    expect(taskOf(hub, 'SERVICES_EXPERIENCE').status).toBe('WAITING');
    expect(taskOf(hub, 'PORTFOLIO').status).toBe('AVAILABLE');
    expect(taskOf(hub, 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
  });
});

// ── the hub contract, stated as its own assertions ──────────────────────────
describe('hub contract — both facts are reported at once', () => {
  it('says provider input is complete AND moderation is pending, simultaneously', () => {
    const hub = hubOf(ONE_PENDING());
    const services = taskOf(hub, 'SERVICES_EXPERIENCE');
    // provider input complete: counted, and not the next action
    expect(hub.progress.complete).toBe(5);
    expect(hub.nextAction).not.toEqual({
      kind: 'COMPLETE_TASK',
      taskId: 'SERVICES_EXPERIENCE',
    });
    // moderation pending: a status distinct from COMPLETE and from AVAILABLE
    expect(services.status).toBe('WAITING');
    expect(services.status).not.toBe('COMPLETE');
    expect(services.status).not.toBe('AVAILABLE');
  });

  it('a submitted application still makes every task WAITING', () => {
    // The lifecycle axis outranks the issue axis, unchanged by this phase.
    for (const t of hubOf(ONE_PENDING(), 'SUBMITTED').tasks) expect(t.status).toBe('WAITING');
  });
});
