import type { MediaScanStateCode } from '@homeservicemarketplace/contracts';
import type { ReviewLanguage } from '../copy';

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
