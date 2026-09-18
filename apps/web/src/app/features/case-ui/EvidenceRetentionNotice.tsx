import type { AdminVerificationDocument } from '@homeservicemarketplace/contracts';

/** Describes the server's availability, never derives authority from the
 * browser clock or the old scan verdict. In particular, a pending erasure
 * must not be rendered as a successful deletion. */
const COPY = {
  en: {
    EXPIRED: 'The retention period has ended. Access is blocked; erasure has not been confirmed.',
    ERASING: 'Erasure is in progress. Access is blocked until the evidence store confirms removal.',
    ERASED: 'The file has been removed from the evidence store. The decision record is retained.',
  },
  ar: {
    EXPIRED: 'انتهت مدة الاحتفاظ. الوصول محظور، ولم يتأكد المحو بعد.',
    ERASING: 'المحو قيد التنفيذ. الوصول محظور حتى يؤكد مخزن الأدلة إزالة الملف.',
    ERASED: 'حُذف الملف من مخزن الأدلة. سجل القرار محفوظ.',
  },
} as const;

export function EvidenceRetentionNotice({
  state,
  lang,
  className,
}: {
  state: AdminVerificationDocument['retentionState'];
  lang: 'en' | 'ar';
  className?: string;
}) {
  if (!state || state === 'ACTIVE') return null;
  return (
    <p className={className} data-testid="evidence-retention-notice" role="status">
      {COPY[lang][state]}
    </p>
  );
}
