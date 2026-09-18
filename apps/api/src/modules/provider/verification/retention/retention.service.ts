import type { RestrictedObjectStoragePort } from '../../../../infrastructure/storage/restricted-object-storage.port';
import { EvidenceRetentionRepository } from './retention.repository';
import type { RetentionPolicy } from './retention-policy';

export class EvidenceRetentionService {
  private cursor: string | undefined;
  constructor(
    private readonly repository: EvidenceRetentionRepository,
    private readonly storage: RestrictedObjectStoragePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(
    policy: RetentionPolicy,
    mode: 'shadow' | 'enforce',
    limit = 25,
    shouldStop: () => boolean = () => false,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('retention-invalid-limit');
    const result = {
      examined: 0,
      eligible: 0,
      planned: 0,
      reviewRequired: 0,
      failed: 0,
      processed: 0,
      completed: 0,
    };
    const candidates = await this.repository.candidates(this.cursor, limit);
    for (const item of candidates) {
      if (shouldStop()) break;
      result.examined += 1;
      try {
        const state = await this.repository.plan(
          item.id,
          item.verificationCaseId,
          policy,
          this.clock(),
          mode === 'shadow',
        );
        if (state === 'ELIGIBLE') result.eligible += 1;
        if (state === 'PLANNED') result.planned += 1;
        if (state === 'REVIEW_REQUIRED') result.reviewRequired += 1;
      } catch {
        result.failed += 1;
      }
    }
    this.cursor = candidates.length === limit ? candidates[candidates.length - 1].id : undefined;
    if (mode === 'shadow') return result;
    for (let i = 0; i < limit; i += 1) {
      if (shouldStop()) break;
      const claim = await this.repository.claim(this.clock(), 120_000);
      if (!claim) break;
      result.processed += 1;
      try {
        const target = await this.repository.begin(claim, this.clock());
        if (!target) continue;
        const receipt = await this.storage.eraseObject(target.key);
        if (receipt.verifiedAbsent !== true || receipt.scope !== 'PRIMARY_OBJECT_AND_VERSIONS') {
          throw new Error('retention-proof-missing');
        }
        if (await this.repository.complete(claim, this.clock())) result.completed += 1;
      } catch {
        result.failed += 1;
        // Failure here must propagate as a failed tick. Lease expiry still
        // guarantees recovery; swallowing it would advertise a healthy worker.
        await this.repository.fail(claim, this.clock());
      }
    }
    return result;
  }
}
