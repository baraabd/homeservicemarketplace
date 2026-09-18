import { EvidenceRetentionService } from './retention.service';
import type { EvidenceRetentionRepository } from './retention.repository';
import type { RestrictedObjectStoragePort } from '../../../../infrastructure/storage/restricted-object-storage.port';
import { retentionPolicySchema } from './retention-policy';
const policy = retentionPolicySchema.parse({
  format: 1,
  approvalReference: 'test',
  verifiedDays: 1,
  rejectedDays: 1,
  abandonedDays: 1,
  quarantineDays: 2,
  maxAttempts: 2,
});
function fixture() {
  const claim = { id: 'job', leaseToken: 'lease', caseId: 'case', mediaAssetId: 'asset' };
  const repo = {
    candidates: jest.fn().mockResolvedValue([]),
    plan: jest.fn(),
    claim: jest.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
    begin: jest.fn().mockResolvedValue({ key: 'verification/case/object.pdf' }),
    complete: jest.fn().mockResolvedValue(true),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    eraseObject: jest
      .fn()
      .mockResolvedValue({ scope: 'PRIMARY_OBJECT_AND_VERSIONS', verifiedAbsent: true }),
  };
  return {
    repo,
    storage,
    service: new EvidenceRetentionService(
      repo as unknown as EvidenceRetentionRepository,
      storage as unknown as RestrictedObjectStoragePort,
    ),
  };
}
it('does no claim, write or deletion in shadow mode', async () => {
  const { service, repo, storage } = fixture();
  await service.runOnce(policy, 'shadow');
  expect(repo.claim).not.toHaveBeenCalled();
  expect(storage.eraseObject).not.toHaveBeenCalled();
});
it('commits a fence before erasure and only then acknowledges its receipt', async () => {
  const { service, repo, storage } = fixture();
  expect((await service.runOnce(policy, 'enforce')).completed).toBe(1);
  expect(repo.begin.mock.invocationCallOrder[0]).toBeLessThan(
    storage.eraseObject.mock.invocationCallOrder[0],
  );
  expect(storage.eraseObject.mock.invocationCallOrder[0]).toBeLessThan(
    repo.complete.mock.invocationCallOrder[0],
  );
});
it('does not erase a cancelled, held or stale claim', async () => {
  const { service, repo, storage } = fixture();
  repo.begin.mockResolvedValue(null);
  await service.runOnce(policy, 'enforce');
  expect(storage.eraseObject).not.toHaveBeenCalled();
});
it('requires an explicit strong erasure receipt rather than trusting DELETE', async () => {
  const { service, repo, storage } = fixture();
  storage.eraseObject.mockResolvedValue({ verifiedAbsent: false });
  expect((await service.runOnce(policy, 'enforce')).failed).toBe(1);
  expect(repo.complete).not.toHaveBeenCalled();
  expect(repo.fail).toHaveBeenCalledTimes(1);
});
it('storage or final transaction failure leaves work retryable, never acknowledged', async () => {
  const { service, repo } = fixture();
  repo.complete.mockRejectedValue(new Error('synthetic-db-outage'));
  expect((await service.runOnce(policy, 'enforce')).completed).toBe(0);
  expect(repo.fail).toHaveBeenCalledTimes(1);
});
it('does not announce a healthy tick when even retry persistence fails', async () => {
  const { service, repo, storage } = fixture();
  storage.eraseObject.mockRejectedValue(new Error('synthetic-outage'));
  repo.fail.mockRejectedValue(new Error('synthetic-db-outage'));
  await expect(service.runOnce(policy, 'enforce')).rejects.toThrow();
});
it.each([0, 101, NaN, 1.1])('rejects invalid batch %s', async (limit) => {
  await expect(fixture().service.runOnce(policy, 'enforce', limit)).rejects.toThrow();
});

it('surfaces unplannable evidence for review instead of silently treating it as safe', async () => {
  const { service, repo } = fixture();
  repo.candidates.mockResolvedValue([{ id: 'orphan', verificationCaseId: null }]);
  repo.plan.mockResolvedValue('REVIEW_REQUIRED');
  expect((await service.runOnce(policy, 'shadow')).reviewRequired).toBe(1);
  expect(repo.claim).not.toHaveBeenCalled();
});

it('does not acquire more deletion work after shutdown is requested', async () => {
  const { service, repo, storage } = fixture();
  const result = await service.runOnce(policy, 'enforce', 25, () => true);
  expect(result.processed).toBe(0);
  expect(repo.claim).not.toHaveBeenCalled();
  expect(storage.eraseObject).not.toHaveBeenCalled();
});
