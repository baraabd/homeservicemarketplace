import type { MediaScanStateCode } from '@homeservicemarketplace/contracts';
import type { ReviewLanguage } from '../copy';

export type EvidenceConflictReason =
  | 'EVIDENCE_OBJECT_UNAVAILABLE'
  | 'EVIDENCE_NOT_READY'
  | 'EVIDENCE_PREFLIGHT_STALE';

/** Read only the allowlisted domain reason; never show raw server messages or details. */
export function evidenceConflictReason(error: unknown): EvidenceConflictReason | null {
  const reason = (
    error as {
      response?: { data?: { error?: { details?: { reason?: unknown } } } };
    } | null
  )?.response?.data?.error?.details?.reason;
  return reason === 'EVIDENCE_OBJECT_UNAVAILABLE' ||
    reason === 'EVIDENCE_NOT_READY' ||
    reason === 'EVIDENCE_PREFLIGHT_STALE'
    ? reason
    : null;
}

export const EVIDENCE_CONFLICT_COPY = {
  en: {
    EVIDENCE_OBJECT_UNAVAILABLE:
      'An identity document file is missing or unreadable. Your notes are preserved. Close this confirmation and request replacement identity evidence from the provider before approval.',
    EVIDENCE_NOT_READY:
      'Identity evidence is not ready for approval. Your notes are preserved. Check the current documents and their safety checks; request a replacement if evidence is missing or invalid.',
    EVIDENCE_PREFLIGHT_STALE:
      'The identity evidence changed during the evidence check. Your notes are preserved. Refresh the file, inspect the current evidence and reopen the decision confirmation.',
  },
  ar: {
    EVIDENCE_OBJECT_UNAVAILABLE:
      'ملف إحدى وثائق الهوية مفقود أو غير قابل للقراءة. احتفظنا بملاحظاتك. أغلق نافذة التأكيد واطلب من المهني رفع وثيقة هوية بديلة قبل الموافقة.',
    EVIDENCE_NOT_READY:
      'وثائق الهوية غير جاهزة للموافقة. احتفظنا بملاحظاتك. راجع الوثائق الحالية ونتائج فحص الأمان، واطلب بديلًا إذا كانت الوثائق ناقصة أو غير صالحة.',
    EVIDENCE_PREFLIGHT_STALE:
      'تغيّرت وثائق الهوية أثناء التحقق من الأدلة. احتفظنا بملاحظاتك. حدّث الملف وافحص الوثائق الحالية ثم افتح تأكيد القرار مجددًا.',
  },
} satisfies Record<ReviewLanguage, Record<EvidenceConflictReason, string>>;

/** Scan status describes file safety, independently of the human review decision. */
export const EVIDENCE_SCAN_LABELS = {
  en: {
    PENDING: 'Awaiting safety check',
    CLEAN: 'Safety check passed',
    QUARANTINED: 'Unsafe file quarantined',
    SCAN_FAILED: 'Safety check could not finish',
    REJECTED: 'File validation failed',
  },
  ar: {
    PENDING: 'بانتظار فحص الأمان',
    CLEAN: 'اجتاز فحص الأمان',
    QUARANTINED: 'عُزل الملف لعدم أمانه',
    SCAN_FAILED: 'تعذّر إكمال فحص الأمان',
    REJECTED: 'لم يجتز الملف التحقق',
  },
} satisfies Record<ReviewLanguage, Record<MediaScanStateCode, string>>;

export const EVIDENCE_REVIEW_COPY = {
  en: {
    secure: 'Secure inspection',
    currentDocuments: 'Current documents',
    previousDocuments: 'Previous documents',
    previousHint:
      'These documents were replaced. Review the current evidence above; previous records are retained for history.',
    noCurrentDocuments: 'No current documents. Ask the provider to upload the required evidence.',
    uploaded: 'Uploaded',
    notSubmitted: 'Verification case has not been submitted',
    pending:
      'Opening becomes available after the safety check completes. Refresh to check progress.',
    quarantined: 'This file failed the safety check. Ask the provider for a replacement.',
    failed: 'The safety check could not complete. Refresh its status or request a replacement.',
    rejected:
      'The uploaded file could not be validated. Ask the provider for a supported, readable replacement.',
    unavailable:
      'This document cannot currently be opened. Refresh its status or request replacement evidence.',
    privateImage: 'Open securely to inspect',
    privateHint: 'Image previews open on request and are visible only to authorized reviewers.',
    imageLoading: 'Loading the image for inspection…',
    imageCheck: 'Wait until the image is fully displayed before recording a decision.',
    historical: 'Submitted portfolio details',
    unnamedCategory: 'No service category linked',
    unnamedFile: 'Filename was not recorded',
  },
  ar: {
    secure: 'فحص آمن',
    currentDocuments: 'الوثائق الحالية',
    previousDocuments: 'الوثائق السابقة',
    previousHint:
      'استُبدلت هذه الوثائق. راجع الوثائق الحالية أعلاه؛ تُحفظ السجلات السابقة ضمن تاريخ الملف.',
    noCurrentDocuments: 'لا توجد وثائق حالية. اطلب من المهني رفع الوثائق المطلوبة.',
    uploaded: 'تاريخ الرفع',
    notSubmitted: 'لم يُرسل طلب توثيق الهوية',
    pending: 'يتاح فتح الوثيقة بعد اكتمال فحص الأمان. حدّث البيانات للتحقق من تقدم الفحص.',
    quarantined: 'لم يجتز هذا الملف فحص الأمان. اطلب من المهني رفع بديل.',
    failed: 'تعذّر إكمال فحص الأمان. حدّث حالة الوثيقة أو اطلب رفع بديل.',
    rejected: 'تعذّر التحقق من الملف المرفوع. اطلب من المهني رفع وثيقة واضحة بصيغة مدعومة.',
    unavailable: 'لا يمكن فتح هذه الوثيقة حاليًا. حدّث حالتها أو اطلب وثيقة بديلة.',
    privateImage: 'افتح الصورة بأمان لفحصها',
    privateHint: 'تُفتح المعاينة عند الطلب وتظهر للمراجعين المخوّلين فقط.',
    imageLoading: 'جارٍ تحميل الصورة لفحصها…',
    imageCheck: 'انتظر حتى تظهر الصورة بالكامل قبل تسجيل قرار المراجعة.',
    historical: 'تفاصيل المعرض عند إرسال الطلب',
    unnamedCategory: 'لم يُربط بتخصص محدد',
    unnamedFile: 'لم يُحفظ اسم الملف',
  },
} satisfies Record<ReviewLanguage, Record<string, string>>;
