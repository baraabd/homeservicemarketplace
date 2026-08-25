import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../../shared/errors/app-error';
import { auditOutcomeFor, decideEvidenceRead } from './evidence-read.policy';

// Sprint 9B — the I/O half of a restricted read.
//
// docs/adr/0009-restricted-identity-media.md §3
//
// The DECISION lives in evidence-read.policy.ts and is pure. This service does
// the three things a pure function cannot: load the facts, write the audit row,
// and hand back the storage key to the caller that streams it.
//
// Three invariants:
//
//   EVERY ATTEMPT IS AUDITED, including denials. A denied read is the more
//   interesting row of the two — it is what an intrusion looks like.
//
//   THE AUDIT IS WRITTEN EVEN WHEN THE READ IS REFUSED, and before the caller
//   is told anything. Auditing only successes produces a log that proves
//   nothing about the attempts that mattered.
//
//   NOTHING ABOUT THE CONTENT IS LOGGED. Ids and an outcome. No filename, no
//   storage key, no signed URL, no bytes (ADR 0009 §7).

/** What the controller needs to stream the object. The storage key is returned
 *  to the CONTROLLER, which resolves it against the restricted backend — it is
 *  never serialised to the client. */
export interface EvidenceReadGrant {
  storageKey: string;
  detectedMimeType: string;
  sizeBytes: number;
  /** Sanitised, for Content-Disposition. Already stripped of directory
   *  components, double extensions and bidi overrides. */
  displayFilename: string | null;
}

@Injectable()
export class EvidenceReadService {
  private readonly log = new Logger(EvidenceReadService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Authorize one read, audit it, and return what is needed to stream it.
   *
   * Throws a 404 for every denial. Not 403: a distinguishable status tells an
   * unauthenticated-but-curious caller which document ids exist, which is an
   * enumeration oracle over exactly the set we least want enumerated. The
   * AUDIT row records the true reason; the wire does not.
   */
  async authorizeRead(input: {
    documentId: string;
    actorUserId: string;
    actorHasEvidenceViewPermission: boolean;
    ipPrefix: string | null;
    userAgentHash: string | null;
  }): Promise<EvidenceReadGrant> {
    const doc = await this.prisma.client.verificationDocument.findUnique({
      where: { id: input.documentId },
      select: {
        id: true,
        caseId: true,
        case: {
          select: {
            id: true,
            providerProfile: { select: { userId: true } },
          },
        },
        mediaAsset: {
          select: {
            id: true,
            storageKey: true,
            visibility: true,
            scanState: true,
            deletedAt: true,
            detectedMimeType: true,
            sizeBytes: true,
            originalFilename: true,
          },
        },
      },
    });

    // An unknown id is audited too, where we can: without a case id there is
    // no row to hang it on, so this one is a log line rather than an audit
    // record. It still carries no content.
    if (!doc || !doc.mediaAsset) {
      this.log.warn({
        msg: 'evidence.read.unknown_document',
        actorUserId: input.actorUserId,
        documentId: input.documentId,
      });
      throw new AppError('NOT_FOUND', 'Document not found.', 404);
    }

    const decision = decideEvidenceRead({
      actorUserId: input.actorUserId,
      actorHasEvidenceViewPermission: input.actorHasEvidenceViewPermission,
      ownerUserId: doc.case.providerProfile?.userId ?? null,
      visibility: doc.mediaAsset.visibility,
      scanState: doc.mediaAsset.scanState,
      evidenceDeletedAt: doc.mediaAsset.deletedAt,
      caseId: doc.caseId,
    });

    // Audit BEFORE responding, and regardless of the verdict.
    await this.recordAccess({
      caseId: doc.caseId,
      mediaAssetId: doc.mediaAsset.id,
      actorUserId: input.actorUserId,
      action: 'READ_BYTES',
      outcome: auditOutcomeFor(decision),
      ipPrefix: input.ipPrefix,
      userAgentHash: input.userAgentHash,
    });

    if (!decision.allowed) {
      this.log.warn({
        msg: 'evidence.read.denied',
        actorUserId: input.actorUserId,
        documentId: doc.id,
        caseId: doc.caseId,
        // The stable code, not a sentence, and nothing about the file.
        reason: decision.reason,
      });
      throw new AppError('NOT_FOUND', 'Document not found.', 404);
    }

    this.log.log({
      msg: 'evidence.read.granted',
      actorUserId: input.actorUserId,
      documentId: doc.id,
      caseId: doc.caseId,
      as: decision.as,
    });

    return {
      storageKey: doc.mediaAsset.storageKey,
      // Serve as what the BYTES are, never as what was declared — the declared
      // type is a caller-chosen value and this header drives how a browser
      // treats the response.
      detectedMimeType: doc.mediaAsset.detectedMimeType ?? 'application/octet-stream',
      sizeBytes: doc.mediaAsset.sizeBytes,
      displayFilename: doc.mediaAsset.originalFilename,
    };
  }

  /**
   * Write the access row.
   *
   * Deliberately does NOT participate in a caller's transaction and never
   * throws outward: an audit-write failure must not become a way to make a
   * read succeed silently, nor a way to deny a legitimate read. It is logged
   * loudly instead, and the read decision stands on its own.
   */
  private async recordAccess(row: {
    caseId: string;
    mediaAssetId: string | null;
    actorUserId: string | null;
    action: string;
    outcome: string;
    ipPrefix: string | null;
    userAgentHash: string | null;
  }): Promise<void> {
    try {
      await this.prisma.client.verificationAccessLog.create({ data: row });
    } catch (err) {
      this.log.error({
        msg: 'evidence.audit.write_failed',
        caseId: row.caseId,
        outcome: row.outcome,
        err: (err as Error).message,
      });
    }
  }
}
