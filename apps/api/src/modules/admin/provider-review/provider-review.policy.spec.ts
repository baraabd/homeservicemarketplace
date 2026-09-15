import { reviewFixture } from '../../../../test/fixtures/admin-provider-review.fixture';
import { reviewBlockers, reviewRevision, stableReviewJson } from './provider-review.policy';

const now = new Date('2026-09-15T12:01:00Z');
const codes = (data: ReturnType<typeof reviewFixture>, actor = 'admin-1', allowed = true) =>
  reviewBlockers(data, actor, allowed, now).map((row) => row.code);

describe('complete provider review policy', () => {
  it('requires a full submission and scoped, clean identity evidence even when the gallery is empty', () => {
    expect(codes(reviewFixture())).toEqual([]);
    const data = reviewFixture();
    data.submission!.reviewSnapshot = null;
    expect(codes(data)).toContain('SNAPSHOT_UNAVAILABLE');
  });

  it('does not activate a self-reviewed, suspended or ineligible account', () => {
    const data = reviewFixture();
    expect(codes(data, 'owner-1')).toContain('SELF_REVIEW');
    expect(codes(data, 'admin-1', false)).toContain('PERMISSION_REQUIRED');
    data.profile.user!.isActive = false;
    data.profile.standingState = 'SUSPENDED';
    expect(codes(data)).toEqual(
      expect.arrayContaining(['ACCOUNT_INELIGIBLE', 'PROVIDER_RESTRICTED']),
    );
  });

  it.each(['PENDING', 'QUARANTINED', 'REJECTED'])('refuses evidence scanned as %s', (state) => {
    const data = reviewFixture();
    data.verificationCase!.documents[0].mediaAsset.scanState = state as never;
    expect(codes(data)).toContain('EVIDENCE_NOT_READY');
  });

  it('rejects expired documents and a verified case whose own work grant expired', () => {
    const data = reviewFixture();
    data.verificationCase!.documents[0].expiresOn = new Date('2026-09-14T00:00:00Z');
    data.verificationCase!.state = 'VERIFIED';
    expect(codes(data)).toEqual(
      expect.arrayContaining(['EVIDENCE_NOT_READY', 'WORK_GRANT_REQUIRED']),
    );
  });

  it('does not confuse a new trade or changed country with already reviewed scope', () => {
    const data = reviewFixture();
    data.current.services.specialties.push({
      ...data.current.services.specialties[0],
      id: 'electricity',
    });
    expect(codes(data)).toEqual(
      expect.arrayContaining(['SUBMITTED_CONTENT_CHANGED', 'EVIDENCE_NOT_READY']),
    );
    data.current.workArea.countryCode = 'US';
    expect(codes(data)).toContain('EVIDENCE_NOT_READY');
  });

  it('requires an explicit waiver; empty unconfigured requirements are not a waiver', () => {
    const data = reviewFixture();
    const snapshot = data.verificationCase!.requirementsSnapshot as Record<string, unknown>;
    snapshot.requirements = [];
    expect(codes(data)).toContain('EVIDENCE_NOT_READY');
    snapshot.verificationRequired = false;
    expect(codes(data)).toEqual([]);
  });

  it('accepts legacy scope only from an exact reconstruction pinned to the original policy', () => {
    const data = reviewFixture();
    const snapshot = data.verificationCase!.requirementsSnapshot as Record<string, unknown>;
    delete snapshot.subjectScope;
    expect(codes(data)).toContain('EVIDENCE_NOT_READY');
    data.historicalRequirements = {
      policyVersion: 'policy-v1',
      verificationRequired: true,
      requirements: [
        { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: 'policy-v1' },
      ],
    };
    expect(codes(data)).toEqual([]);
    data.historicalRequirements.requirements.push({
      kind: 'CATEGORY_LICENSE',
      serviceCategoryId: 'plumbing',
      fromVersion: 'trade-v1',
    });
    expect(codes(data)).toContain('EVIDENCE_NOT_READY');
  });

  it('ignores a moving capture clock but detects same-timestamp document edits and ABA case changes', () => {
    const data = reviewFixture();
    const original = reviewRevision(data);
    data.current.capturedAt = new Date().toISOString();
    expect(reviewRevision(data)).toBe(original);
    data.verificationCase!.documents[0].mediaAsset.sha256 = 'changed';
    expect(reviewRevision(data)).not.toBe(original);
  });

  it('canonicalizes object key ordering', () => {
    expect(stableReviewJson({ z: 2, a: { y: 1, b: 3 } })).toEqual(
      stableReviewJson({ a: { b: 3, y: 1 }, z: 2 }),
    );
  });

  it('requires separate explicit category decisions without treating review timestamps as provider edits', () => {
    const data = reviewFixture();
    data.current.services.specialties[0].state = 'REJECTED';
    data.current.services.specialties[0].reviewedAt = new Date().toISOString();
    expect(codes(data)).not.toContain('SUBMITTED_CONTENT_CHANGED');
    data.profile.categoryApplications.push({
      id: 'application-2',
      serviceCategoryId: 'plumbing',
      status: 'PENDING',
      supersededAt: null,
      createdAt: now,
      updatedAt: now,
      serviceCategory: { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة', isActive: true },
    });
    expect(codes(data)).toContain('CATEGORY_REVIEW_REQUIRED');
  });
});
