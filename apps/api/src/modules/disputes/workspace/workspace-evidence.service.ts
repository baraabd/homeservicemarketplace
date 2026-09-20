import { sanitizedRedactedPng } from './redacted-png';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma, type DisputeEvidence } from '@homeservicemarketplace/database';
import { z } from 'zod';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../infrastructure/storage/restricted-object-storage.port';
import {
  MALWARE_SCANNER_PORT,
  MalwareScannerPort,
} from '../../provider/verification/media/malware-scanner.port';
import { detectEvidenceMime } from '../../provider/verification/media/file-signature';
import { AppError } from '../../../shared/errors/app-error';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceCipher } from './workspace-cipher.service';
import { WorkspaceEvents } from './workspace-events.service';
import {
  conflict,
  digest,
  forbidden,
  frozenPolicy,
  hoursAfter,
  missing,
  WORKSPACE_PERMISSIONS as P,
} from './workspace.policy';

export const DISPUTE_FILE_MAX_BYTES = 5 * 1024 * 1024;
const uploadSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    sourceEvidenceId: z.string().min(1).max(100).optional(),
  })
  .strict();
export interface CaseUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

@Injectable()
export class WorkspaceEvidence {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly transactions: TransactionRunner,
    private readonly cipher: WorkspaceCipher,
    private readonly events: WorkspaceEvents,
    @Inject(RESTRICTED_OBJECT_STORAGE) private readonly storage: RestrictedObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
  ) {}
  async upload(
    actorId: string,
    disputeId: string,
    raw: unknown,
    file: CaseUpload | undefined,
    reviewer = false,
  ) {
    const parsed = uploadSchema.safeParse(raw);
    const mime = file ? detectEvidenceMime(file.buffer) : null;
    if (
      !parsed.success ||
      !file ||
      !mime ||
      file.mimetype !== mime ||
      file.size !== file.buffer.length ||
      file.size === 0 ||
      file.size > DISPUTE_FILE_MAX_BYTES
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Choose a supported PNG, JPEG or PDF of at most 5 MiB.',
        400,
      );
    if (parsed.data.sourceEvidenceId) {
      const buffer = sanitizedRedactedPng(file.buffer);
      file = { buffer, mimetype: 'image/png', size: buffer.length };
    }
    this.cipher.ready();
    const intentDigest = digest([disputeId, actorId, parsed.data.idempotencyKey]);
    const contentDigest = hash(file.buffer);
    const lease = randomUUID();
    const prepared = await this.transactions.run(async (tx) => {
      const w = await this.repository.lock(disputeId, tx);
      const actor = await this.repository.actor(actorId, w, tx, reviewer);
      if (actor.role === 'REVIEWER' && !actor.permissions.has(P.EVIDENCE_READ)) throw forbidden();
      const sourceId = parsed.data.sourceEvidenceId ?? null;
      const prior = await tx.disputeEvidence.findUnique({ where: { intentDigest } });
      if (prior && (prior.contentDigest !== contentDigest || prior.sourceEvidenceId !== sourceId))
        throw conflict('UPLOAD_INTENT_REUSED');
      if (prior && (prior.erasedAt || prior.erasureStartedAt)) throw conflict('UPLOAD_EXPIRED');
      if (prior && prior.state !== 'PREPARED') return { row: prior, write: false };
      if (!['GATHERING', 'APPEALED'].includes(w.state)) throw conflict('EVIDENCE_UPLOAD_CLOSED');
      if (sourceId) {
        this.repository.requireAssigned(actor, w, P.SHARE_REDACTED_EVIDENCE);
        const source = await tx.disputeEvidence.findFirst({
          where: {
            id: sourceId,
            disputeId,
            state: 'CLEAN',
            erasedAt: null,
            erasureStartedAt: null,
            sourceEvidenceId: null,
            retainUntil: { gt: new Date() },
          },
        });
        if (!source) throw conflict('SOURCE_EVIDENCE_UNAVAILABLE');
        if (source.contentDigest === contentDigest) throw conflict('REDACTED_COPY_MUST_DIFFER');
      } else if (actor.role === 'REVIEWER') throw forbidden();
      if (prior?.leaseUntil && prior.leaseUntil > new Date()) return { row: prior, write: false };
      if (prior && prior.uploadExpiresAt <= new Date()) throw conflict('UPLOAD_EXPIRED');
      if (!prior) {
        const duplicate = await tx.disputeEvidence.findFirst({
          where: {
            disputeId,
            authorId: actorId,
            contentDigest,
            sourceEvidenceId: sourceId,
            erasedAt: null,
            erasureStartedAt: null,
          },
        });
        if (duplicate) return { row: duplicate, write: false };
        if ((await tx.disputeEvidence.count({ where: { disputeId, erasedAt: null } })) >= 20)
          throw conflict('EVIDENCE_LIMIT');
      }
      const now = new Date();
      const p = frozenPolicy(w.policySnapshot);
      const id = prior?.id ?? randomUUID();
      const row = prior
        ? await tx.disputeEvidence.update({
            where: { id },
            data: { leaseToken: lease, leaseUntil: hoursAfter(now, 1 / 60) },
          })
        : await tx.disputeEvidence.create({
            data: {
              id,
              disputeId,
              authorId: actorId,
              intentDigest,
              contentDigest,
              // Existing public-media backstop already denies the verification namespace.
              storageKey: `verification/disputes/${id}.enc`,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              sourceEvidenceId: sourceId,
              uploadExpiresAt: hoursAfter(now, 1),
              retainUntil: hoursAfter(now, p.evidenceRetentionDays * 24),
              leaseToken: lease,
              leaseUntil: hoursAfter(now, 1 / 60),
            },
          });
      if (!prior)
        await this.events.append(tx, w, {
          actorId,
          actorRole: actor.role,
          kind: 'EVIDENCE_PREPARED',
          reasonCode: 'EVIDENCE_SUPPLIED',
          facts: { evidenceId: id },
        });
      return { row, write: true };
    });
    if (!prepared.write) return { id: prepared.row.id, state: prepared.row.state, replayed: true };
    const dir = await mkdtemp(join(tmpdir(), 'hsm-case-'));
    try {
      const bytes = Buffer.from(this.cipher.seal(file.buffer, `evidence:${prepared.row.id}`));
      const path = join(dir, 'encrypted');
      await writeFile(path, bytes, { mode: 0o600 });
      await this.storage.putObjectFromFile({
        key: prepared.row.storageKey!,
        sourcePath: path,
        sizeBytes: bytes.length,
        contentType: 'application/octet-stream',
      });
      return await this.transactions.run(async (tx) => {
        const w = await this.repository.lock(disputeId, tx);
        await this.repository.actor(actorId, w, tx, reviewer);
        const row = await tx.disputeEvidence.findUnique({ where: { id: prepared.row.id } });
        if (!row || row.leaseToken !== lease || row.state !== 'PREPARED')
          throw conflict('UPLOAD_LEASE_CHANGED');
        if (!['GATHERING', 'APPEALED'].includes(w.state) || row.uploadExpiresAt <= new Date())
          throw conflict('UPLOAD_CLOSED');
        await tx.disputeEvidence.update({
          where: { id: row.id },
          data: { state: 'STORED', leaseToken: null, leaseUntil: null, nextAttemptAt: new Date() },
        });
        await this.events.append(tx, w, {
          actorId,
          actorRole: reviewer ? 'REVIEWER' : actorId === w.seekerUserId ? 'SEEKER' : 'PROVIDER',
          kind: 'EVIDENCE_STORED',
          reasonCode: 'SCAN_REQUIRED',
          facts: { evidenceId: row.id },
        });
        return { id: row.id, state: 'STORED', replayed: false };
      });
    } catch (error) {
      // A durable PREPARED row remains even after an object write followed by a
      // transaction failure. The maintenance pass can reclaim it after expiry.
      await this.repository.prisma.client.disputeEvidence
        .updateMany({
          where: { id: prepared.row.id, leaseToken: lease, state: 'PREPARED' },
          data: { leaseToken: null, leaseUntil: null, lastErrorCode: 'UPLOAD_NOT_FINALIZED' },
        })
        .catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Evidence upload could not be confirmed. Retry the same file.',
        503,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  private async bytes(row: DisputeEvidence): Promise<Buffer> {
    if (!row.storageKey) throw new Error('evidence-unavailable');
    const stream = await this.storage.openReadStream(row.storageKey);
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of stream) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > 8 * 1024 * 1024) throw new Error('evidence-oversized');
        chunks.push(b);
      }
    } finally {
      stream.destroy();
    }
    const plaintext = this.cipher.open(
      Buffer.concat(chunks).toString('utf8'),
      `evidence:${row.id}`,
    );
    if (
      plaintext.length !== row.sizeBytes ||
      hash(plaintext) !== row.contentDigest ||
      detectEvidenceMime(plaintext) !== row.mimeType
    )
      throw new Error('evidence-integrity-failed');
    return plaintext;
  }
  async read(actorId: string, disputeId: string, evidenceId: string, reviewer = false) {
    const row = await this.transactions.run(async (tx) => {
      const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
      if (!w) throw missing();
      const actor = await this.repository.actor(actorId, w, tx, reviewer);
      const e = await tx.disputeEvidence.findFirst({ where: { id: evidenceId, disputeId } });
      if (
        !e ||
        e.state !== 'CLEAN' ||
        e.erasedAt ||
        e.erasureStartedAt ||
        e.retainUntil <= new Date()
      )
        throw missing();
      if (
        actor.role === 'REVIEWER'
          ? !actor.permissions.has(P.EVIDENCE_READ)
          : e.authorId !== actorId && (!e.sharedAt || !e.sourceEvidenceId)
      )
        throw missing();
      await tx.auditEvent.create({
        data: {
          userId: actorId,
          type: 'DISPUTE_EVIDENCE_READ',
          metadata: { disputeId, evidenceId, policyVersion: w.policyVersion },
        },
      });
      return e;
    });
    let bytes: Buffer;
    try {
      bytes = await this.bytes(row);
    } catch {
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Evidence could not be verified.', 503);
    }
    // Authorization/auditing precede storage I/O; recheck after I/O so a revoked
    // reviewer or newly fenced object cannot complete a delayed read.
    await this.transactions.run(async (tx) => {
      const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
      if (!w) throw missing();
      const actor = await this.repository.actor(actorId, w, tx, reviewer);
      const e = await tx.disputeEvidence.findUnique({ where: { id: evidenceId } });
      if (
        !e ||
        e.state !== 'CLEAN' ||
        e.erasedAt ||
        e.erasureStartedAt ||
        e.retainUntil <= new Date()
      )
        throw missing();
      if (
        actor.role === 'REVIEWER'
          ? !actor.permissions.has(P.EVIDENCE_READ)
          : e.authorId !== actorId && (!e.sharedAt || !e.sourceEvidenceId)
      )
        throw missing();
    });
    return { bytes, mimeType: row.mimeType };
  }
  async scanOne(): Promise<boolean> {
    const token = randomUUID();
    // This claim holds only evidence locks and commits BEFORE taking a case lock.
    const rows = await this.repository.prisma.client.$queryRaw<DisputeEvidence[]>(Prisma.sql`
      WITH candidate AS MATERIALIZED (SELECT "id" FROM "DisputeEvidence"
        WHERE "erasureStartedAt" IS NULL AND "erasedAt" IS NULL AND "retainUntil">NOW()
          AND "attempts"<5 AND (("state" IN ('STORED','SCAN_FAILED') AND "nextAttemptAt"<=NOW())
            OR ("state"='SCANNING' AND "leaseUntil"<=NOW()))
        ORDER BY "nextAttemptAt","id" FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE "DisputeEvidence" e SET "state"='SCANNING',"attempts"=e."attempts"+1,
        "leaseToken"=${token},"leaseUntil"=NOW()+INTERVAL '2 minutes',"updatedAt"=NOW()
      FROM candidate c WHERE e."id"=c."id" RETURNING e.*`);
    const row = rows[0];
    if (!row) return false;
    let state = 'SCAN_FAILED';
    let scannerId: string | null = null;
    try {
      const bytes = await this.bytes(row);
      const verdict = await this.scanner.scan({ bytes, assetId: row.id });
      if (this.scanner.isRealScanner && verdict.state === 'CLEAN') {
        state = 'CLEAN';
        scannerId = verdict.scannerId;
      } else if (this.scanner.isRealScanner && verdict.state === 'INFECTED') {
        state = 'QUARANTINED';
        scannerId = verdict.scannerId;
      }
    } catch {
      /* Operational failures never certify CLEAN and never log private values. */
    }
    if (state === 'SCAN_FAILED' && row.attempts >= 5) state = 'DEAD';
    await this.transactions.run(async (tx) => {
      const w = await this.repository.lock(row.disputeId, tx);
      const current = await tx.disputeEvidence.findUnique({ where: { id: row.id } });
      if (
        !current ||
        current.leaseToken !== token ||
        current.state !== 'SCANNING' ||
        current.erasureStartedAt ||
        current.erasedAt ||
        !current.leaseUntil ||
        current.leaseUntil <= new Date()
      )
        return;
      await tx.disputeEvidence.update({
        where: { id: row.id },
        data: {
          state,
          scannerId,
          scannedAt: ['CLEAN', 'QUARANTINED'].includes(state) ? new Date() : null,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** row.attempts * 15) * 1000),
          lastErrorCode: ['SCAN_FAILED', 'DEAD'].includes(state) ? 'SCAN_NOT_CONFIRMED' : null,
        },
      });
      await this.events.append(tx, w, {
        actorId: null,
        actorRole: 'SYSTEM',
        kind: 'EVIDENCE_SCAN_UPDATED',
        reasonCode: state,
        facts: { evidenceId: row.id, state },
        notify: [row.authorId],
      });
    });
    return true;
  }
  async eraseOne(): Promise<boolean> {
    const now = new Date();
    const candidate = await this.repository.prisma.client.disputeEvidence.findFirst({
      where: {
        erasedAt: null,
        OR: [
          { retainUntil: { lte: now } },
          { state: 'PREPARED', uploadExpiresAt: { lte: now } },
          { erasureStartedAt: { not: null } },
        ],
        AND: [
          { OR: [{ holdUntil: null }, { holdUntil: { lte: now } }] },
          { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
          { OR: [{ erasureStartedAt: null }, { nextAttemptAt: { lte: now } }] },
        ],
        NOT: { state: 'ERASURE_DEAD' },
      },
      orderBy: [{ retainUntil: 'asc' }, { id: 'asc' }],
    });
    if (!candidate) return false;
    const token = randomUUID();
    const owned = await this.transactions.run(async (tx) => {
      await this.repository.lock(candidate.disputeId, tx);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "DisputeEvidence" WHERE "id"=${candidate.id} FOR UPDATE`,
      );
      const e = await tx.disputeEvidence.findUnique({ where: { id: candidate.id } });
      if (
        !e ||
        e.erasedAt ||
        (e.holdUntil && e.holdUntil > now) ||
        (e.leaseUntil && e.leaseUntil > now) ||
        e.state === 'ERASURE_DEAD'
      )
        return null;
      if (e.erasureStartedAt && e.attempts >= 5) {
        await tx.disputeEvidence.update({
          where: { id: e.id },
          data: {
            state: 'ERASURE_DEAD',
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: 'ERASURE_ATTEMPTS_EXHAUSTED',
          },
        });
        return null;
      }
      if (
        !e.erasureStartedAt &&
        e.retainUntil > now &&
        !(e.state === 'PREPARED' && e.uploadExpiresAt <= now)
      )
        return null;
      return tx.disputeEvidence.update({
        where: { id: e.id },
        data: {
          state: 'ERASING',
          erasureStartedAt: e.erasureStartedAt ?? now,
          attempts: e.erasureStartedAt ? e.attempts + 1 : 1,
          leaseToken: token,
          leaseUntil: hoursAfter(now, 2 / 60),
        },
      });
    });
    if (!owned) return true;
    try {
      if (!owned.storageKey) throw new Error('missing-deletion-provenance');
      const result = await this.storage.eraseObject(owned.storageKey);
      if (!result.verifiedAbsent) throw new Error('unconfirmed');
      await this.transactions.run(async (tx) => {
        const w = await this.repository.lock(owned.disputeId, tx);
        const e = await tx.disputeEvidence.findUnique({ where: { id: owned.id } });
        if (
          !e ||
          e.leaseToken !== token ||
          e.state !== 'ERASING' ||
          !e.leaseUntil ||
          e.leaseUntil <= new Date()
        )
          return;
        await tx.disputeEvidence.update({
          where: { id: e.id },
          data: {
            state: 'ERASED',
            erasedAt: new Date(),
            storageKey: null,
            contentDigest: '',
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: null,
          },
        });
        await this.events.append(tx, w, {
          actorId: null,
          actorRole: 'SYSTEM',
          kind: 'EVIDENCE_ERASED',
          reasonCode: 'RETENTION_DUE',
          facts: { evidenceId: e.id, scope: result.scope },
        });
      });
    } catch {
      await this.repository.prisma.client.disputeEvidence.updateMany({
        where: { id: owned.id, leaseToken: token, state: 'ERASING' },
        data: {
          state: owned.attempts >= 5 ? 'ERASURE_DEAD' : 'ERASING',
          lastErrorCode: 'ERASURE_UNCONFIRMED',
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: hoursAfter(new Date(), Math.min(1, 2 ** owned.attempts / 60)),
        },
      });
    }
    return true;
  }
}
