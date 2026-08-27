import { describe, expect, it } from 'vitest';

import {
  deriveVerificationView,
  type VerificationInput,
  type VerificationViewState,
} from './verification-view-state';

// Sprint 9B.11 — every provider verification state, decided without React.
//
// The states are NOT mutually exclusive in the raw data: a suspended provider
// can also have a case in review and a quarantined file. Precedence is the
// policy, and it is asserted here rather than re-derived by each branch of a
// component — which is how a suspended provider ends up shown an upload button.

const CAPS = (over: Partial<{ allowed: string[]; primaryReason: string | null }> = {}) =>
  ({
    capabilities: [],
    allowed: over.allowed ?? [],
    nextActions: [],
    primaryReason: over.primaryReason ?? null,
  }) as unknown as VerificationInput['capabilities'];

const doc = (over: Record<string, unknown> = {}) =>
  ({
    id: 'd1',
    kind: 'INDIVIDUAL_IDENTITY',
    serviceCategoryId: null,
    scanState: 'CLEAN',
    uploadedAt: '2026-08-01T00:00:00.000Z',
    superseded: false,
    ...over,
  }) as never;

const req = (over: Record<string, unknown> = {}) =>
  ({ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, ...over }) as never;

const kase = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    state: 'DRAFT',
    policyVersion: 'v1',
    createdAt: '2026-08-01T00:00:00.000Z',
    submittedAt: null,
    verificationRequired: true,
    requirements: [req()],
    documents: [],
    latestDecision: null,
    ...over,
  }) as never;

const PROFILE = { verified: false, topPro: false };

function stateOf(input: Partial<VerificationInput>): VerificationViewState {
  return deriveVerificationView({
    capabilities: CAPS(),
    verificationCase: null,
    profile: PROFILE,
    ...input,
  }).state;
}

describe('the account outranks everything', () => {
  it.each([
    ['ACCOUNT_INELIGIBLE', 'ACCOUNT_LOCKED'],
    ['PROVIDER_TERMINATED', 'ACCOUNT_LOCKED'],
    ['PROVIDER_SUSPENDED', 'SUSPENDED'],
  ])('%s wins over a case in review', (reason, expected) => {
    // A suspended provider with work in review must not be shown the review
    // screen: the honest message is about the suspension, and an upload button
    // here invites work the API will refuse.
    expect(
      stateOf({
        capabilities: CAPS({ primaryReason: reason }),
        verificationCase: kase({ state: 'IN_REVIEW' }),
      }),
    ).toBe(expected);
  });

  it('wins even over a quarantined document', () => {
    expect(
      stateOf({
        capabilities: CAPS({ primaryReason: 'PROVIDER_SUSPENDED' }),
        verificationCase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }),
      }),
    ).toBe('SUSPENDED');
  });

  it('onboarding outranks verification, because it is the task they are on', () => {
    expect(
      stateOf({
        capabilities: CAPS({ primaryReason: 'ONBOARDING_INCOMPLETE' }),
        verificationCase: kase({ state: 'SUBMITTED' }),
      }),
    ).toBe('ONBOARDING_INCOMPLETE');
  });
});

describe('before there is a case', () => {
  it('is NOT_STARTED with no case at all', () => {
    expect(stateOf({ verificationCase: null })).toBe('NOT_STARTED');
  });

  it('is NOT_REQUIRED when the policy asks for nothing', () => {
    // Telling a provider to "start verification" that does not apply to them
    // is a dead end with no exit.
    expect(
      stateOf({ verificationCase: kase({ verificationRequired: false, requirements: [] }) }),
    ).toBe('NOT_REQUIRED');
  });
});

