import {
  EvidenceAvailabilityService,
  type EvidenceAvailabilityCase,
} from './evidence-availability.service';

const now = new Date('2026-09-15T12:00:00Z');
const key = 'verification/case-1/asset-1.pdf';
const bytes = Buffer.from('%PDF-1.4\nSynthetic identity fixture only.\n%%EOF\n');
function evidence(): EvidenceAvailabilityCase {
  return {
    id: 'case-1',
    policyVersion: 'policy-v1',
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }],
    documents: [
      {
        id: 'document-1',
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        supersededAt: null,
        expiresOn: null,
        mediaAsset: {
          id: 'asset-1',
          storageKey: key,
          sizeBytes: bytes.length,
          sha256: 'fixture-hash',
          scanState: 'CLEAN',
          visibility: 'RESTRICTED',
          deletedAt: null,
          erasureStartedAt: null,
          retainUntil: null,
          uploadCompletedAt: now,
        },
      },
    ],
  };
}

function harness() {
  const objects = new Map([[key, bytes]]);
  const head = jest.fn(async (storageKey: string) => {
    const object = objects.get(storageKey);
    return object ? { sizeBytes: object.length } : null;
  });
  return { service: new EvidenceAvailabilityService({ head } as never), objects, head };
}

describe('identity approval storage preflight', () => {
  it('binds a matching object observation to the exact case and immutable evidence version', async () => {
    const h = harness();
    const kase = evidence();
    const proof = await h.service.prepare(kase, now);
    expect(h.head).toHaveBeenCalledWith(key);
    expect(() => h.service.assertCurrent(proof, kase, now)).not.toThrow();
    expect(h.head).toHaveBeenCalledTimes(1); // Transaction validation performs no storage I/O.
    expect(JSON.stringify(proof)).not.toContain(key);
  });

  it.each(['missing', 'truncated'])(
    'refuses a %s object despite clean completed persisted metadata',
    async (state) => {
      const h = harness();
      if (state === 'missing') h.objects.clear();
      else h.objects.set(key, bytes.subarray(0, 1));
      await expect(h.service.prepare(evidence(), now)).rejects.toMatchObject({
        status: 409,
        details: { reason: 'EVIDENCE_OBJECT_UNAVAILABLE' },
      });
    },
  );

  it('fails closed with a safe retryable error when object storage is unavailable', async () => {
    const h = harness();
    h.head.mockRejectedValue(new Error(`private backend failure at ${key}`));
    const failure = await h.service.prepare(evidence(), now).catch((error) => error);
    expect(failure).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    expect(String(failure)).not.toContain(key);
  });

  it('bounds a storage backend that never answers before any decision transaction can begin', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      h.head.mockImplementationOnce(() => new Promise(() => {}));
      const failure = expect(h.service.prepare(evidence(), now)).rejects.toMatchObject({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      await jest.advanceTimersByTimeAsync(5_000);
      await failure;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['case', 'policy', 'document', 'asset', 'storage key', 'size', 'hash', 'completion'])(
    'refuses a proof after the %s changes',
    async (changed) => {
      const h = harness();
      const kase = evidence();
      const proof = await h.service.prepare(kase, now);
      const asset = kase.documents[0].mediaAsset!;
      if (changed === 'case') kase.id = 'case-2';
      if (changed === 'policy') kase.policyVersion = 'policy-v2';
      if (changed === 'document') kase.documents[0].id = 'document-2';
      if (changed === 'asset') asset.id = 'asset-2';
      if (changed === 'storage key') asset.storageKey = 'verification/case-1/asset-2.pdf';
      if (changed === 'size') asset.sizeBytes += 1;
      if (changed === 'hash') asset.sha256 = 'changed-hash';
      if (changed === 'completion') asset.uploadCompletedAt = new Date(now.getTime() + 1);
      expect(() => h.service.assertCurrent(proof, kase, now)).toThrow(
        expect.objectContaining({
          status: 409,
          details: { reason: 'EVIDENCE_PREFLIGHT_STALE' },
        }),
      );
      expect(h.head).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['replaced', 'erasing', 'expired retention', 'not clean'])(
    'rechecks %s live state after storage preflight',
    async (changed) => {
      const h = harness();
      const kase = evidence();
      const proof = await h.service.prepare(kase, now);
      if (changed === 'replaced') kase.documents[0].supersededAt = now;
      if (changed === 'erasing') kase.documents[0].mediaAsset!.erasureStartedAt = now;
      if (changed === 'expired retention') kase.documents[0].mediaAsset!.retainUntil = now;
      if (changed === 'not clean') kase.documents[0].mediaAsset!.scanState = 'PENDING';
      expect(() => h.service.assertCurrent(proof, kase, now)).toThrow(
        expect.objectContaining({
          status: 409,
          details: { reason: 'EVIDENCE_NOT_READY' },
        }),
      );
    },
  );

  it('performs no unnecessary storage call for an explicitly waived empty checklist', async () => {
    const h = harness();
    const kase = { ...evidence(), requirements: [] };
    const proof = await h.service.prepare(kase, now);
    expect(() => h.service.assertCurrent(proof, kase, now)).not.toThrow();
    expect(h.head).not.toHaveBeenCalled();
  });
});
