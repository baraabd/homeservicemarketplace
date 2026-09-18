import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
  type PrismaTx,
  type EvidenceRetentionJob,
} from '@homeservicemarketplace/database';
import { OutboxRepository } from '../../../../infrastructure/outbox/outbox.repository';
import {
  planRetention,
  retryAt,
  retentionPolicySchema,
  type RetentionFacts,
  type RetentionPolicy,
} from './retention-policy';

export interface RetentionClaim {
  id: string;
  leaseToken: string;
  caseId: string;
  mediaAssetId: string;
}

/** Worker-only persistence. No controller, user-supplied storage key, or access
 * to grants. Locks always follow case -> asset -> job; an object operation is
 * NEVER held inside a DB transaction. All audit payloads below are allowlisted
 * structured fields, not a generic copy of an object/exception. */
export class EvidenceRetentionRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly outbox: OutboxRepository,
  ) {}

  async candidates(after: string | undefined, limit: number) {
    return this.db.mediaAsset.findMany({
      where: {
        id: after ? { gt: after } : undefined,
        visibility: 'RESTRICTED',
        uploadCompletedAt: { not: null },
        deletedAt: null,
        retentionJobs: { none: { status: { not: 'CANCELLED' } } },
      },
      select: { id: true, verificationCaseId: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  async plan(
    assetId: string,
    caseId: string | null,
    policy: RetentionPolicy,
    now: Date,
    shadow = false,
  ) {
    if (!caseId) return 'REVIEW_REQUIRED' as const;
    return this.db.$transaction(async (tx) => {
      if (!shadow) await this.lockCaseAsset(tx, caseId, assetId);
      const facts = await this.facts(tx, assetId);
      if (
        !facts ||
        !facts.caseState ||
        facts.documentCaseId !== caseId ||
        !facts.casePolicyVersion
      ) {
        return 'REVIEW_REQUIRED' as const;
      }
      if (['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'].includes(facts.caseState))
        return 'INELIGIBLE' as const;
      const plan = planRetention(facts, policy, now);
      if (!plan) return 'REVIEW_REQUIRED' as const;
      if (shadow) return 'ELIGIBLE' as const;
      if (
        await tx.evidenceRetentionJob.findFirst({
          where: {
            mediaAssetId: assetId,
            OR: [{ status: { not: 'CANCELLED' } }, { intentKey: plan.intentKey }],
          },
          select: { id: true },
        })
      )
        return 'EXISTING' as const;
      const job = await tx.evidenceRetentionJob.create({
        data: {
          ...plan,
          mediaAssetId: assetId,
          policySnapshot: retentionPolicySchema.parse(policy),
          maxAttempts: policy.maxAttempts,
          nextAttemptAt: plan.dueAt,
        },
      });
      await tx.mediaAsset.update({ where: { id: assetId }, data: { retainUntil: plan.dueAt } });
      await this.audit(tx, job, 'PLANNED', now);
      return 'PLANNED' as const;
    });
  }

  /** Claim ONE job so leases cannot expire while waiting in an in-process
   * batch. Attempts count crashes, not just caught storage errors. */
  async claim(now: Date, leaseMs: number): Promise<RetentionClaim | null> {
    const token = randomUUID();
    const until = new Date(now.getTime() + leaseMs);
    const rows = await this.db.$queryRaw<RetentionClaim[]>`
      WITH candidate AS (
        SELECT "id" FROM "EvidenceRetentionJob"
        WHERE "dueAt" <= ${now} AND ("holdUntil" IS NULL OR "holdUntil" <= ${now})
          AND (("status" IN ('PENDING','RETRY') AND "nextAttemptAt" <= ${now})
            OR ("status" = 'RUNNING' AND "leaseUntil" <= ${now}))
        ORDER BY "nextAttemptAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
      ) UPDATE "EvidenceRetentionJob" j
        SET "status" = 'RUNNING', "attempts" = j."attempts" + 1,
          "leaseToken" = ${token}, "leaseUntil" = ${until}, "updatedAt" = ${now}
        FROM candidate c WHERE j."id" = c."id"
        RETURNING j."id", j."leaseToken", j."caseId", j."mediaAssetId"`;
    return rows[0] ?? null;
  }

  async begin(claim: RetentionClaim, now: Date): Promise<{ key: string } | null> {
    return this.db.$transaction(async (tx) => {
      await this.lockCaseAsset(tx, claim.caseId, claim.mediaAssetId);
      const job = await this.owned(tx, claim, now);
      if (!job) return null;
      if (job.attempts > job.maxAttempts) {
        await this.terminal(tx, job, 'DEAD', 'ATTEMPTS_EXHAUSTED', now);
        return null;
      }
      if (job.holdUntil && job.holdUntil > now) {
        await tx.evidenceRetentionJob.update({
          where: { id: job.id },
          data: {
            status: 'RETRY',
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: job.holdUntil,
          },
        });
        await this.audit(tx, job, 'HELD', now);
        return null;
      }
      const asset = await tx.mediaAsset.findUnique({ where: { id: job.mediaAssetId } });
      if (
        !asset ||
        asset.visibility !== 'RESTRICTED' ||
        asset.deletedAt ||
        !asset.uploadCompletedAt
      ) {
        await this.terminal(tx, job, 'DEAD', 'ASSET_INCONSISTENT', now);
        return null;
      }
      // The fence is irreversible. After external erasure may have started,
      // retries must finish rather than cancel and make partial bytes readable.
      if (!asset.erasureStartedAt) {
        const policy = retentionPolicySchema.parse(job.policySnapshot);
        const facts = await this.facts(tx, job.mediaAssetId);
        if (
          !facts ||
          !facts.caseState ||
          facts.caseId !== job.caseId ||
          facts.documentCaseId !== job.caseId ||
          !facts.casePolicyVersion
        ) {
          await this.terminal(tx, job, 'DEAD', 'SOURCE_INCONSISTENT', now);
          return null;
        }
        const current = planRetention(facts, policy, now);
        if (!current || current.intentKey !== job.intentKey) {
          await this.terminal(tx, job, 'CANCELLED', 'BASIS_CHANGED', now);
          await tx.mediaAsset.updateMany({
            where: { id: job.mediaAssetId, erasureStartedAt: null, retainUntil: job.dueAt },
            data: { retainUntil: null },
          });
          return null;
        }
        if (current.dueAt > now) throw new Error('retention-not-due');
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { erasureStartedAt: now } });
        await this.audit(tx, job, 'STARTED', now);
      }
      return { key: asset.storageKey };
    });
  }

  async complete(claim: RetentionClaim, now: Date): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      await this.lockCaseAsset(tx, claim.caseId, claim.mediaAssetId);
      const job = await this.owned(tx, claim, now);
      if (!job) return false;
      const policy = retentionPolicySchema.parse(job.policySnapshot);
      const asset = await tx.mediaAsset.findUnique({ where: { id: job.mediaAssetId } });
      if (!asset?.erasureStartedAt || asset.visibility !== 'RESTRICTED')
        throw new Error('retention-fence-missing');
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          deletedAt: now,
          deletionReason: 'RETENTION_POLICY',
          storageKey: `erased/${asset.id}`,
          originalFilename: null,
          scanSignature: null,
          ownerUserId: null,
          declaredMimeType: 'application/octet-stream',
          detectedMimeType: null,
          sizeBytes: 0,
          ...(policy.retainChecksum ? {} : { sha256: null }),
          pendingDocumentKind: null,
          pendingServiceCategoryId: null,
          uploadExpiresAt: null,
        },
      });
      await tx.verificationDocument.updateMany({
        where: { mediaAssetId: asset.id },
        data: { uploadedByUserId: null },
      });
      // Do not advance a DRAFT's last-activity clock while deleting old notes.
      await tx.$executeRaw`UPDATE "VerificationCase" SET "reviewerNotes" = NULL
        WHERE "id" = ${job.caseId} AND NOT EXISTS (
          SELECT 1 FROM "MediaAsset" WHERE "verificationCaseId" = ${job.caseId}
          AND "visibility" = 'RESTRICTED' AND "uploadCompletedAt" IS NOT NULL AND "deletedAt" IS NULL)`;
      await tx.evidenceRetentionJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: null,
        },
      });
      await this.audit(tx, job, 'COMPLETED', now);
      // Atomic with the tombstone and audit; failure rolls all DB writes back,
      // leaving the fence for an idempotent storage re-check on the next retry.
      await this.outbox.enqueue(
        {
          aggregateType: 'EvidenceRetentionJob',
          aggregateId: job.id,
          eventType: 'evidence.erased.v1',
          dedupeKey: `evidence.erased.v1:${job.id}`,
          payload: {
            version: 1,
            jobId: job.id,
            policyVersion: job.policyVersion,
            scope: 'PRIMARY_OBJECT_AND_VERSIONS',
          },
        },
        tx,
      );
      return true;
    });
  }

  async fail(claim: RetentionClaim, now: Date): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const job = await this.owned(tx, claim, now);
      if (!job) return;
      if (job.attempts >= job.maxAttempts)
        await this.terminal(tx, job, 'DEAD', 'ERASURE_UNCONFIRMED', now);
      else {
        await tx.evidenceRetentionJob.update({
          where: { id: job.id },
          data: {
            status: 'RETRY',
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: 'ERASURE_UNCONFIRMED',
            nextAttemptAt: retryAt(job.attempts, now),
          },
        });
        await this.audit(tx, job, 'RETRY', now);
      }
    });
  }

  async counts(now: Date) {
    const [dead, overdue, completed] = await Promise.all([
      this.db.evidenceRetentionJob.count({ where: { status: 'DEAD' } }),
      this.db.evidenceRetentionJob.count({
        where: { dueAt: { lt: now }, status: { in: ['PENDING', 'RETRY', 'RUNNING'] } },
      }),
      this.db.evidenceRetentionJob.count({ where: { status: 'COMPLETED' } }),
    ]);
    return { dead, overdue, completed };
  }

  private async facts(tx: PrismaTx, assetId: string): Promise<RetentionFacts | null> {
    const asset = await tx.mediaAsset.findUnique({
      where: { id: assetId },
      include: {
        verificationDocument: { select: { caseId: true } },
        verificationCase: {
          select: { id: true, state: true, policyVersion: true, updatedAt: true },
        },
      },
    });
    if (!asset) return null;
    const kase = asset.verificationCase;
    let decidedAt: Date | null = null;
    let lastActivityAt: Date | null = kase?.updatedAt ?? null;
    if (kase) {
      const activity = await tx.mediaAsset.aggregate({
        where: { verificationCaseId: kase.id },
        _max: { createdAt: true, uploadCompletedAt: true },
      });
      lastActivityAt = new Date(
        Math.max(
          kase.updatedAt.getTime(),
          activity._max.createdAt?.getTime() ?? 0,
          activity._max.uploadCompletedAt?.getTime() ?? 0,
        ),
      );
      const outcome = kase.state === 'REJECTED' ? 'REJECTED' : 'APPROVED';
      const decision = await tx.verificationDecision.findFirst({
        where: { caseId: kase.id, outcome, policyVersion: kase.policyVersion },
        orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
        select: { decidedAt: true },
      });
      decidedAt = decision?.decidedAt ?? null;
    }
    return {
      assetId: asset.id,
      visibility: asset.visibility,
      completedAt: asset.uploadCompletedAt,
      deletedAt: asset.deletedAt,
      caseId: asset.verificationCaseId,
      documentCaseId: asset.verificationDocument?.caseId ?? null,
      caseState: kase?.state ?? null,
      casePolicyVersion: kase?.policyVersion ?? null,
      lastActivityAt,
      decidedAt,
      scanState: asset.scanState,
      scannedAt: asset.scannedAt,
    };
  }

  private async lockCaseAsset(tx: PrismaTx, caseId: string, assetId: string) {
    await tx.$queryRaw`SELECT "id" FROM "VerificationCase" WHERE "id" = ${caseId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${assetId} FOR UPDATE`;
  }

  private async owned(tx: PrismaTx, claim: RetentionClaim, now: Date) {
    // Row lock plus token predicates make even completion racing a replacement
    // worker a CAS, not an unguarded read followed by an update.
    const rows = await tx.$queryRaw<EvidenceRetentionJob[]>`SELECT * FROM "EvidenceRetentionJob"
      WHERE "id" = ${claim.id} AND "status" = 'RUNNING' AND "leaseToken" = ${claim.leaseToken}
        AND "leaseUntil" > ${now} FOR UPDATE`;
    return rows[0] ?? null;
  }

  private async terminal(
    tx: PrismaTx,
    job: EvidenceRetentionJob,
    status: 'DEAD' | 'CANCELLED',
    reason: string,
    now: Date,
  ) {
    await tx.evidenceRetentionJob.update({
      where: { id: job.id },
      data: {
        status,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: reason,
      },
    });
    await this.audit(tx, job, status, now);
  }

  private async audit(tx: PrismaTx, job: EvidenceRetentionJob, phase: string, now: Date) {
    const metadata: Prisma.InputJsonValue = {
      version: 1,
      actor: 'SYSTEM_RETENTION',
      jobId: job.id,
      phase,
      reasonCode: job.triggerCode,
      policyVersion: job.policyVersion,
      casePolicyVersion: job.casePolicyVersion,
      attempt: job.attempts,
    };
    await tx.auditEvent.create({
      data: { type: 'VERIFICATION_EVIDENCE_RETENTION', createdAt: now, metadata },
    });
  }
}
