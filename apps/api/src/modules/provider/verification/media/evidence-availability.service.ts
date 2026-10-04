import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../../infrastructure/storage/restricted-object-storage.port';
import { AppError } from '../../../../shared/errors/app-error';
import {
  evidenceSatisfiesRequirement,
  type VerificationEvidenceFacts,
} from '../case/evidence-readiness';

export interface EvidenceAvailabilityDocument extends VerificationEvidenceFacts {
  id: string;
  mediaAsset:
    | (NonNullable<VerificationEvidenceFacts['mediaAsset']> & {
        id: string;
        storageKey: string;
        sizeBytes: number;
        sha256: string | null;
      })
    | null;
}

export interface EvidenceAvailabilityCase {
  id: string;
  policyVersion: string;
  requirements: ReadonlyArray<{ kind: string; serviceCategoryId: string | null }>;
  documents: ReadonlyArray<EvidenceAvailabilityDocument>;
}

/** Internal server proof only. Never accepted from a request or serialized to
 * a client. It binds storage observations to the exact immutable asset versions
 * that must be reloaded and checked inside the decision transaction. */
export interface EvidenceAvailabilityProof {
  caseId: string;
  fingerprint: string;
}

const PREFLIGHT_TIMEOUT_MS = 5_000;

@Injectable()
export class EvidenceAvailabilityService {
  constructor(
    @Inject(RESTRICTED_OBJECT_STORAGE)
    private readonly objects: RestrictedObjectStoragePort,
  ) {}

  /** Run storage I/O BEFORE opening a decision transaction. Finalized evidence
   * cannot be rewritten through the upload pipeline; retention fences and all
   * live document facts are checked again by assertCurrent before committing. */
  async prepare(
    input: EvidenceAvailabilityCase,
    now = new Date(),
  ): Promise<EvidenceAvailabilityProof> {
    const documents = this.requiredDocuments(input, now);
    await Promise.all(
      documents.map(async (document) => {
        const asset = document.mediaAsset!;
        let object;
        try {
          object = await this.headWithTimeout(asset.storageKey);
        } catch {
          throw new AppError(
            'DEPENDENCY_UNAVAILABLE',
            'Identity evidence storage is temporarily unavailable.',
            503,
          );
        }
        if (!object || object.sizeBytes !== asset.sizeBytes) {
          throw new AppError(
            'CONFLICT',
            'Current identity evidence cannot be opened. Request a replacement before approving.',
            409,
            {
              reason: 'EVIDENCE_OBJECT_UNAVAILABLE',
            },
          );
        }
      }),
    );
    return { caseId: input.id, fingerprint: this.fingerprint(input, documents) };
  }

  private async headWithTimeout(key: string) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.objects.head(key),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('evidence-storage-timeout')),
            PREFLIGHT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** No network access here. A changed document, policy, hash, storage key,
   * completion or retention fence invalidates the preflight instead of allowing
   * a storage observation for one version to authorize another version. */
  assertCurrent(
    proof: EvidenceAvailabilityProof | undefined,
    input: EvidenceAvailabilityCase,
    now: Date,
  ): void {
    const documents = this.requiredDocuments(input, now);
    if (
      !proof ||
      proof.caseId !== input.id ||
      proof.fingerprint !== this.fingerprint(input, documents)
    ) {
      throw new AppError(
        'CONFLICT',
        'Identity evidence changed. Reload the review before deciding.',
        409,
        {
          reason: 'EVIDENCE_PREFLIGHT_STALE',
        },
      );
    }
  }

  private requiredDocuments(
    input: EvidenceAvailabilityCase,
    now: Date,
  ): EvidenceAvailabilityDocument[] {
    const documents = input.requirements.map((requirement) =>
      input.documents.find((document) => evidenceSatisfiesRequirement(document, requirement, now)),
    );
    if (documents.some((document) => !document)) {
      throw new AppError('CONFLICT', 'Current clean evidence is required before approval.', 409, {
        reason: 'EVIDENCE_NOT_READY',
      });
    }
    return [...new Map(documents.map((document) => [document!.id, document!])).values()];
  }

  private fingerprint(
    input: EvidenceAvailabilityCase,
    documents: EvidenceAvailabilityDocument[],
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          caseId: input.id,
          policyVersion: input.policyVersion,
          requirements: input.requirements
            .map((requirement) => `${requirement.kind}:${requirement.serviceCategoryId ?? ''}`)
            .sort(),
          documents: documents
            .map((document) => ({
              id: document.id,
              assetId: document.mediaAsset!.id,
              storageKey: document.mediaAsset!.storageKey,
              sizeBytes: document.mediaAsset!.sizeBytes,
              sha256: document.mediaAsset!.sha256,
              completedAt: document.mediaAsset!.uploadCompletedAt?.toISOString(),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }),
      )
      .digest('hex');
  }
}
