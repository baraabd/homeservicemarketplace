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
    // Says what to DO about it. "Rejected" alone reads as a verdict on the
    // provider; the fault is usually a failed upload, and the fix is to send
    // the file again.
    REJECTED: 'Rejected — file unreadable, please re-upload',
  },
  ar: {
    PENDING: 'بانتظار الفحص الأمني',
    CLEAN: 'تم الفحص',
    QUARANTINED: 'محجوز — غير قابل للعرض',
    SCAN_FAILED: 'فشل الفحص — إعادة المحاولة',
    REJECTED: 'مرفوض — الملف غير صالح، يرجى رفعه من جديد',
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

    // ── Sprint 9B.12 — the queue ──────────────────────────────────────────
    queueTitle: 'Verification queue',
    queueEmpty: 'Nothing waiting for review.',
    searchLabel: 'Search by provider name',
    filterState: 'State',
    filterPolicy: 'Policy version',
    filterFrom: 'Submitted from',
    filterTo: 'Submitted to',
    filterAll: 'All live states',
    clearFilters: 'Clear filters',
    loadMore: 'Load more',
    documentsCount: 'Documents',
    assignedTo: 'Assigned',
    unassigned: 'Unassigned',

    // ── case actions ─────────────────────────────────────────────────────
    caseActions: 'Case actions',
    accountActions: 'Account actions',
    axisNote:
      'Case actions decide the documents. Account actions decide the account. They are separate.',
    actionAssign: 'Assign to me',
    actionRequestAction: 'Request changes',
    actionApprove: 'Approve',
    actionReject: 'Reject',
    actionReverify: 'Ask to re-verify',
    actionRevoke: 'Revoke work access',
    noActions: 'No actions are available to you on this case.',

    // ── reason capture and confirmation ──────────────────────────────────
    reasonLabel: 'Reason',
    reasonRequired: 'Choose a reason before continuing.',
    noteLabel: 'Note for the record (optional)',
    noteHint: 'Only reviewers see this. The provider is shown the reason, never the note.',
    confirmTitle: 'Confirm this decision',
    confirmApprove: 'Approving opens work access for this provider.',
    confirmReject: 'Rejecting closes this case. The provider must start again.',
    confirmRevoke: 'Revoking ends this provider’s ability to take work immediately.',
    confirmGeneric: 'This is recorded against your account and cannot be undone.',
    confirm: 'Confirm',
    cancel: 'Cancel',

    // ── failure states ───────────────────────────────────────────────────
    conflictTitle: 'Someone else got there first',
    conflictBody:
      'This case changed while you had it open. Reload to see where it stands before deciding.',
    reload: 'Reload',
    forbiddenTitle: 'You do not have permission',
    forbiddenBody: 'Your account cannot decide verification cases. Ask an administrator.',

    // ── work access ──────────────────────────────────────────────────────
    workAccess: 'Work access',
    workAccessActive: 'Active',
    workAccessInactive: 'Not active',
    workAccessNone: 'Never granted',
    workAccessSource: 'Source',
    workAccessExpires: 'Expires',

    // ── audit ────────────────────────────────────────────────────────────
    auditTitle: 'Audit history',
    auditEmpty: 'Nothing recorded yet.',

    // ── policy management ────────────────────────────────────────────────
    policyTitle: 'Verification policies',
    policyEmpty: 'No policy versions published.',
    policyLive: 'Live',
    policyRetired: 'Retired',
    policyPublish: 'Publish a version',
    policyRetire: 'Retire',
    policyVersionLabel: 'Version',
    policyCountry: 'Country',
    policyPublishedAt: 'Published',
    policyRetiredAt: 'Retired',
    policyDocuments: 'Required documents',
    policyAppendOnly:
      'Policies are append-only. A published version is never edited — publish a new one.',

    // ── opening restricted evidence ──────────────────────────────────────
    evidenceOpening: 'Opening…',
    evidenceOpenFailed: 'That document could not be opened. Your access attempt was recorded.',
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

    queueTitle: 'قائمة التحقق',
    queueEmpty: 'لا يوجد ما ينتظر المراجعة.',
    searchLabel: 'ابحث باسم المحترف',
    filterState: 'الحالة',
    filterPolicy: 'إصدار السياسة',
    filterFrom: 'مقدَّم من تاريخ',
    filterTo: 'مقدَّم حتى تاريخ',
    filterAll: 'كل الحالات النشطة',
    clearFilters: 'مسح عوامل التصفية',
    loadMore: 'تحميل المزيد',
    documentsCount: 'الوثائق',
    assignedTo: 'مُسند إلى',
    unassigned: 'غير مُسند',

    caseActions: 'إجراءات الملف',
    accountActions: 'إجراءات الحساب',
    axisNote: 'إجراءات الملف تخص الوثائق. إجراءات الحساب تخص الحساب. وهما منفصلتان.',
    actionAssign: 'إسناد إليّ',
    actionRequestAction: 'طلب تعديلات',
    actionApprove: 'موافقة',
    actionReject: 'رفض',
    actionReverify: 'طلب إعادة التحقق',
    actionRevoke: 'سحب صلاحية العمل',
    noActions: 'لا تتوفر لك أي إجراءات على هذا الملف.',

    reasonLabel: 'السبب',
    reasonRequired: 'اختر سببًا قبل المتابعة.',
    noteLabel: 'ملاحظة للسجل (اختياري)',
    noteHint: 'يراها المراجعون فقط. يُعرض للمحترف السبب، ولا تُعرض الملاحظة أبدًا.',
    confirmTitle: 'تأكيد هذا القرار',
    confirmApprove: 'الموافقة تفتح صلاحية العمل لهذا المحترف.',
    confirmReject: 'الرفض يغلق هذا الملف. سيتعيّن على المحترف البدء من جديد.',
    confirmRevoke: 'السحب ينهي قدرة هذا المحترف على استلام الأعمال فورًا.',
    confirmGeneric: 'سيُسجَّل هذا على حسابك ولا يمكن التراجع عنه.',
    confirm: 'تأكيد',
    cancel: 'إلغاء',

    conflictTitle: 'سبقك شخص آخر',
    conflictBody: 'تغيّر هذا الملف أثناء فتحك له. أعد التحميل لمعرفة وضعه قبل اتخاذ القرار.',
    reload: 'إعادة التحميل',
    forbiddenTitle: 'ليس لديك صلاحية',
    forbiddenBody: 'لا يمكن لحسابك البتّ في ملفات التحقق. راجع أحد المسؤولين.',

    workAccess: 'صلاحية العمل',
    workAccessActive: 'نشطة',
    workAccessInactive: 'غير نشطة',
    workAccessNone: 'لم تُمنح قط',
    workAccessSource: 'المصدر',
    workAccessExpires: 'تنتهي',

    auditTitle: 'سجل التدقيق',
    auditEmpty: 'لا شيء مسجّل بعد.',

    policyTitle: 'سياسات التحقق',
    policyEmpty: 'لم تُنشر أي إصدارات سياسة.',
    policyLive: 'سارية',
    policyRetired: 'متقاعدة',
    policyPublish: 'نشر إصدار',
    policyRetire: 'تقاعد',
    policyVersionLabel: 'الإصدار',
    policyCountry: 'الدولة',
    policyPublishedAt: 'تاريخ النشر',
    policyRetiredAt: 'تاريخ التقاعد',
    policyDocuments: 'الوثائق المطلوبة',
    policyAppendOnly: 'السياسات إضافية فقط. لا يُعدَّل إصدار منشور — انشر إصدارًا جديدًا.',

    evidenceOpening: 'جارٍ الفتح…',
    evidenceOpenFailed: 'تعذّر فتح الوثيقة. سُجّلت محاولة الوصول على حسابك.',
  },
};
