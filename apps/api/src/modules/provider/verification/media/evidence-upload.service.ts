import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import type {
  PrismaTx,
  VerificationCaseState,
  VerificationDocumentKind,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../../infrastructure/storage/restricted-object-storage.port';
import { AppError } from '../../../../shared/errors/app-error';
import { AuditService } from '../../../iam/audit/audit.service';
import { VerificationSettingsService } from '../verification-settings.service';
import { buildEvidenceKey, newAssetId } from './evidence-keys';
import {
  EvidenceUploadError,
  INITIAL_EVIDENCE_SCAN_STATE,
  assertPrepareAllowed,
  decideFinalize,
} from './evidence-upload-policy';
import {
  SIGNATURE_PROBE_BYTES,
  safeDisplayFilename,
  verifyEvidenceSignature,
  type EvidenceMimeType,
} from './file-signature';

// Sprint 9B.3 — the restricted evidence WRITE path.
//
// docs/adr/0009-restricted-identity-media.md
//
// Three steps, and the split is not ceremony:
//
//   prepare   reserves a slot and mints a server-side key, so the expensive
//             checks (case state, requirement match, limits) happen before a
//             byte is transferred.
//   content   streams the bytes under a hard cap, decides what they ACTUALLY
//             are, and promotes them to the restricted namespace.
//   finalize  proves the object is really there, then links a
//             VerificationDocument in one transaction.
//
// Every method takes a USER id. Ownership is derived through
// case.providerProfile.userId — never from a caller-supplied provider or case
// id — so an IDOR is not something to remember to check, it is unrepresentable.
//
// EVERY denial answers 404 with the same body. A caller must not be able to
// tell a case that is not theirs from one that does not exist; anything finer
// is an enumeration oracle over exactly the set we least want enumerated.

/** Case states in which a provider may still add evidence. Mirrors the
 *  `submit` edge of VERIFICATION_CASE_TRANSITIONS: those are the states a
 *  provider can act from. */
const EVIDENCE_ACCEPTING_STATES: readonly VerificationCaseState[] = Object.freeze([
  'DRAFT',
  'ACTION_REQUIRED',
]);

export interface PrepareInput {
  kind: VerificationDocumentKind;
  serviceCategoryId?: string | null;
  declaredMime: string;
  sizeBytes: number;
  filename?: string | null;
}

export interface PreparedUpload {
  assetId: string;
  expiresAt: string;
  maxBytes: number;
  /** False when an existing open preparation was returned instead. */
  created: boolean;
}

export interface FinalizedUpload {
  documentId: string;
  assetId: string;
  kind: VerificationDocumentKind;
  serviceCategoryId: string | null;
  scanState: string;
  /** False when an already-finalized upload was returned instead. */
  created: boolean;
}

/** One 404, used for every denial. */
function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Not found.', 404);
}

@Injectable()
export class EvidenceUploadService {
  private readonly log = new Logger(EvidenceUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly settings: VerificationSettingsService,
    @Inject(RESTRICTED_OBJECT_STORAGE)
    private readonly objects: RestrictedObjectStoragePort,
  ) {}

  // ── 1. prepare ─────────────────────────────────────────────────────────

