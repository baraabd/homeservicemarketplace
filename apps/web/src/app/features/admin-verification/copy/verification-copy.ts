import type {
  MediaScanStateCode,
  VerificationCaseStateCode,
  VerificationDocumentKindCode,
} from '@homeservicemarketplace/contracts';

// Sprint 9B — every string the admin verification surface renders, both
// languages.
//
// Follows the Sprint 8 pattern exactly (onboarding/wizard-copy.ts): codes on
// the wire, prose here, and a key-parity test that fails when a translation is
// missing. That is the only way an untranslated string is caught before an
// Arabic reader sees an English label.
//
// NOT a new i18n mechanism. Language and direction still come from
// LanguageContext; this is just the map that surface reads.

export type Lang = 'en' | 'ar';

/** Case lifecycle, as a reviewer reads it. */
export const CASE_STATE_LABELS: Record<Lang, Record<VerificationCaseStateCode, string>> = {
  en: {
    DRAFT: 'Draft',
    SUBMITTED: 'Awaiting review',
    IN_REVIEW: 'In review',
    ACTION_REQUIRED: 'Action required',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
    EXPIRED: 'Expired',
  },
  ar: {
    DRAFT: 'مسودة',
    SUBMITTED: 'بانتظار المراجعة',
    IN_REVIEW: 'قيد المراجعة',
    ACTION_REQUIRED: 'إجراء مطلوب',
    VERIFIED: 'موثّق',
    REJECTED: 'مرفوض',
    EXPIRED: 'منتهي الصلاحية',
  },
};

export const DOCUMENT_KIND_LABELS: Record<Lang, Record<VerificationDocumentKindCode, string>> = {
  en: {
    INDIVIDUAL_IDENTITY: 'Identity document',
    BUSINESS_REGISTRATION: 'Business registration',
    AUTHORIZED_REPRESENTATIVE_IDENTITY: 'Authorised representative ID',
    CATEGORY_LICENSE: 'Trade licence',
  },
  ar: {
    INDIVIDUAL_IDENTITY: 'وثيقة الهوية',
    BUSINESS_REGISTRATION: 'السجل التجاري',
    AUTHORIZED_REPRESENTATIVE_IDENTITY: 'هوية الممثل المفوّض',
    CATEGORY_LICENSE: 'رخصة المهنة',
  },
};

/** Scan state. The wording matters: a PENDING document is not "broken", it is
 *  not yet cleared, and a reviewer needs to know the difference between "wait"
 *  and "this file is dangerous". */
export const SCAN_STATE_LABELS: Record<Lang, Record<MediaScanStateCode, string>> = {
  en: {
    PENDING: 'Awaiting security scan',
    CLEAN: 'Scanned',
    QUARANTINED: 'Quarantined — not viewable',
    SCAN_FAILED: 'Scan failed — retrying',
  },
  ar: {
    PENDING: 'بانتظار الفحص الأمني',
    CLEAN: 'تم الفحص',
    QUARANTINED: 'محجوز — غير قابل للعرض',
    SCAN_FAILED: 'فشل الفحص — إعادة المحاولة',
  },
};

export const UI: Record<Lang, Record<string, string>> = {
  en: {
    documents: 'Identity documents',
    noCase: 'This provider has not submitted verification documents yet.',
    loading: 'Loading verification…',
    failed: 'Could not load the verification case.',
    requirements: 'Required documents',
    satisfied: 'Provided',
    outstanding: 'Missing',
    decisions: 'Decision history',
    noDecisions: 'No decisions recorded yet.',
    policyVersion: 'Policy version',
    submitted: 'Submitted',
    view: 'View document',
    notViewable: 'Cannot be opened',
    evidenceDeleted: 'Document deleted under the retention policy',
    superseded: 'Replaced by a newer upload',
    selfReview: 'You cannot review your own application.',
    terminalState: 'This case is closed. No further action is available.',
    notSubmitted: 'Nothing to review until the provider submits.',
    restrictedNotice:
      'Identity documents are restricted. Opening one is recorded against your account.',
  },
  ar: {
    documents: 'وثائق الهوية',
    noCase: 'لم يقدّم هذا المحترف وثائق التحقق بعد.',
    loading: 'جارٍ تحميل التحقق…',
    failed: 'تعذّر تحميل ملف التحقق.',
    requirements: 'الوثائق المطلوبة',
    satisfied: 'تم التقديم',
    outstanding: 'ناقص',
    decisions: 'سجل القرارات',
    noDecisions: 'لا توجد قرارات مسجّلة بعد.',
    policyVersion: 'إصدار السياسة',
    submitted: 'تاريخ التقديم',
    view: 'عرض الوثيقة',
    notViewable: 'لا يمكن فتحها',
    evidenceDeleted: 'حُذفت الوثيقة وفق سياسة الاحتفاظ',
    superseded: 'استُبدلت بنسخة أحدث',
    selfReview: 'لا يمكنك مراجعة طلبك الخاص.',
    terminalState: 'هذا الملف مغلق. لا يوجد إجراء إضافي متاح.',
    notSubmitted: 'لا شيء للمراجعة حتى يقوم المحترف بالتقديم.',
    restrictedNotice: 'وثائق الهوية مقيّدة. سيُسجَّل فتحك لأي منها على حسابك.',
  },
};
