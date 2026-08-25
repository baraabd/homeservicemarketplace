import {
  RESTRICTED_NAMESPACE,
  buildEvidenceKey,
  hashEvidence,
  isRestrictedKey,
  newAssetId,
  retainUntilFor,
} from './evidence-keys';

// Sprint 9B — key generation and the public/restricted boundary.
// docs/adr/0009 §3 · docs/adr/0012

describe('buildEvidenceKey', () => {
  it('composes the key entirely from server-side values', () => {
    expect(
      buildEvidenceKey({ caseId: 'case-1', assetId: 'asset-9', detectedMime: 'application/pdf' }),
    ).toBe('verification/case-1/asset-9.pdf');
  });

  it('takes the extension from the DETECTED type, not a declaration', () => {
    // The declared type is a claim. Naming the object by it would let a caller
    // choose the extension a reviewer's browser sees.
    expect(buildEvidenceKey({ caseId: 'c', assetId: 'a', detectedMime: 'image/jpeg' })).toMatch(
      /\.jpg$/,
    );
    expect(buildEvidenceKey({ caseId: 'c', assetId: 'a', detectedMime: 'image/png' })).toMatch(
      /\.png$/,
    );
  });

  it('always lands inside the restricted namespace', () => {
    const key = buildEvidenceKey({ caseId: 'c', assetId: 'a', detectedMime: 'image/png' });
    expect(key.startsWith(`${RESTRICTED_NAMESPACE}/`)).toBe(true);
    expect(isRestrictedKey(key)).toBe(true);
  });

  it('produces a distinct key per asset', () => {
    const a = buildEvidenceKey({ caseId: 'c', assetId: newAssetId(), detectedMime: 'image/png' });
    const b = buildEvidenceKey({ caseId: 'c', assetId: newAssetId(), detectedMime: 'image/png' });
    expect(a).not.toBe(b);
  });
});

describe('isRestrictedKey — the backstop the PUBLIC route uses', () => {
  it.each([
    'verification/case-1/asset.pdf',
    'verification/anything',
    '/verification/case-1/a.png',
    'VERIFICATION/case-1/a.png',
  ])('refuses %s', (key) => {
    expect(isRestrictedKey(key)).toBe(true);
  });

  it.each(['requests/user-1/photo.jpg', 'avatars/user-1.png', 'verificationsomething/other.jpg'])(
    'allows the genuinely public key %s',
    (key) => {
      // The third case matters: a prefix test that used bare startsWith would
      // wrongly capture `verificationsomething/`, and over-blocking the public
      // route is a real outage even if it fails safe.
      expect(isRestrictedKey(key)).toBe(false);
    },
  );

  it('is a misconfiguration backstop, not an authorization mechanism', () => {
    // Documented so nobody later "simplifies" the restricted read path down to
    // a key check. The restricted route authorises by database row; this
    // function only stops the PUBLIC route resolving something it must not.
    // Asserting the shape here keeps that contract visible.
    expect(isRestrictedKey('verification/x')).toBe(true);
    expect(isRestrictedKey('requests/x')).toBe(false);
  });
});

describe('hashEvidence', () => {
  it('is stable for identical bytes', () => {
    const a = hashEvidence(Uint8Array.from([1, 2, 3]));
    const b = hashEvidence(Uint8Array.from([1, 2, 3]));
    expect(a).toBe(b);
  });

  it('differs for different bytes', () => {
    expect(hashEvidence(Uint8Array.from([1, 2, 3]))).not.toBe(
      hashEvidence(Uint8Array.from([1, 2, 4])),
    );
  });

  it('is a hex sha-256', () => {
    expect(hashEvidence(Uint8Array.from([1]))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lets the same file under two identities be found', () => {
    // The duplicate-identity fraud signal, and the reason the hash outlives the
    // bytes: it answers "was this the document we verified?" without keeping it.
    const same = Uint8Array.from(Buffer.from('passport-bytes'));
    expect(hashEvidence(same)).toBe(hashEvidence(Uint8Array.from(Buffer.from('passport-bytes'))));
  });
});

describe('retainUntilFor', () => {
  const from = new Date('2026-08-24T00:00:00Z');
  const days = { verified: 90, rejected: 30, abandoned: 30, quarantine: 180 };

  it.each([
    ['VERIFIED', 90],
    ['REJECTED', 30],
    ['ABANDONED', 30],
    ['QUARANTINED', 180],
  ] as Array<['VERIFIED' | 'REJECTED' | 'ABANDONED' | 'QUARANTINED', number]>)(
    'schedules %s deletion at +%i days',
    (outcome, expected) => {
      const until = retainUntilFor({ outcome, from, days });
      expect(Math.round((until.getTime() - from.getTime()) / 86_400_000)).toBe(expected);
    },
  );

  it('keeps quarantined evidence LONGEST, not shortest', () => {
    // The counter-intuitive one, and the one most likely to be "corrected" by
    // someone tidying up: destroying malware destroys the incident record.
    const q = retainUntilFor({ outcome: 'QUARANTINED', from, days });
    const v = retainUntilFor({ outcome: 'VERIFIED', from, days });
    const r = retainUntilFor({ outcome: 'REJECTED', from, days });
    expect(q.getTime()).toBeGreaterThan(v.getTime());
    expect(q.getTime()).toBeGreaterThan(r.getTime());
  });

  it('gives a rejected applicant the shortest retention', () => {
    // Strongest claim to erasure, weakest reason to keep.
    const r = retainUntilFor({ outcome: 'REJECTED', from, days });
    const v = retainUntilFor({ outcome: 'VERIFIED', from, days });
    expect(r.getTime()).toBeLessThan(v.getTime());
  });

  it('reads the windows from configuration rather than hardcoding', () => {
    // Legal changes a window without a deploy.
    const custom = retainUntilFor({
      outcome: 'VERIFIED',
      from,
      days: { ...days, verified: 7 },
    });
    expect(Math.round((custom.getTime() - from.getTime()) / 86_400_000)).toBe(7);
  });
});
