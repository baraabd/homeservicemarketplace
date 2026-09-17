/* eslint-disable @typescript-eslint/no-require-imports -- Native database services load only inside the disposable-service gate. */
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient, VerificationCaseState } from '@homeservicemarketplace/database';
import type { EvidenceRetentionRepository } from '../../src/modules/provider/verification/retention/retention.repository';
import type { EvidenceRetentionService } from '../../src/modules/provider/verification/retention/retention.service';
import type { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import type { RestrictedObjectStoragePort } from '../../src/infrastructure/storage/restricted-object-storage.port';
import type { ListObjectVersionsCommandOutput, S3Client } from '@aws-sdk/client-s3';
import type { ClamAvMalwareScanner } from '../../src/modules/provider/verification/media/clamav-scanner.adapter';
import { retentionPolicySchema } from '../../src/modules/provider/verification/retention/retention-policy';

const integration = process.env.RUN_RETENTION_INTEGRATION === '1' ? describe : describe.skip;
const policy = retentionPolicySchema.parse({
  format: 1,
  approvalReference: 'ci.synthetic',
  verifiedDays: 1,
  rejectedDays: 1,
  abandonedDays: 1,
  quarantineDays: 2,
  maxAttempts: 2,
});
const old = new Date('2026-01-01T00:00:00Z');
const decisionAt = new Date('2026-01-02T00:00:00Z');
const start = new Date('2026-09-17T00:00:00Z');
jest.setTimeout(120_000);

integration.each(['local', 's3'] as const)(
  '12B retention — disposable PostgreSQL + %s + real ClamAV',
  (backend) => {
    const prefix = `retention-${randomUUID()}`;
    const profileId = `${prefix}-provider`,
      userId = `${prefix}-owner`,
      caseId = `${prefix}-case`,
      assetId = `${prefix}-asset`;
    const key = `verification/${caseId}/${assetId}.pdf`;
    const content = Buffer.from('%PDF-1.4\nSynthetic retention integration fixture only.\n%%EOF');
    let root: string;
    let db: PrismaClient;
    let repo: EvidenceRetentionRepository;
    let service: EvidenceRetentionService;
    let outbox: OutboxRepository;
    let storage: RestrictedObjectStoragePort;
    let s3: S3Client | undefined;
    let scanner: ClamAvMalwareScanner;
    let clock = start;
    const bucket = `retention-test-${randomUUID()}`;
    async function clear() {
      await db.outboxEvent.deleteMany({
        where: {
          aggregateType: 'EvidenceRetentionJob',
          aggregateId: {
            in: (
              await db.evidenceRetentionJob.findMany({
                where: { mediaAssetId: assetId },
                select: { id: true },
              })
            ).map((r) => r.id),
          },
        },
      });
      await db.evidenceRetentionJob.deleteMany({ where: { mediaAssetId: assetId } });
      await db.verificationDocument.deleteMany({ where: { caseId } });
      await db.mediaAsset.deleteMany({ where: { id: assetId } });
      await db.verificationDecision.deleteMany({ where: { caseId } });
      await db.verificationCase.deleteMany({ where: { id: caseId } });
    }
    async function fixture(state: VerificationCaseState = 'VERIFIED') {
      await db.verificationCase.create({
        data: {
          id: caseId,
          providerProfileId: profileId,
          state,
          policyVersion: prefix,
          createdAt: old,
          updatedAt: old,
          reviewerNotes: 'Sensitive synthetic reviewer text',
        },
      });
      const source = join(root, 'stage.pdf');
      await writeFile(source, content);
      await storage.putObjectFromFile({
        key,
        sourcePath: source,
        contentType: 'application/pdf',
        sizeBytes: content.length,
      });
      if (s3) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        // Multiple actual versions, not a mock list. Latest bytes are identical.
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content }));
      }
      const chunks: Buffer[] = [];
      for await (const chunk of await storage.openReadStream(key)) chunks.push(Buffer.from(chunk));
      const scanned = Buffer.concat(chunks);
      expect(scanned).toEqual(content);
      const verdict = await scanner.scan({ bytes: scanned, assetId });
      expect(verdict.state).toBe('CLEAN');
      await db.mediaAsset.create({
        data: {
          id: assetId,
          verificationCaseId: caseId,
          ownerUserId: userId,
          visibility: 'RESTRICTED',
          storageKey: key,
          declaredMimeType: 'application/pdf',
          detectedMimeType: 'application/pdf',
          sizeBytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          originalFilename: 'sensitive-synthetic-person.pdf',
          scanState: 'CLEAN',
          scannedAt: old,
          uploadCompletedAt: old,
          createdAt: old,
          updatedAt: old,
        },
      });
      await db.verificationDocument.create({
        data: {
          caseId,
          kind: 'INDIVIDUAL_IDENTITY',
          mediaAssetId: assetId,
          uploadedByUserId: userId,
        },
      });
      if (state === 'VERIFIED')
        await db.verificationDecision.create({
          data: {
            caseId,
            outcome: 'APPROVED',
            reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
            fromState: 'IN_REVIEW',
            toState: 'VERIFIED',
            policyVersion: prefix,
            decidedAt: decisionAt,
          },
        });
    }
    it('dead-letters a lost canonical source without clearing the access deadline', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const claim = await repo.claim(clock, 120_000);
      expect(claim).not.toBeNull();
      await db.verificationDocument.deleteMany({ where: { caseId } });
      expect(await repo.begin(claim!, clock)).toBeNull();
      const job = await db.evidenceRetentionJob.findUniqueOrThrow({ where: { id: claim!.id } });
      expect(job).toMatchObject({ status: 'DEAD', lastErrorCode: 'SOURCE_INCONSISTENT' });
      const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      expect(asset.retainUntil).not.toBeNull();
      expect(asset.deletedAt).toBeNull();
      expect(await storage.head(key)).not.toBeNull();
    });
    it('rechecks a hold acquired after claim and before the external erasure fence', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const claim = await repo.claim(clock, 120_000);
      await db.evidenceRetentionJob.update({
        where: { id: claim!.id },
        data: { holdUntil: new Date(clock.getTime() + 60_000) },
      });
      expect(await repo.begin(claim!, clock)).toBeNull();
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).erasureStartedAt,
      ).toBeNull();
      expect(await storage.head(key)).not.toBeNull();
      expect(await repo.claim(clock, 120_000)).toBeNull();
    });
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/retention_ci') {
        throw new Error('retention-tests-require-dedicated-local-disposable-database');
      }
      const { PrismaClient } = require('@homeservicemarketplace/database');
      db = new PrismaClient({ log: [] });
      const {
        EvidenceRetentionRepository,
      } = require('../../src/modules/provider/verification/retention/retention.repository');
      const {
        EvidenceRetentionService,
      } = require('../../src/modules/provider/verification/retention/retention.service');
      const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
      const {
        LocalDiskRestrictedStorageAdapter,
      } = require('../../src/infrastructure/storage/local-disk-restricted-storage.adapter');
      root = await mkdtemp(join(tmpdir(), 'hsm-retention-db-'));
      const {
        ClamAvMalwareScanner,
      } = require('../../src/modules/provider/verification/media/clamav-scanner.adapter');
      scanner = new ClamAvMalwareScanner({
        get: (k: string) =>
          ({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: 3310, CLAMAV_TIMEOUT_MS: 30_000 })[
            k as 'CLAMAV_HOST'
          ],
      });
      if (backend === 'local') storage = new LocalDiskRestrictedStorageAdapter({ get: () => root });
      else {
        const endpoint = new URL(process.env.RETENTION_TEST_S3_ENDPOINT!);
        if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname))
          throw new Error('retention-s3-tests-require-loopback');
        const {
          S3Client,
          CreateBucketCommand,
          PutBucketVersioningCommand,
        } = require('@aws-sdk/client-s3');
        const {
          S3RestrictedStorageAdapter,
        } = require('../../src/infrastructure/storage/s3-restricted-storage.adapter');
        const values: Record<string, unknown> = {
          S3_ENDPOINT: endpoint.href,
          S3_REGION: 'us-east-1',
          S3_FORCE_PATH_STYLE: true,
          S3_RESTRICTED_BUCKET: bucket,
          S3_ACCESS_KEY_ID: process.env.RETENTION_TEST_S3_USER,
          S3_SECRET_ACCESS_KEY: process.env.RETENTION_TEST_S3_SECRET,
        };
        s3 = new S3Client({
          endpoint: endpoint.href,
          region: 'us-east-1',
          forcePathStyle: true,
          credentials: {
            accessKeyId: values.S3_ACCESS_KEY_ID,
            secretAccessKey: values.S3_SECRET_ACCESS_KEY,
          },
        });
        await s3!.send(new CreateBucketCommand({ Bucket: bucket }));
        await s3!.send(
          new PutBucketVersioningCommand({
            Bucket: bucket,
            VersioningConfiguration: { Status: 'Enabled' },
          }),
        );
        storage = new S3RestrictedStorageAdapter({ get: (k: string) => values[k] });
      }
      outbox = new OutboxRepository({ client: db });
      repo = new EvidenceRetentionRepository(db, outbox);
      service = new EvidenceRetentionService(repo, storage, () => clock);
      await db.user.create({
        data: {
          id: userId,
          email: `${prefix}@example.test`,
          firstName: 'Synthetic',
          lastName: 'Fixture',
        },
      });
      await db.providerProfile.create({
        data: { id: profileId, userId, displayName: 'Test', initials: 'TF' },
      });
      await db.verificationRequirementPolicy.create({
        data: { version: prefix, requirements: {}, retiredAt: start },
      });
    });
    beforeEach(async () => {
      clock = start;
      await clear();
      await storage.eraseObject(key);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      if (!db) return;
      try {
        await clear();
        await db.verificationRequirementPolicy.deleteMany({ where: { version: prefix } });
        await db.providerProfile.deleteMany({ where: { id: profileId } });
        await db.user.deleteMany({ where: { id: userId } });
        // Audit rows are deliberately retained in the disposable DB; no table-wide cleanup.
      } finally {
        if (storage) await storage.eraseObject(key);
        if (s3) {
          const { DeleteBucketCommand } = require('@aws-sdk/client-s3');
          await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
          s3.destroy();
        }
        storage?.close();
        await db.$disconnect();
        if (root) await rm(root, { recursive: true, force: true });
      }
    });
    it('plans, claims, removes real bytes, scrubs metadata and commits one audit/outbox receipt', async () => {
      await fixture();
      const originalDecision = await db.verificationDecision.findMany({ where: { caseId } });
      expect((await service.runOnce(policy, 'enforce')).completed).toBe(1);
      expect(await storage.head(key)).toBeNull();
      if (s3) {
        const { ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
        const inventory = (await s3.send(
          new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }),
        )) as ListObjectVersionsCommandOutput;
        expect(inventory.Versions ?? []).toHaveLength(0);
        expect(inventory.DeleteMarkers ?? []).toHaveLength(0);
      }
      const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      expect(asset).toMatchObject({
        storageKey: `erased/${assetId}`,
        sizeBytes: 0,
        originalFilename: null,
        sha256: null,
        ownerUserId: null,
      });
      expect(asset.deletedAt).not.toBeNull();
      expect(asset.erasureStartedAt).not.toBeNull();
      expect(
        (await db.verificationCase.findUniqueOrThrow({ where: { id: caseId } })).reviewerNotes,
      ).toBeNull();
      expect(await db.verificationDecision.findMany({ where: { caseId } })).toEqual(
        originalDecision,
      );
      const job = await db.evidenceRetentionJob.findFirstOrThrow({
        where: { mediaAssetId: assetId },
      });
      const audit = await db.auditEvent.findMany({
        where: {
          type: 'VERIFICATION_EVIDENCE_RETENTION',
          metadata: { path: ['jobId'], equals: job.id },
        },
      });
      expect(
        audit.filter((a) => (a.metadata as { phase: string }).phase === 'COMPLETED'),
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toMatch(/sensitive-synthetic|reviewer text|verification\//);
      expect(await db.outboxEvent.count({ where: { aggregateId: job.id } })).toBe(1);
      expect((await service.runOnce(policy, 'enforce')).completed).toBe(0);
    });
    it('shadow is genuinely read-only, including retainUntil and jobs', async () => {
      await fixture();
      expect((await service.runOnce(policy, 'shadow')).eligible).toBe(1);
      expect(await db.evidenceRetentionJob.count({ where: { mediaAssetId: assetId } })).toBe(0);
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).retainUntil,
      ).toBeNull();
      expect(await storage.head(key)).not.toBeNull();
    });
    it('concurrent planners converge, and two workers cannot claim the same lease', async () => {
      await fixture();
      const results = await Promise.all([
        repo.plan(assetId, caseId, policy, clock),
        repo.plan(assetId, caseId, policy, clock),
      ]);
      expect(results.sort()).toEqual(['EXISTING', 'PLANNED']);
      const claims = await Promise.all([repo.claim(clock, 120_000), repo.claim(clock, 120_000)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    });
    it('recovers an expired lease; an old worker cannot acknowledge the replacement', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const first = (await repo.claim(clock, 120_000))!;
      await repo.begin(first, clock);
      clock = new Date(clock.getTime() + 121_000);
      const second = (await repo.claim(clock, 120_000))!;
      expect(second.leaseToken).not.toBe(first.leaseToken);
      expect(await repo.complete(first, clock)).toBe(false);
      await repo.begin(second, clock);
      await storage.eraseObject(key);
      expect(await repo.complete(second, clock)).toBe(true);
    });
    it('outbox failure after real deletion never records false completion, and retry converges', async () => {
      await fixture();
      jest.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('synthetic-outbox-failure'));
      expect((await service.runOnce(policy, 'enforce')).failed).toBe(1);
      expect(await storage.head(key)).toBeNull();
      const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
      expect(asset.deletedAt).toBeNull();
      expect(asset.erasureStartedAt).not.toBeNull();
      const {
        EvidenceReadService,
      } = require('../../src/modules/provider/verification/media/evidence-read.service');
      const document = await db.verificationDocument.findUniqueOrThrow({
        where: { mediaAssetId: assetId },
      });
      await expect(
        new EvidenceReadService({ client: db }).authorizeRead({
          documentId: document.id,
          actorUserId: userId,
          actorHasEvidenceViewPermission: false,
          ipPrefix: null,
          userAgentHash: null,
        }),
      ).rejects.toMatchObject({ status: 404 });
      clock = new Date(clock.getTime() + 31_000);
      expect((await service.runOnce(policy, 'enforce')).completed).toBe(1);
      const job = await db.evidenceRetentionJob.findFirstOrThrow({
        where: { mediaAssetId: assetId },
      });
      expect(job.attempts).toBe(2);
      expect(await db.outboxEvent.count({ where: { aggregateId: job.id } })).toBe(1);
    });
    it('storage failure retains bytes and durable denial, retries then dead-letters', async () => {
      await fixture();
      jest.spyOn(storage, 'eraseObject').mockRejectedValue(new Error('synthetic-storage-failure'));
      await service.runOnce(policy, 'enforce');
      clock = new Date(clock.getTime() + 31_000);
      await service.runOnce(policy, 'enforce');
      const job = await db.evidenceRetentionJob.findFirstOrThrow({
        where: { mediaAssetId: assetId },
      });
      expect(job.status).toBe('DEAD');
      expect(job.attempts).toBe(2);
      expect(await storage.head(key)).not.toBeNull();
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).deletedAt,
      ).toBeNull();
      expect(await repo.claim(clock, 120_000)).toBeNull();
    });
    it('repeated crashes cannot get an unlimited retry budget', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await repo.claim(clock, 1000)).not.toBeNull();
        clock = new Date(clock.getTime() + 1001);
      }
      const exhausted = (await repo.claim(clock, 120_000))!;
      expect(await repo.begin(exhausted, clock)).toBeNull();
      expect(
        (await db.evidenceRetentionJob.findUniqueOrThrow({ where: { id: exhausted.id } })).status,
      ).toBe('DEAD');
      expect(await storage.head(key)).not.toBeNull();
    });
    it('a resumed draft cancels an unstarted erasure rather than deleting a live review', async () => {
      await fixture('DRAFT');
      await repo.plan(assetId, caseId, policy, clock);
      await db.verificationCase.update({ where: { id: caseId }, data: { state: 'SUBMITTED' } });
      expect((await service.runOnce(policy, 'enforce')).completed).toBe(0);
      expect(
        (await db.evidenceRetentionJob.findFirstOrThrow({ where: { mediaAssetId: assetId } }))
          .status,
      ).toBe('CANCELLED');
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).retainUntil,
      ).toBeNull();
      expect(await storage.head(key)).not.toBeNull();
    });
    it('never rebases an existing job onto changed deployment defaults', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const before = await db.evidenceRetentionJob.findFirstOrThrow({
        where: { mediaAssetId: assetId },
      });
      expect(await repo.plan(assetId, caseId, { ...policy, verifiedDays: 300 }, clock)).toBe(
        'EXISTING',
      );
      expect(await db.evidenceRetentionJob.findUniqueOrThrow({ where: { id: before.id } })).toEqual(
        before,
      );
    });
    it('a hold postpones processing without silently discarding the job', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const until = new Date(clock.getTime() + 60_000);
      await db.evidenceRetentionJob.updateMany({
        where: { mediaAssetId: assetId },
        data: { holdUntil: until },
      });
      expect(await repo.claim(clock, 120_000)).toBeNull();
      clock = new Date(until.getTime() + 1);
      expect(await repo.claim(clock, 120_000)).not.toBeNull();
    });

    it('boots the independent built worker, serves protected metrics and shuts down gracefully', async () => {
      await fixture();
      const token = randomUUID();
      const child = spawn(
        process.execPath,
        [join(__dirname, '../../dist/evidence-retention.worker.js')],
        {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: process.env.DATABASE_URL,
            EVIDENCE_RETENTION_MODE: 'enforce',
            EVIDENCE_RETENTION_APPROVAL_REF: 'CI.POLICY',
            EVIDENCE_RETENTION_INFRA_REF: 'CI.DISPOSABLE',
            EVIDENCE_RETENTION_INTERVAL_MS: '1000',
            EVIDENCE_RETENTION_BATCH: '1',
            EVIDENCE_RETENTION_PORT: '19091',
            METRICS_TOKEN: token,
            EVIDENCE_RETAIN_VERIFIED_DAYS: '1',
            STORAGE_DRIVER: backend,
            RESTRICTED_STORAGE_DIR: root,
            S3_ENDPOINT: process.env.RETENTION_TEST_S3_ENDPOINT,
            S3_RESTRICTED_BUCKET: bucket,
            S3_ACCESS_KEY_ID: process.env.RETENTION_TEST_S3_USER,
            S3_SECRET_ACCESS_KEY: process.env.RETENTION_TEST_S3_SECRET,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (part: Buffer) => {
        output = (output + part.toString()).slice(-10000);
      });
      child.stderr.on('data', (part: Buffer) => {
        output = (output + part.toString()).slice(-10000);
      });
      const exited = new Promise<number | null>((resolve) =>
        child.once('exit', (code) => resolve(code)),
      );
      try {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          if ((await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).deletedAt) break;
          if (child.exitCode !== null) throw new Error('independent-worker-exited-before-erasure');
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(
          (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).deletedAt,
        ).not.toBeNull();
        expect((await fetch('http://127.0.0.1:19091/health/ready')).status).toBe(200);
        expect((await fetch('http://127.0.0.1:19091/metrics')).status).toBe(404);
        const metrics = await fetch('http://127.0.0.1:19091/metrics', {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(metrics.status).toBe(200);
        expect(await metrics.text()).toContain('evidence_retention_jobs');
        expect(output).not.toContain('sensitive-synthetic');
        expect(output).not.toContain(key);
        child.kill('SIGTERM');
        expect(await exited).toBe(0);
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await exited;
      }
    });
    it('constraints prevent invalid leases, duplicate live jobs and destructive asset cascades', async () => {
      await fixture();
      await repo.plan(assetId, caseId, policy, clock);
      const j = await db.evidenceRetentionJob.findFirstOrThrow({
        where: { mediaAssetId: assetId },
      });
      await expect(
        db.evidenceRetentionJob.update({
          where: { id: j.id },
          data: { leaseToken: 'invalid-half-lease' },
        }),
      ).rejects.toThrow();
      await expect(
        db.evidenceRetentionJob.create({
          data: { ...j, policySnapshot: policy, id: randomUUID(), intentKey: randomUUID() },
        }),
      ).rejects.toThrow();
      await expect(db.mediaAsset.delete({ where: { id: assetId } })).rejects.toThrow();
    });
  },
);
