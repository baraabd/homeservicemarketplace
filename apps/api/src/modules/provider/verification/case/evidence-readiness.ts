/** The facts needed to use a document in an identity decision. Historical
 * evidence may still be readable, but cannot satisfy a current requirement. */
export interface VerificationEvidenceFacts {
  kind: string;
  serviceCategoryId: string | null;
  supersededAt: Date | null;
  expiresOn: Date | null;
  mediaAsset: {
    scanState: string;
    visibility: string;
    deletedAt: Date | null;
    erasureStartedAt?: Date | null;
    retainUntil?: Date | null;
    uploadCompletedAt: Date | null;
  } | null;
}

/** Shared by the case command and the final application review. A CLEAN
 * malware verdict alone says nothing about upload completion or retention. */
export function evidenceSatisfiesRequirement(
  document: VerificationEvidenceFacts,
  requirement: { kind: string; serviceCategoryId: string | null },
  now: Date,
): boolean {
  const asset = document.mediaAsset;
  return (
    document.kind === requirement.kind &&
    document.serviceCategoryId === requirement.serviceCategoryId &&
    document.supersededAt === null &&
    (!document.expiresOn || document.expiresOn > now) &&
    asset !== null &&
    asset.scanState === 'CLEAN' &&
    asset.visibility === 'RESTRICTED' &&
    asset.deletedAt === null &&
    !asset.erasureStartedAt &&
    (!asset.retainUntil || asset.retainUntil > now) &&
    asset.uploadCompletedAt !== null
  );
}
