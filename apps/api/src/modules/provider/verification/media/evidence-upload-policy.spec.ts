import {
  EvidenceUploadError,
  assertPrepareAllowed,
  decideFinalize,
  INITIAL_EVIDENCE_SCAN_STATE,
} from './evidence-upload-policy';

// Sprint 9B.3 — what may be prepared, and what a finalize call should do.
//
// docs/adr/0009-restricted-identity-media.md
//
// Pure, like requirement-resolver.ts and case-creation-policy.ts. The bytes,
// the storage object and the database rows are the service's problem; the
// DECISIONS are here, so the whole cross-product is testable without a disk.
//
// Finalize is the interesting half. It is called after a client PUT that may
// have succeeded, failed, half-happened, or happened twice, so "what state is
// this upload really in" has more answers than the happy path suggests — and
// the wrong answer either loses a provider's passport or leaves an active
// document pointing at bytes that were never validated.

const LIMITS = { maxBytes: 10 * 1024 * 1024, maxDocumentsPerCase: 10, uploadTtlSeconds: 900 };

const NOW = new Date('2026-08-25T12:00:00Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('the initial scan state', () => {
  it('is PENDING, not CLEAN', () => {
    // The load-bearing property: a freshly uploaded identity document has not
    // been scanned, and evidence-read.policy denies anything that is not
    // exactly CLEAN.
    expect(INITIAL_EVIDENCE_SCAN_STATE).toBe('PENDING');
  });

  it('is not QUARANTINED', () => {
    // QUARANTINED means "failed the scan" in this schema — terminal, and given
    // the LONGEST retention because it is evidence of an attack. Marking an
    // unscanned file that way would fabricate a verdict nobody reached and
    // would keep an innocent provider's passport for the malware window.
    expect(INITIAL_EVIDENCE_SCAN_STATE).not.toBe('QUARANTINED');
  });
});

