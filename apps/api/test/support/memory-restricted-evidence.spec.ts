import {
  EvidenceAvailabilityService,
  type EvidenceAvailabilityCase,
} from '../../src/modules/provider/verification/media/evidence-availability.service';
import { validateEvidenceBytes } from '../../src/modules/provider/verification/media/evidence-validation';
import {
  MemoryRestrictedEvidenceStorage,
  RESTRICTED_IDENTITY_PNG,
} from './memory-restricted-evidence';

const now = new Date('2026-09-15T12:00:00Z');
const key = 'verification/storage-fixture/current.png';

function fixture() {
  const storage = new MemoryRestrictedEvidenceStorage();
  const stored = storage.seed(key);
  const input: EvidenceAvailabilityCase = {
    id: 'storage-fixture',
    policyVersion: 'fixture-v1',
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null }],
    documents: [
      {
        id: 'current-document',
        kind: 'INDIVIDUAL_IDENTITY',
        serviceCategoryId: null,
        supersededAt: null,
        expiresOn: null,
        mediaAsset: {
          id: 'current-asset',
          storageKey: key,
          ...stored,
          visibility: 'RESTRICTED',
          scanState: 'CLEAN',
          uploadCompletedAt: now,
          deletedAt: null,
          erasureStartedAt: null,
          retainUntil: null,
        },
      },
    ],
  };
  return { storage, input, service: new EvidenceAvailabilityService(storage) };
}

describe('identity availability against independent stored bytes', () => {
  it('accepts a complete PNG and binds its availability without opening an evidence stream', async () => {
    const f = fixture();
    expect(
      validateEvidenceBytes({
        declaredMime: 'image/png',
        filename: 'identity.png',
        bytes: RESTRICTED_IDENTITY_PNG,
        maxBytes: 1024,
      }),
    ).toEqual({ ok: true, detected: 'image/png' });
    const proof = await f.service.prepare(f.input, now);
    expect(() => f.service.assertCurrent(proof, f.input, now)).not.toThrow();
    expect(f.storage.headCalls).toEqual([key]);
    expect(f.storage.readCalls).toEqual([]);
  });

  it.each(['missing', 'truncated'] as const)(
    'refuses %s bytes despite clean, unchanged media metadata',
    async (failure) => {
      const f = fixture();
      if (failure === 'missing') await f.storage.deleteObject(key);
      else f.storage.objects.set(key, RESTRICTED_IDENTITY_PNG.subarray(0, 8));
      await expect(f.service.prepare(f.input, now)).rejects.toMatchObject({
        status: 409,
        details: { reason: 'EVIDENCE_OBJECT_UNAVAILABLE' },
      });
      expect(f.input.documents[0].mediaAsset?.scanState).toBe('CLEAN');
      expect(f.storage.headCalls).toEqual([key]);
      expect(f.storage.readCalls).toEqual([]);
    },
  );
});
