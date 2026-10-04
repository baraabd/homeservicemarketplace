import { evidenceSatisfiesRequirement, type VerificationEvidenceFacts } from './evidence-readiness';

const now = new Date('2026-09-15T12:00:00Z');
const requirement = { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null };
function document(): VerificationEvidenceFacts {
  return {
    ...requirement,
    supersededAt: null,
    expiresOn: null,
    mediaAsset: {
      scanState: 'CLEAN',
      visibility: 'RESTRICTED',
      deletedAt: null,
      erasureStartedAt: null,
      retainUntil: null,
      uploadCompletedAt: now,
    },
  };
}

describe('current verification evidence readiness', () => {
  it('accepts clean completed restricted evidence for the exact requirement', () => {
    expect(evidenceSatisfiesRequirement(document(), requirement, now)).toBe(true);
  });

  it.each(['PENDING', 'QUARANTINED', 'SCAN_FAILED', 'REJECTED', 'FUTURE_STATE'])(
    'refuses the %s malware verdict',
    (scanState) => {
      const doc = document();
      doc.mediaAsset!.scanState = scanState;
      expect(evidenceSatisfiesRequirement(doc, requirement, now)).toBe(false);
    },
  );

  it.each(['PUBLIC', 'PRIVATE'])('does not accept %s evidence as identity', (visibility) => {
    const doc = document();
    doc.mediaAsset!.visibility = visibility;
    expect(evidenceSatisfiesRequirement(doc, requirement, now)).toBe(false);
  });

  it.each([
    'missing asset',
    'replaced',
    'expired document',
    'uncompleted',
    'erased',
    'erasing',
    'expired retention',
  ])('refuses %s evidence', (condition) => {
    const doc = document();
    if (condition === 'missing asset') doc.mediaAsset = null;
    if (condition === 'replaced') doc.supersededAt = now;
    if (condition === 'expired document') doc.expiresOn = now;
    if (condition === 'uncompleted') doc.mediaAsset!.uploadCompletedAt = null;
    if (condition === 'erased') doc.mediaAsset!.deletedAt = now;
    if (condition === 'erasing') doc.mediaAsset!.erasureStartedAt = now;
    if (condition === 'expired retention') doc.mediaAsset!.retainUntil = now;
    expect(evidenceSatisfiesRequirement(doc, requirement, now)).toBe(false);
  });

  it('accepts only the exact specialty license and document kind', () => {
    const doc = document();
    expect(
      evidenceSatisfiesRequirement(doc, { ...requirement, serviceCategoryId: 'trade-1' }, now),
    ).toBe(false);
    expect(
      evidenceSatisfiesRequirement(doc, { ...requirement, kind: 'CATEGORY_LICENSE' }, now),
    ).toBe(false);
  });

  it('accepts a window one millisecond after now and refuses exactly at expiry', () => {
    const doc = document();
    doc.expiresOn = new Date(now.getTime() + 1);
    doc.mediaAsset!.retainUntil = new Date(now.getTime() + 1);
    expect(evidenceSatisfiesRequirement(doc, requirement, now)).toBe(true);
    expect(evidenceSatisfiesRequirement(doc, requirement, doc.expiresOn)).toBe(false);
  });
});