describe('prepare', () => {
  const ok = { declaredMime: 'application/pdf', sizeBytes: 1024, liveDocumentCount: 0 };

  it('accepts a PDF within the limits', () => {
    expect(() => assertPrepareAllowed({ ...ok, limits: LIMITS })).not.toThrow();
  });

  it.each(['application/pdf', 'image/jpeg', 'image/png'])('accepts %s', (declaredMime) => {
    expect(() => assertPrepareAllowed({ ...ok, declaredMime, limits: LIMITS })).not.toThrow();
  });

  it.each([
    ['SVG, a script-execution vector', 'image/svg+xml'],
    ['HEIC, unviewable for reviewers', 'image/heic'],
    ['video', 'video/mp4'],
    ['an executable', 'application/x-msdownload'],
    ['a zip', 'application/zip'],
    ['nonsense', 'not/a-type'],
  ])('refuses %s', (_label, declaredMime) => {
    try {
      assertPrepareAllowed({ ...ok, declaredMime, limits: LIMITS });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('DISALLOWED_FORMAT');
    }
  });

  it('accepts exactly the size ceiling', () => {
    expect(() =>
      assertPrepareAllowed({ ...ok, sizeBytes: LIMITS.maxBytes, limits: LIMITS }),
    ).not.toThrow();
  });

  it('refuses one byte over the ceiling', () => {
    try {
      assertPrepareAllowed({ ...ok, sizeBytes: LIMITS.maxBytes + 1, limits: LIMITS });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('TOO_LARGE');
    }
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['a fraction', 10.5],
    ['NaN', Number.NaN],
  ])('refuses %s bytes', (_label, sizeBytes) => {
    expect(() => assertPrepareAllowed({ ...ok, sizeBytes, limits: LIMITS })).toThrow(
      EvidenceUploadError,
    );
  });

  it('refuses when the case already holds the maximum live documents', () => {
    try {
      assertPrepareAllowed({
        ...ok,
        liveDocumentCount: LIMITS.maxDocumentsPerCase,
        limits: LIMITS,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('TOO_MANY_DOCUMENTS');
    }
  });

  it('allows the last slot', () => {
    expect(() =>
      assertPrepareAllowed({
        ...ok,
        liveDocumentCount: LIMITS.maxDocumentsPerCase - 1,
        limits: LIMITS,
      }),
    ).not.toThrow();
  });

  it('takes every limit from configuration rather than a constant', () => {
    const tight = { maxBytes: 100, maxDocumentsPerCase: 1, uploadTtlSeconds: 60 };
    expect(() => assertPrepareAllowed({ ...ok, sizeBytes: 101, limits: tight })).toThrow(
      EvidenceUploadError,
    );
    expect(() => assertPrepareAllowed({ ...ok, liveDocumentCount: 1, limits: tight })).toThrow(
      EvidenceUploadError,
    );
  });
});

describe('finalize', () => {
  const prepared = {
    uploadCompletedAt: null as Date | null,
    createdAt: secondsAgo(60),
    deletedAt: null as Date | null,
  };

  const decide = (
    over: Partial<Parameters<typeof decideFinalize>[0]> = {},
  ): ReturnType<typeof decideFinalize> =>
    decideFinalize({
      asset: prepared,
      objectExists: true,
      hasDocument: false,
      now: NOW,
      ttlSeconds: LIMITS.uploadTtlSeconds,
      ...over,
    });

  it('completes a prepared upload whose object landed', () => {
    expect(decide()).toEqual({ action: 'COMPLETE' });
  });

  it('is idempotent: a second finalize returns the existing document', () => {
    // The ordinary retry. A client that times out waiting for the first
    // finalize must not create a second document for the same bytes.
    expect(
      decide({
        asset: { ...prepared, uploadCompletedAt: secondsAgo(10) },
        hasDocument: true,
      }),
    ).toEqual({ action: 'ALREADY_FINALIZED' });
  });

  it('refuses when the object never landed', () => {
    // Finalize called without the PUT having happened, or after it failed.
    // Completing here would produce an active document pointing at nothing.
    try {
      decide({ objectExists: false });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('OBJECT_MISSING');
    }
  });

  it('refuses an expired preparation', () => {
    try {
      decide({ asset: { ...prepared, createdAt: secondsAgo(LIMITS.uploadTtlSeconds + 1) } });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('UPLOAD_EXPIRED');
    }
  });

  it('accepts a preparation at the very edge of its window', () => {
    expect(() =>
      decide({ asset: { ...prepared, createdAt: secondsAgo(LIMITS.uploadTtlSeconds) } }),
    ).not.toThrow();
  });

  it('refuses an asset whose bytes were already deleted', () => {
    try {
      decide({ asset: { ...prepared, deletedAt: secondsAgo(5) } });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('ASSET_DELETED');
    }
  });

  it('refuses a completed upload that has no document', () => {
    // Neither state a caller can reach on their own: the write is one
    // transaction. Reaching it means a partial failure, and completing on top
    // would double-write rather than repair.
    try {
      decide({ asset: { ...prepared, uploadCompletedAt: secondsAgo(10) }, hasDocument: false });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('INCONSISTENT_STATE');
    }
  });

  it('refuses a document that exists without a completed upload', () => {
    try {
      decide({ hasDocument: true });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('INCONSISTENT_STATE');
    }
  });

  it('checks expiry before the object, so a stale prepare is not revived', () => {
    // Order matters: an expired preparation whose object DID land must still
    // be refused, or the TTL means nothing to anyone who uploads slowly.
    try {
      decide({
        asset: { ...prepared, createdAt: secondsAgo(LIMITS.uploadTtlSeconds + 1) },
        objectExists: true,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as EvidenceUploadError).code).toBe('UPLOAD_EXPIRED');
    }
  });

  it('lets an already-finalized upload through even after the TTL', () => {
    // The window governs UPLOADING, not the record afterwards. A retry an hour
    // later must still get its idempotent answer rather than an expiry error.
    expect(
      decide({
        asset: {
          ...prepared,
          uploadCompletedAt: secondsAgo(10),
          createdAt: secondsAgo(LIMITS.uploadTtlSeconds + 5000),
        },
        hasDocument: true,
      }),
    ).toEqual({ action: 'ALREADY_FINALIZED' });
  });
});