  async prepare(userId: string, input: PrepareInput): Promise<PreparedUpload> {
    const kase = await this.ownOpenCase(userId);

    if (!EVIDENCE_ACCEPTING_STATES.includes(kase.state)) {
      // A case under review or already decided does not take new evidence.
      // Same 404 as everything else: the caller learns nothing about state.
      throw notFound();
    }

    const requirement = matchRequirement(kase.requirementsSnapshot, {
      kind: input.kind,
      serviceCategoryId: input.serviceCategoryId ?? null,
    });
    if (!requirement) {
      throw new AppError(
        'VALIDATION_ERROR',
        'That document is not required for this verification.',
        400,
        { reason: 'NOT_REQUIRED' },
      );
    }

    const limits = await this.settings.evidenceLimits();
    const liveDocumentCount = await this.prisma.client.verificationDocument.count({
      where: { caseId: kase.id, supersededAt: null },
    });

    try {
      assertPrepareAllowed({
        declaredMime: input.declaredMime,
        sizeBytes: input.sizeBytes,
        liveDocumentCount,
        limits,
      });
    } catch (err) {
      throw toAppError(err);
    }

    const assetId = newAssetId();
    const expiresAt = new Date(Date.now() + limits.uploadTtlSeconds * 1000);
    // Built entirely from server values. The declared type only chooses the
    // extension; content validation at the next step refuses any mismatch, so
    // a lie here cannot survive to a stored object.
    const storageKey = buildEvidenceKey({
      caseId: kase.id,
      assetId,
      detectedMime: input.declaredMime as EvidenceMimeType,
    });

    try {
      const asset = await this.tx.run(async (trx: PrismaTx) => {
        const created = await trx.mediaAsset.create({
          data: {
            id: assetId,
            visibility: 'RESTRICTED',
            storageKey,
            declaredMimeType: input.declaredMime,
            // The DECLARED length. Replaced by the counted one at content time;
            // this is only here so the row is well-formed before bytes exist.
            sizeBytes: input.sizeBytes,
            scanState: INITIAL_EVIDENCE_SCAN_STATE,
            ownerUserId: userId,
            originalFilename: safeDisplayFilename(input.filename ?? null),
            verificationCaseId: kase.id,
            uploadExpiresAt: expiresAt,
            pendingDocumentKind: input.kind,
            pendingServiceCategoryId: requirement.serviceCategoryId,
          },
          select: { id: true, uploadExpiresAt: true },
        });

        await this.audit.record(
          {
            type: 'VERIFICATION_EVIDENCE_PREPARED',
            userId,
            metadata: { caseId: kase.id, providerProfileId: kase.providerProfileId },
          },
          trx,
        );
        return created;
      });

      return {
        assetId: asset.id,
        expiresAt: (asset.uploadExpiresAt ?? expiresAt).toISOString(),
        maxBytes: limits.maxBytes,
        created: true,
      };
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;

      // The slot is already held by an open preparation. That is the ordinary
      // retry, so return the existing one rather than erroring — the partial
      // unique index is what makes this deterministic under concurrency.
      const existing = await this.prisma.client.mediaAsset.findFirst({
        where: {
          verificationCaseId: kase.id,
          pendingDocumentKind: input.kind,
          pendingServiceCategoryId: requirement.serviceCategoryId,
          uploadCompletedAt: null,
          deletedAt: null,
        },
        select: { id: true, uploadExpiresAt: true },
      });
      if (!existing) throw err;

      return {
        assetId: existing.id,
        expiresAt: (existing.uploadExpiresAt ?? new Date()).toISOString(),
        maxBytes: limits.maxBytes,
        created: false,
      };
    }
  }

  // ── 2. content ─────────────────────────────────────────────────────────

  /**
   * Stream the bytes in, decide what they actually are, and promote them.
   *
   * Nothing the client said is trusted: not the declared type, not
   * Content-Length, not the filename, not the extension. The size is COUNTED,
   * the type comes from the leading bytes, and the hash is computed from what
   * arrived.
   *
   * Bytes land in a staging file first, so a truncated or rejected upload never
   * exists under the real key. Only a fully validated file is promoted.
   */
  async acceptContent(
    userId: string,
    assetId: string,
    body: Readable,
    declaredMime: string,
  ): Promise<{ sizeBytes: number; detectedMime: string }> {
    const asset = await this.ownPreparedAsset(userId, assetId);
    const limits = await this.settings.evidenceLimits();

    if (asset.uploadCompletedAt !== null) {
      // Already finalized. Re-uploading would replace bytes a reviewer may have
      // already judged, so it is refused rather than treated as a retry.
      throw new AppError('CONFLICT', 'This upload is already complete.', 409, {
        reason: 'ALREADY_FINALIZED',
      });
    }
    if (asset.uploadExpiresAt && asset.uploadExpiresAt.getTime() < Date.now()) {
      throw new AppError('CONFLICT', 'This upload window has expired.', 409, {
        reason: 'UPLOAD_EXPIRED',
      });
    }

    const stagingDir = await mkdtemp(join(tmpdir(), 'hsm-evidence-'));
    const stagingPath = join(stagingDir, 'upload.bin');

    let received = 0;
    const hash = createHash('sha256');
    const probe: Buffer[] = [];
    let probeBytes = 0;
    let tooLarge = false;

    // A Transform rather than a buffer: the cap is enforced as bytes pass, so
    // an oversized upload is cut off mid-flight instead of being accumulated
    // and measured afterwards. Content-Length is never consulted — it is a
    // client claim, and this is the number that actually matters.
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > limits.maxBytes) {
          tooLarge = true;
          cb(new Error('too-large'));
          return;
        }
        hash.update(chunk);
        if (probeBytes < SIGNATURE_PROBE_BYTES) {
          probe.push(chunk.subarray(0, SIGNATURE_PROBE_BYTES - probeBytes));
          probeBytes += Math.min(chunk.length, SIGNATURE_PROBE_BYTES - probeBytes);
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(body, meter, createWriteStream(stagingPath));
    } catch {
      await this.discard(stagingDir);
      if (tooLarge) {
        throw new AppError('VALIDATION_ERROR', 'That file is too large.', 413, {
          reason: 'TOO_LARGE',
        });
      }
      this.log.warn({ msg: 'evidence.upload.stream_failed', assetId });
      throw new AppError('VALIDATION_ERROR', 'The upload did not complete.', 400, {
        reason: 'STREAM_FAILED',
      });
    }