describe('while the provider still has to act', () => {
  it('asks for the documents that are missing', () => {
    expect(stateOf({ verificationCase: kase({ requirements: [req()], documents: [] }) })).toBe(
      'EVIDENCE_REQUIRED',
    );
  });

  it('is READY_TO_SUBMIT once every requirement has a clean document', () => {
    expect(stateOf({ verificationCase: kase({ requirements: [req()], documents: [doc()] }) })).toBe(
      'READY_TO_SUBMIT',
    );
  });

  it('is SCANNING when everything is supplied but not yet cleared', () => {
    // "Wait" is a different instruction from "act", and the difference matters
    // to someone refreshing the page.
    expect(
      stateOf({
        verificationCase: kase({
          requirements: [req()],
          documents: [doc({ scanState: 'CLEAN' }), doc({ id: 'd2', scanState: 'PENDING' })],
        }),
      }),
    ).toBe('SCANNING');
  });

  it.each(['QUARANTINED', 'SCAN_FAILED', 'REJECTED'])(
    'a %s document outranks everything else the provider could do',
    (scanState) => {
      // The one thing they must replace. Burying it under "3 documents
      // required" hides the only actionable fact on the screen.
      expect(
        stateOf({
          verificationCase: kase({
            requirements: [req(), req({ kind: 'BUSINESS_REGISTRATION' })],
            documents: [doc({ scanState })],
          }),
        }),
      ).toBe('EVIDENCE_UNUSABLE');
    },
  );

  it('a PENDING document is NOT unusable — it is a wait, not a problem', () => {
    expect(
      stateOf({
        verificationCase: kase({
          requirements: [req()],
          documents: [doc({ scanState: 'PENDING' })],
        }),
      }),
    ).toBe('EVIDENCE_REQUIRED');
  });

  it('a superseded bad document does not block a good replacement', () => {
    // Replace-and-resubmit: the old file stays visible for history, and must
    // not keep the provider stuck on a problem they already fixed.
    expect(
      stateOf({
        verificationCase: kase({
          requirements: [req()],
          documents: [doc({ scanState: 'QUARANTINED', superseded: true }), doc({ id: 'd2' })],
        }),
      }),
    ).toBe('READY_TO_SUBMIT');
  });
});

