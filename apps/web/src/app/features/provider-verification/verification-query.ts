import type { ProviderVerificationCase } from '@homeservicemarketplace/contracts';

export const VERIFICATION_CASE_QUERY_KEY = ['provider', 'verification', 'case'] as const;

/** Both provider surfaces follow scan and reviewer updates while they are open. */
export function verificationRefreshInterval(
  currentCase: ProviderVerificationCase | null | undefined,
): number | false {
  const documents = Array.isArray(currentCase?.documents) ? currentCase.documents : [];
  if (documents.some((document) => !document.superseded && document.scanState === 'PENDING')) {
    return 2_000;
  }
  return documents.some(
    (document) => !document.superseded && document.scanState === 'SCAN_FAILED',
  ) ||
    currentCase?.state === 'SUBMITTED' ||
    currentCase?.state === 'IN_REVIEW' ||
    currentCase?.state === 'VERIFIED'
    ? 30_000
    : false;
}
