import type { ReviewLanguage } from '../copy';

export const VERIFICATION_REASON_LABELS: Record<ReviewLanguage, Record<string, string>> = {
  en: {
    DOCUMENTS_COMPLETE_AND_LEGIBLE: 'Documents complete and legible',
    DOCUMENT_MISSING: 'Document missing',
    DOCUMENT_ILLEGIBLE: 'Document unreadable',
    DOCUMENT_EXPIRED: 'Document expired',
    DOCUMENT_MISMATCH: 'Document does not match',
    SUSPECTED_FORGERY: 'Suspected forgery',
    DUPLICATE_IDENTITY: 'Duplicate identity',
    POLICY_PERIOD_ELAPSED: 'Verification period elapsed',
    TRUST_AND_SAFETY_ACTION: 'Trust and safety action',
    PROVIDER_REQUESTED: 'Provider requested',
    OTHER: 'Other',
  },
  ar: {
    DOCUMENTS_COMPLETE_AND_LEGIBLE: 'الوثائق كاملة وواضحة',
    DOCUMENT_MISSING: 'وثيقة ناقصة',
    DOCUMENT_ILLEGIBLE: 'وثيقة غير مقروءة',
    DOCUMENT_EXPIRED: 'وثيقة منتهية الصلاحية',
    DOCUMENT_MISMATCH: 'الوثيقة غير مطابقة',
    SUSPECTED_FORGERY: 'اشتباه في التزوير',
    DUPLICATE_IDENTITY: 'هوية مكررة',
    POLICY_PERIOD_ELAPSED: 'انتهت فترة التوثيق',
    TRUST_AND_SAFETY_ACTION: 'إجراء للحماية والأمان',
    PROVIDER_REQUESTED: 'بطلب من المهني',
    OTHER: 'سبب آخر',
  },
};

export function verificationReasonLabel(code: string, lang: ReviewLanguage): string {
  return (
    VERIFICATION_REASON_LABELS[lang][code] ??
    (lang === 'ar' ? 'سبب مراجعة آخر' : 'Other review reason')
  );
}
