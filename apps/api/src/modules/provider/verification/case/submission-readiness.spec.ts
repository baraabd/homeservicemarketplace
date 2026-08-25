import type { VerificationCaseState } from '@homeservicemarketplace/database';

import { assessSubmissionReadiness, type SubmissionBlocker } from './submission-readiness';

// Sprint 9B.5 — may this case be submitted?
//
// Recomputed on the server at submission time, never trusted from the client
// (ADR 0010 §5). The interesting part is not "is it ready" — it is WHY NOT,
// because the answer is shown to a provider who has to act on it, and
// "something is wrong" is not an instruction.
//
// Two distinctions this file exists to protect:
//
//   MISSING_EVIDENCE vs EVIDENCE_NOT_CLEAN — "upload a licence" and "the
//   licence you uploaded has not cleared scanning yet" are different problems
//   with different fixes, and collapsing them sends providers to re-upload
//   files that were fine.
//
//   ALL blockers, not the first — a provider told about one missing document
//   at a time will submit four times and get four rejections.

const REQS = {
  policyVersion: 'p1',
  verificationRequired: true,
  requirements: [
    { kind: 'INDIVIDUAL_IDENTITY' as const, serviceCategoryId: null, fromVersion: 'p1' },
    { kind: 'CATEGORY_LICENSE' as const, serviceCategoryId: 'cat-elec', fromVersion: 'p1' },
  ],
};

/** A candidate the REAL onboarding policy considers complete. Built to that
 *  policy's shape on purpose: a local approximation of "complete" is the second
 *  definition this module exists to avoid. */
const COMPLETE_ONBOARDING = {
  displayName: 'Ahmad Plumbing Services',
  headline: 'Experienced plumber serving Aleppo and surrounds',
  bio: 'Fifteen years of residential and commercial plumbing across Aleppo, including emergency callouts and full bathroom installations.',
  phoneNumber: '+963900000000',
  serviceAreaCity: 'Aleppo',
  serviceAreaCountry: 'SY',
  serviceAreaRadiusKm: 25,
  serviceCategoryCount: 2,
  emailVerified: true,
};

function clean(kind: 'INDIVIDUAL_IDENTITY' | 'CATEGORY_LICENSE', cat: string | null = null) {
  return { kind, serviceCategoryId: cat, scanState: 'CLEAN' };
}

function assess(over: Partial<Parameters<typeof assessSubmissionReadiness>[0]> = {}) {
  return assessSubmissionReadiness({
    state: 'DRAFT',
    requirements: REQS,
    documents: [clean('INDIVIDUAL_IDENTITY'), clean('CATEGORY_LICENSE', 'cat-elec')],
    onboarding: COMPLETE_ONBOARDING,
    terms: { requiredVersion: 'terms-2026-01', acceptedVersion: 'terms-2026-01' },
    ...over,
  });
}

const codes = (b: SubmissionBlocker[]) => b.map((x) => x.code).sort();