    if (received === 0) {
      await this.discard(stagingDir);
      throw new AppError('VALIDATION_ERROR', 'The uploaded file is empty.', 400, {
        reason: 'EMPTY_FILE',
      });
    }

    // What the bytes ACTUALLY are, compared with what was claimed. Both halves
    // matter: trusting the claim stores an executable as image/png; trusting
    // only the bytes lets a caller mislabel a PDF as a photo in the reviewer UI.
    const verdict = verifyEvidenceSignature(declaredMime, Buffer.concat(probe));
    if (!verdict.ok) {
      await this.discard(stagingDir);
      throw new AppError('VALIDATION_ERROR', 'That file type is not accepted.', 400, {
        reason: verdict.code,
      });
    }

    const sha256 = hash.digest('hex');

    try {
      await this.objects.putObjectFromFile({
        key: asset.storageKey,
        sourcePath: stagingPath,
        contentType: verdict.detected,
        sizeBytes: received,
      });
    } catch {
      await this.discard(stagingDir);
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Storage is unavailable. Try again shortly.',
        503,
      );
    }

    try {
      await this.prisma.client.mediaAsset.update({
        where: { id: asset.id },
        data: {
          detectedMimeType: verdict.detected,
          // The COUNTED length, replacing whatever was declared at prepare.
          sizeBytes: received,
          sha256,
        },
      });
    } catch (err) {
      // Compensation: the object landed but the row did not. Leaving it would
      // be an orphan in a bucket that holds passports, so it is removed before
      // the error surfaces.
      await this.objects.deleteObject(asset.storageKey).catch(() => undefined);
      await this.discard(stagingDir);
      throw err;
    }

    await this.discard(stagingDir);
    // Size and type only. No key, no filename, no hash — a hash is a stable
    // correlation identifier for a document, which is exactly what an audit
    // log should not hand out.
    this.log.log({ msg: 'evidence.upload.stored', bytes: received, type: verdict.detected });

    return { sizeBytes: received, detectedMime: verdict.detected };
  }

  // ── 3. finalize ────────────────────────────────────────────────────────

  async finalize(userId: string, assetId: string): Promise<FinalizedUpload> {
    const asset = await this.ownPreparedAsset(userId, assetId);

    const existingDocument = await this.prisma.client.verificationDocument.findUnique({
      where: { mediaAssetId: asset.id },
      select: { id: true, kind: true, serviceCategoryId: true },
    });

    const limits = await this.settings.evidenceLimits();
    const ttlSeconds = asset.uploadExpiresAt
      ? Math.max(
          0,
          Math.round((asset.uploadExpiresAt.getTime() - asset.createdAt.getTime()) / 1000),
        )
      : limits.uploadTtlSeconds;

    // The object must be PROVEN present before anything is marked complete.
    const head = await this.objects.head(asset.storageKey);

    let decision;
    try {
      decision = decideFinalize({
        asset: {
          uploadCompletedAt: asset.uploadCompletedAt,
          createdAt: asset.createdAt,
          deletedAt: asset.deletedAt,
        },
        objectExists: head !== null,
        hasDocument: existingDocument !== null,
        now: new Date(),
        ttlSeconds,
      });
    } catch (err) {
      // INCONSISTENT_STATE is the one refusal that can be a LIE.
      //
      // decideFinalize refuses when `uploadCompletedAt !== hasDocument`, which
      // is right for a genuinely corrupt row. But those two facts are read by
      // two separate queries — Prisma's `include` issues its own query too, so
      // there is no single-statement snapshot to hide behind — and a concurrent
      // finalize commits between them. The loser then sees a combination that
      // existed in NO committed state, and a provider whose upload actually
      // succeeded is told it is broken.
      //
      // The document and the uploadCompletedAt stamp are written in ONE
      // transaction, so committed state always has both or neither. Re-reading
      // them inside a transaction therefore distinguishes the two cases: a
      // document that is really there means the upload really finalized, and
      // the honest answer is the winner's result.
      if ((err as { code?: string })?.code === 'INCONSISTENT_STATE') {
        const settled = await this.tx.run(async (trx: PrismaTx) => {
          const [row, doc] = await Promise.all([
            trx.mediaAsset.findUnique({
              where: { id: asset.id },
              select: { uploadCompletedAt: true },
            }),
            trx.verificationDocument.findUnique({
              where: { mediaAssetId: asset.id },
              select: { id: true, kind: true, serviceCategoryId: true },
            }),
          ]);
          return { completed: row?.uploadCompletedAt ?? null, doc };
        });

        if (settled.doc && settled.completed) {
          return {
            documentId: settled.doc.id,
            assetId: asset.id,
            kind: settled.doc.kind,
            serviceCategoryId: settled.doc.serviceCategoryId,
            scanState: asset.scanState,
            created: false,
          };
        }
      }
      throw toAppError(err);
    }

    if (decision.action === 'ALREADY_FINALIZED') {
      // The exact idempotent replay: same document, same answer.
      return {
        documentId: existingDocument!.id,
        assetId: asset.id,
        kind: existingDocument!.kind,
        serviceCategoryId: existingDocument!.serviceCategoryId,
        scanState: asset.scanState,
        created: false,
      };
    }

    // The bytes must match what the content step recorded. A shorter object
    // means a truncated or replaced upload, and finalising it would attach a
    // document to something nobody validated.
    if (head!.sizeBytes !== asset.sizeBytes || asset.sha256 === null) {
      this.log.warn({ msg: 'evidence.finalize.object_mismatch', assetId });
      throw new AppError('CONFLICT', 'The uploaded file is incomplete.', 409, {
        reason: 'OBJECT_MISMATCH',
      });
    }

    if (!asset.pendingDocumentKind) throw notFound();

    try {
      const document = await this.tx.run(async (trx: PrismaTx) => {
        // Supersede an earlier live document in the same slot. The old row
        // stays: what was originally shown is part of the record.
        await trx.verificationDocument.updateMany({
          where: {
            caseId: asset.verificationCaseId!,
            kind: asset.pendingDocumentKind!,
            serviceCategoryId: asset.pendingServiceCategoryId,
            supersededAt: null,
          },
          data: { supersededAt: new Date() },
        });

        const created = await trx.verificationDocument.create({
          data: {
            caseId: asset.verificationCaseId!,
            kind: asset.pendingDocumentKind!,
            serviceCategoryId: asset.pendingServiceCategoryId,
            mediaAssetId: asset.id,
            uploadedByUserId: userId,
          },
          select: { id: true, kind: true, serviceCategoryId: true },
        });

        // Only NOW is the upload complete — after the object was proven present
        // and the link exists. Scan state stays PENDING: 9B.4's scanner is the
        // only thing allowed to move it, and CLEAN is the only readable state.
        await trx.mediaAsset.update({
          where: { id: asset.id },
          data: { uploadCompletedAt: new Date() },
        });

        await this.audit.record(
          {
            type: 'VERIFICATION_EVIDENCE_ATTACHED',
            userId,
            // Ids and enum values only. No filename, no hash, no storage key:
            // a hash is a stable correlation identifier for a document, which
            // is exactly what a long-retained audit table must not hand out.
            metadata: { caseId: asset.verificationCaseId! },
          },
          trx,
        );

        return created;
      });

      return {
        documentId: document.id,
        assetId: asset.id,
        kind: document.kind,
        serviceCategoryId: document.serviceCategoryId,
        scanState: asset.scanState,
        created: true,
      };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        // Two finalize calls raced. The loser reports the winner's result
        // rather than a duplicate-key error.
        const winner = await this.prisma.client.verificationDocument.findUnique({
          where: { mediaAssetId: asset.id },
          select: { id: true, kind: true, serviceCategoryId: true },
        });
        if (winner) {
          return {
            documentId: winner.id,
            assetId: asset.id,
            kind: winner.kind,
            serviceCategoryId: winner.serviceCategoryId,
            scanState: asset.scanState,
            created: false,
          };
        }
      }
      throw err;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** The caller's own open case. 404 for "no profile", "no case" and "not
   *  yours" alike. */
  private async ownOpenCase(userId: string) {
    const kase = await this.prisma.client.verificationCase.findFirst({
      where: {
        providerProfile: { userId, deletedAt: null },
        state: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'] },
      },
      select: {
        id: true,
        state: true,
        providerProfileId: true,
        requirementsSnapshot: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!kase) throw notFound();
    return kase;
  }

  /**
   * A prepared asset the caller owns.
   *
   * Ownership derives through the CASE, not through ownerUserId: the case is
   * the thing a provider owns, and routing every check through it means a
   * future reviewer-side path cannot accidentally authorise by uploader.
   */
  private async ownPreparedAsset(userId: string, assetId: string) {
    const asset = await this.prisma.client.mediaAsset.findFirst({
      where: {
        id: assetId,
        visibility: 'RESTRICTED',
        verificationCase: { providerProfile: { userId, deletedAt: null } },
      },
      select: {
        id: true,
        storageKey: true,
        sizeBytes: true,
        sha256: true,
        scanState: true,
        createdAt: true,
        deletedAt: true,
        uploadCompletedAt: true,
        uploadExpiresAt: true,
        verificationCaseId: true,
        pendingDocumentKind: true,
        pendingServiceCategoryId: true,
        verificationCase: { select: { state: true } },
      },
    });
    if (!asset || !asset.verificationCaseId) throw notFound();
    return asset;
  }

  /** Remove a staging directory. Never throws: this runs on failure paths, and
   *  a cleanup error must not replace the error that caused it. */
  private async discard(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Does the case's IMMUTABLE requirement snapshot ask for this document? */
function matchRequirement(
  snapshot: unknown,
  want: { kind: VerificationDocumentKind; serviceCategoryId: string | null },
): { serviceCategoryId: string | null } | null {
  const requirements = (snapshot as { requirements?: unknown } | null)?.requirements;
  if (!Array.isArray(requirements)) return null;

  for (const raw of requirements) {
    const req = raw as { kind?: unknown; serviceCategoryId?: unknown };
    if (req.kind !== want.kind) continue;
    const reqCategory = (req.serviceCategoryId as string | null) ?? null;

    // CATEGORY_LICENSE carries the trade it satisfies; every other kind must
    // NOT carry one. Both directions are checked, so a category cannot be
    // smuggled onto a kind that ignores it.
    if (want.kind === 'CATEGORY_LICENSE') {
      if (want.serviceCategoryId === null) return null;
      if (reqCategory !== want.serviceCategoryId) continue;
    } else if (want.serviceCategoryId !== null) {
      return null;
    }
    return { serviceCategoryId: reqCategory };
  }
  return null;
}

function toAppError(err: unknown): AppError {
  if (err instanceof EvidenceUploadError) {
    const status =
      err.code === 'TOO_LARGE'
        ? 413
        : err.code === 'UPLOAD_EXPIRED' || err.code === 'INCONSISTENT_STATE'
          ? 409
          : err.code === 'OBJECT_MISSING' || err.code === 'ASSET_DELETED'
            ? 404
            : 400;
    const code = status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR';
    // OBJECT_MISSING and ASSET_DELETED answer the generic 404 body, so a
    // caller cannot distinguish them from "no such asset".
    return status === 404
      ? notFound()
      : new AppError(code, err.message, status, { reason: err.code });
  }
  if (err instanceof AppError) return err;
  throw err;
}