describe('a trade licence is per category', () => {
  it('does not let one category’s licence satisfy another’s', () => {
    // A plumber's licence standing in for an electrician's is the kind of
    // substitution that reads fine in code and is wrong in the world.
    expect(
      stateOf({
        verificationCase: kase({
          requirements: [req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' })],
          documents: [doc({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing' })],
        }),
      }),
    ).toBe('EVIDENCE_REQUIRED');
  });

  it('accepts the licence for the right category', () => {
    expect(
      stateOf({
        verificationCase: kase({
          requirements: [req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' })],
          documents: [doc({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' })],
        }),
      }),
    ).toBe('READY_TO_SUBMIT');
  });
});

describe('while it is with a reviewer', () => {
  it.each(['SUBMITTED', 'IN_REVIEW'])('%s is one PENDING_REVIEW screen', (state) => {
    // The provider does not need to know whether a human has opened it yet.
    expect(stateOf({ verificationCase: kase({ state }) })).toBe('PENDING_REVIEW');
  });

  it('ACTION_REQUIRED is CHANGES_REQUESTED and carries the reason code', () => {
    const view = deriveVerificationView({
      capabilities: CAPS(),
      profile: PROFILE,
      verificationCase: kase({
        state: 'ACTION_REQUIRED',
        latestDecision: {
          outcome: 'ACTION_REQUIRED',
          reasonCode: 'DOCUMENT_ILLEGIBLE',
          decidedAt: '2026-08-02T00:00:00.000Z',
        },
      }),
    });
    expect(view.state).toBe('CHANGES_REQUESTED');
    expect(view.reasonCode).toBe('DOCUMENT_ILLEGIBLE');
  });

  it('REJECTED is its own screen', () => {
    expect(stateOf({ verificationCase: kase({ state: 'REJECTED' }) })).toBe('REJECTED');
  });
});

describe('verified, and whether they may actually work', () => {
  it('VERIFIED with a live grant is VERIFIED_ACTIVE', () => {
    expect(
      stateOf({
        capabilities: CAPS({ allowed: ['SUBMIT_BID'] }),
        verificationCase: kase({ state: 'VERIFIED' }),
      }),
    ).toBe('VERIFIED_ACTIVE');
  });

  it('VERIFIED without a grant is VERIFIED_NO_ACCESS, not un-verified', () => {
    // The distinction the whole sprint turns on. A provider whose grant lapsed
    // is verified AND cannot work; telling them they are unverified would send
    // them to re-upload documents that are perfectly good.
    expect(
      stateOf({
        capabilities: CAPS({ allowed: [] }),
        verificationCase: kase({ state: 'VERIFIED' }),
      }),
    ).toBe('VERIFIED_NO_ACCESS');
  });

  it('an EXPIRED case is also VERIFIED_NO_ACCESS', () => {
    expect(stateOf({ verificationCase: kase({ state: 'EXPIRED' }) })).toBe('VERIFIED_NO_ACCESS');
  });
});

describe('the five axes stay separate', () => {
  it('reports each axis independently', () => {
    const view = deriveVerificationView({
      capabilities: CAPS({ allowed: ['SUBMIT_BID'] }),
      verificationCase: kase({ state: 'VERIFIED' }),
      profile: { verified: true, topPro: true },
      vip: true,
    });
    expect(view.axes).toEqual({
      onboardingComplete: true,
      identityVerified: true,
      workAccessActive: true,
      vip: true,
      featured: true,
    });
  });

  it('work access is read from the GRANT, not from `verified`', () => {
    // Two different facts. Reading one from the other is the conflation ADR
    // 0005 exists to prevent.
    const view = deriveVerificationView({
      capabilities: CAPS({ allowed: [] }),
      verificationCase: kase({ state: 'VERIFIED' }),
      profile: { verified: true, topPro: false },
    });
    expect(view.axes.identityVerified).toBe(true);
    expect(view.axes.workAccessActive).toBe(false);
  });

  it.each([
    ['vip', { vip: true }],
    ['featured', { profile: { verified: false, topPro: true } }],
  ])('%s never changes the resulting state', (_label, extra) => {
    // ADR 0005 axis 5: a paid tier or an editorial flag must never grant a
    // capability. If either could move this state machine, it would be
    // granting one.
    const baseline = stateOf({ verificationCase: kase({ requirements: [req()], documents: [] }) });
    const withExtra = stateOf({
      verificationCase: kase({ requirements: [req()], documents: [] }),
      profile: PROFILE,
      ...(extra as object),
    });
    expect(withExtra).toBe(baseline);
  });
});

describe('every declared state is reachable', () => {
  it('covers the whole union', () => {
    // Non-vacuity for the type: a state nobody can reach is a screen nobody
    // will ever see, and it would sit in the copy file forever.
    const reached = new Set<VerificationViewState>([
      stateOf({ capabilities: CAPS({ primaryReason: 'ACCOUNT_INELIGIBLE' }) }),
      stateOf({ capabilities: CAPS({ primaryReason: 'PROVIDER_SUSPENDED' }) }),
      stateOf({ capabilities: CAPS({ primaryReason: 'ONBOARDING_INCOMPLETE' }) }),
      stateOf({ verificationCase: null }),
      stateOf({ verificationCase: kase({ verificationRequired: false }) }),
      stateOf({ verificationCase: kase({ documents: [] }) }),
      stateOf({
        verificationCase: kase({ documents: [doc({ scanState: 'PENDING' })], requirements: [] }),
      }),
      stateOf({ verificationCase: kase({ documents: [doc({ scanState: 'QUARANTINED' })] }) }),
      stateOf({ verificationCase: kase({ documents: [doc()] }) }),
      stateOf({ verificationCase: kase({ state: 'SUBMITTED' }) }),
      stateOf({ verificationCase: kase({ state: 'ACTION_REQUIRED' }) }),
      stateOf({ verificationCase: kase({ state: 'REJECTED' }) }),
      stateOf({
        capabilities: CAPS({ allowed: ['SUBMIT_BID'] }),
        verificationCase: kase({ state: 'VERIFIED' }),
      }),
      stateOf({ verificationCase: kase({ state: 'VERIFIED' }) }),
    ]);

    expect(reached.size).toBe(14);
  });
});

// ── Sprint 9B.13 — the shape that actually arrives on the wire ────────────
//
// Every fixture above is contract-shaped, which is exactly why this file was
// green while the provider verification screen crashed in production. The API
// published `requirements: ProviderVerificationRequirement[]` and sent
//
//   requirements: { requirements: [...], policyVersion, verificationRequired }
//
// for three sprints. An object is truthy, so `kase?.requirements ?? []` passed
// it through, and `.filter` threw. Nothing here could have caught that,
// because nothing here ever asked what the server really sends.
//
// The API is fixed and the compiler now guards it. These tests cover the half
// a client can control: what this function does with a payload it did not
// expect, and that the ordinary shapes still behave.

describe('what a real case carries', () => {
  it('reads an empty requirement list as nothing outstanding', () => {
    const view = deriveVerificationView({
      capabilities: CAPS(),
      verificationCase: kase({ requirements: [], documents: [] }),
      profile: PROFILE,
    });
    expect(view.outstanding).toEqual([]);
  });

  it('keeps every requirement with its own category', () => {
    // Two licences for two different trades are two different obligations, and
    // collapsing them by kind would tell a plumber-electrician they were done
    // after sending one certificate.
    const view = deriveVerificationView({
      capabilities: CAPS(),
      verificationCase: kase({
        requirements: [
          req(),
          req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing' }),
          req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' }),
        ],
        documents: [],
      }),
      profile: PROFILE,
    });

    expect(view.outstanding).toHaveLength(3);
    expect(view.outstanding.map((r) => r.serviceCategoryId)).toEqual([
      null,
      'cat-plumbing',
      'cat-electrical',
    ]);
  });

  it('a document satisfies only the requirement it was sent for', () => {
    const view = deriveVerificationView({
      capabilities: CAPS(),
      verificationCase: kase({
        requirements: [
          req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing' }),
          req({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-electrical' }),
        ],
        documents: [
          doc({ kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-plumbing', scanState: 'CLEAN' }),
        ],
      }),
      profile: PROFILE,
    });

    expect(view.outstanding).toHaveLength(1);
    expect(view.outstanding[0].serviceCategoryId).toBe('cat-electrical');
  });
});

describe('a payload the server should not have sent', () => {
  it.each([
    ['the nested snapshot that actually shipped', { requirements: [req()], policyVersion: 'v1' }],
    ['null', null],
    ['a string', 'INDIVIDUAL_IDENTITY'],
    ['a number', 7],
  ])('survives requirements as %s', (_label, requirements) => {
    // Not a hypothetical: the first row is the exact object the API sent for
    // three sprints. A blank checklist is recoverable; a white screen on the
    // one page that tells a provider what to do next is not.
    expect(() =>
      deriveVerificationView({
        capabilities: CAPS(),
        verificationCase: kase({ requirements }),
        profile: PROFILE,
      }),
    ).not.toThrow();

    const view = deriveVerificationView({
      capabilities: CAPS(),
      verificationCase: kase({ requirements }),
      profile: PROFILE,
    });
    expect(view.outstanding).toEqual([]);
  });

  it('survives documents arriving as something other than a list', () => {
    expect(() =>
      deriveVerificationView({
        capabilities: CAPS(),
        verificationCase: kase({ documents: { 0: doc() } }),
        profile: PROFILE,
      }),
    ).not.toThrow();
  });
});