describe('a case that is ready', () => {
  it('reports ready with no blockers', () => {
    const r = assess();
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it('is ready from ACTION_REQUIRED too — resubmission is the same edge', () => {
    expect(assess({ state: 'ACTION_REQUIRED' }).ready).toBe(true);
  });

  it('ignores extra documents nothing asked for', () => {
    // A provider who uploaded a licence for a category they later dropped is
    // not blocked by it.
    const r = assess({
      documents: [
        clean('INDIVIDUAL_IDENTITY'),
        clean('CATEGORY_LICENSE', 'cat-elec'),
        clean('CATEGORY_LICENSE', 'cat-gas'),
      ],
    });
    expect(r.ready).toBe(true);
  });

  it('is satisfied by a CLEAN copy sitting beside a rejected one', () => {
    // The provider whose first upload was corrupt and who re-sent it
    // successfully. Blocking here would be punishing them for our own
    // rejection.
    const r = assess({
      documents: [
        { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, scanState: 'REJECTED' },
        clean('INDIVIDUAL_IDENTITY'),
        clean('CATEGORY_LICENSE', 'cat-elec'),
      ],
    });
    expect(r.ready).toBe(true);
  });
});

describe('the state has to allow it', () => {
  it.each(['SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'] as VerificationCaseState[])(
    'refuses submission from %s',
    (state) => {
      const r = assess({ state });
      expect(r.ready).toBe(false);
      expect(codes(r.blockers)).toContain('WRONG_STATE');
    },
  );

  it('reports ONLY the state problem when the case is already submitted', () => {
    // Telling someone their documents are incomplete on a case a reviewer is
    // already holding is noise: the fix is to wait, not to upload.
    const r = assess({ state: 'IN_REVIEW', documents: [] });
    expect(codes(r.blockers)).toEqual(['WRONG_STATE']);
  });
});

describe('evidence', () => {
  it('reports a requirement with no document at all as MISSING', () => {
    const r = assess({ documents: [clean('INDIVIDUAL_IDENTITY')] });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([
      expect.objectContaining({
        code: 'MISSING_EVIDENCE',
        kind: 'CATEGORY_LICENSE',
        serviceCategoryId: 'cat-elec',
      }),
    ]);
  });

  it.each(['PENDING', 'QUARANTINED', 'SCAN_FAILED', 'REJECTED'])(
    'reports a %s document as NOT_CLEAN rather than missing',
    (scanState) => {
      const r = assess({
        documents: [
          clean('INDIVIDUAL_IDENTITY'),
          { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-elec', scanState },
        ],
      });
      expect(r.ready).toBe(false);
      expect(r.blockers).toEqual([
        expect.objectContaining({
          code: 'EVIDENCE_NOT_CLEAN',
          kind: 'CATEGORY_LICENSE',
          scanState,
        }),
      ]);
    },
  );

  it('does not let a licence for one category satisfy another', () => {
    const r = assess({
      documents: [clean('INDIVIDUAL_IDENTITY'), clean('CATEGORY_LICENSE', 'cat-gas')],
    });
    expect(r.blockers).toEqual([
      expect.objectContaining({ code: 'MISSING_EVIDENCE', serviceCategoryId: 'cat-elec' }),
    ]);
  });

  it('reports every unsatisfied requirement at once', () => {
    const r = assess({ documents: [] });
    expect(r.blockers).toHaveLength(2);
    expect(r.blockers.every((b) => b.code === 'MISSING_EVIDENCE')).toBe(true);
  });

  it('is ready when the policy requires nothing', () => {
    const r = assess({
      requirements: { policyVersion: 'p1', verificationRequired: false, requirements: [] },
      documents: [],
    });
    expect(r.ready).toBe(true);
  });
});

describe('onboarding and terms', () => {
  it('blocks when onboarding is incomplete, naming the field', () => {
    const r = assess({ onboarding: { ...COMPLETE_ONBOARDING, displayName: '   ' } });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([
      expect.objectContaining({ code: 'ONBOARDING_INCOMPLETE', field: 'displayName' }),
    ]);
  });

  it('reuses the onboarding policy rather than re-deciding what complete means', () => {
    // Two definitions of "complete profile" is how a provider passes one screen
    // and is refused by the next.
    const r = assess({ onboarding: { ...COMPLETE_ONBOARDING, serviceCategoryCount: 0 } });
    expect(r.blockers).toEqual([
      expect.objectContaining({ code: 'ONBOARDING_INCOMPLETE', field: 'serviceCategories' }),
    ]);
  });

  it('blocks when the accepted terms version is not the required one', () => {
    const r = assess({
      terms: { requiredVersion: 'terms-2026-06', acceptedVersion: 'terms-2026-01' },
    });
    expect(r.blockers).toEqual([
      expect.objectContaining({ code: 'TERMS_NOT_ACCEPTED', requiredVersion: 'terms-2026-06' }),
    ]);
  });

  it('blocks when no terms have been accepted at all', () => {
    const r = assess({ terms: { requiredVersion: 'terms-2026-01', acceptedVersion: null } });
    expect(codes(r.blockers)).toEqual(['TERMS_NOT_ACCEPTED']);
  });

  it('does not invent a terms requirement when none is configured', () => {
    const r = assess({ terms: { requiredVersion: null, acceptedVersion: null } });
    expect(r.ready).toBe(true);
  });
});

describe('everything at once', () => {
  it('returns all blockers together, so one round trip lists the whole job', () => {
    const r = assess({
      documents: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, scanState: 'PENDING' }],
      onboarding: { ...COMPLETE_ONBOARDING, displayName: '' },
      terms: { requiredVersion: 'terms-2026-06', acceptedVersion: null },
    });

    expect(r.ready).toBe(false);
    expect(codes(r.blockers)).toEqual([
      'EVIDENCE_NOT_CLEAN',
      'MISSING_EVIDENCE',
      'ONBOARDING_INCOMPLETE',
      'TERMS_NOT_ACCEPTED',
    ]);
  });

  it('names no filename, storage key or hash in any blocker', () => {
    // Blockers are rendered, logged and may reach a support ticket.
    const r = assess({ documents: [] });
    const text = JSON.stringify(r.blockers);
    expect(text).not.toMatch(/\.pdf|\.png|verification\/|[0-9a-f]{64}/);
  });
});
