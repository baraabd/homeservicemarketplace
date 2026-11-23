import type {
  AdminProviderReview,
  AdminVerificationCase,
  AdminVerificationDocument,
} from '@homeservicemarketplace/contracts';

export const IDENTITY_SCAN_REFRESH_MS = 5_000;

function isCurrentEvidence(document: AdminVerificationDocument) {
  return (
    !document.supersededAt &&
    !document.evidenceDeletedAt &&
    (!document.retentionState || document.retentionState === 'ACTIVE')
  );
}

/** Refresh metadata only while a current upload is waiting for its scan. */
export function hasPendingIdentityScan(kase: AdminVerificationCase | null | undefined): boolean {
  return !!kase?.documents.some(
    (document) => isCurrentEvidence(document) && document.scanState === 'PENDING',
  );
}

export type IdentityReviewStep =
  | 'start'
  | 'permission'
  | 'selfReview'
  | 'scanning'
  | 'scanFailed'
  | 'replace'
  | 'upload'
  | 'submit'
  | 'changes'
  | 'review'
  | 'verified'
  | 'restart'
  | 'renew';

/** Explain the next actor from server facts. This never grants an action. */
export function identityReviewStep(review: AdminProviderReview): IdentityReviewStep {
  const kase = review.verification;
  if (kase?.blockedReason === 'SELF_REVIEW') return 'selfReview';
  if (!review.permissions.canViewEvidence || !review.permissions.canDecide) return 'permission';
  if (!kase) return 'start';
  // Retention can remove old evidence without undoing the recorded identity decision.
  if (kase.state === 'VERIFIED') return 'verified';
  if (kase.state === 'REJECTED') return 'restart';
  if (kase.state === 'EXPIRED') return 'renew';
  // A submitted case belongs to the reviewer. Optional documents may still
  // be scanning or blocked; the provider cannot replace them until changes
  // are requested. Their individual scan statuses remain visible below.
  if (kase.state === 'SUBMITTED' || kase.state === 'IN_REVIEW') return 'review';
  const current = kase.documents.filter(isCurrentEvidence);
  // The admin checklist's `satisfied` means received, not scan-cleared.
  // Explain readiness only when each required slot also has current CLEAN
  // evidence. This does not offer or authorize any server command.
  const outstanding = kase.requirements.filter(
    (requirement) =>
      !requirement.satisfied ||
      !current.some(
        (document) =>
          document.kind === requirement.kind &&
          document.serviceCategoryId === requirement.serviceCategoryId &&
          document.scanState === 'CLEAN',
      ),
  );
  const blocking = current.filter((document) =>
    outstanding.some(
      (requirement) =>
        requirement.kind === document.kind &&
        requirement.serviceCategoryId === document.serviceCategoryId,
    ),
  );
  // An unrelated optional upload must not hide the submission step when
  // every required slot has cleared evidence.
  if (blocking.some((document) => document.scanState === 'PENDING')) return 'scanning';
  if (blocking.some((document) => document.scanState === 'SCAN_FAILED')) return 'scanFailed';
  if (blocking.some((document) => ['QUARANTINED', 'REJECTED'].includes(document.scanState))) {
    return 'replace';
  }
  if (kase.state === 'ACTION_REQUIRED') return 'changes';
  if (outstanding.length) {
    return 'upload';
  }
  return 'submit';
}

type GuidanceCopy = Record<IdentityReviewStep, string> & {
  title: string;
  decision: string;
  verifiedWorkAllowed: string;
  verifiedWorkPending: string;
};

export const IDENTITY_REVIEW_GUIDANCE: Record<'en' | 'ar', GuidanceCopy> = {
  en: {
    title: 'Next step for identity review',
    start:
      'The provider needs to open Identity verification and upload the required documents, then send them for review.',
    permission:
      'Your account cannot complete this identity review. An authorised reviewer must open the documents and record the decision.',
    selfReview:
      'Another authorised reviewer must review this identity. You cannot review your own application.',
    scanning:
      'This upload is awaiting completion of the automatic safety check. The scan result updates here automatically. Viewing a document for review becomes available only after the check allows it. If this status persists, ask support to check the scanning service.',
    scanFailed:
      'The automatic safety check did not complete. The document remains closed. Ask support to restore the scanning service and retry the check, then refresh this case before continuing the review.',
    replace:
      'This upload cannot be opened. The provider needs to replace the blocked document with a valid file and send the documents for review after the safety check completes.',
    upload:
      'The provider needs to complete the required documents shown below. Uploading a profile photo does not supply an identity document.',
    submit:
      'The required documents are complete, but the identity case is still a draft. The provider must choose “Send for review” on the Identity verification page before you can record a decision.',
    changes:
      'The provider must address the requested changes and choose “Send for review” again. Review the new submission once it arrives.',
    review:
      'Review the available identity documents and the application data. If evidence needs correction, request changes before the provider can replace it. The application decision below lists the remaining prerequisites and offers final approval when allowed; that decision also verifies the identity and grants work access when all requirements are met.',
    verified: 'Identity verification is complete.',
    verifiedWorkAllowed: 'The server confirms that this provider can work.',
    verifiedWorkPending:
      'Work access still has separate requirements. Check the application decision below for the current blockers and the next available action.',
    restart:
      'This identity case was rejected. The provider needs to start fresh verification and submit corrected documents. The rejection does not become approval when an old file is viewed.',
    renew:
      'Identity verification requires renewal. The provider needs a fresh submission and an administrative review. Work eligibility is checked again after the decision.',
    decision: 'Go to application decision and work eligibility',
  },
  ar: {
    title: 'الخطوة التالية لمراجعة الهوية',
    start: 'على المهني فتح توثيق الهوية ورفع الوثائق المطلوبة ثم إرسالها للمراجعة.',
    permission:
      'لا يملك حسابك صلاحية إكمال مراجعة الهوية. يجب أن يفتح الوثائق مراجع مخوّل ويسجّل القرار.',
    selfReview: 'يجب أن يراجع هذه الهوية مراجع مخوّل آخر. لا يمكنك مراجعة طلبك الخاص.',
    scanning:
      'الملف بانتظار اكتمال الفحص الآلي لأمانه. تُحدّث نتيجته هنا تلقائيًا. يتاح عرض الوثيقة للمراجعة فقط بعد سماح الفحص بذلك. إذا استمرت هذه الحالة، اطلب من الدعم التحقق من خدمة الفحص.',
    scanFailed:
      'لم يكتمل الفحص الآلي لأمان الملف، وتبقى الوثيقة مغلقة. اطلب من الدعم استعادة خدمة الفحص وإعادة المحاولة، ثم حدّث الملف قبل متابعة المراجعة.',
    replace:
      'لا يمكن فتح هذا الملف. على المهني استبدال الوثيقة المحجوبة بملف صالح ثم إرسال الوثائق للمراجعة بعد اكتمال فحص الأمان.',
    upload:
      'على المهني استكمال الوثائق المطلوبة الموضّحة أدناه. رفع الصورة الشخصية لا يقدّم وثيقة الهوية.',
    submit:
      'اكتملت الوثائق المطلوبة، لكن ملف توثيق الهوية ما زال مسودة. على المهني اختيار «إرسال للمراجعة» في صفحة توثيق الهوية قبل أن تتمكن من تسجيل القرار.',
    changes:
      'على المهني معالجة التعديلات المطلوبة ثم اختيار «إرسال للمراجعة» مجددًا. راجع الإرسال الجديد عند وصوله.',
    review:
      'راجع وثائق الهوية المتاحة وبيانات الطلب. إذا احتاجت وثيقة إلى تصحيح، اطلب التعديل حتى يتمكن المهني من استبدالها. يعرض قسم قرار الطلب أدناه المتطلبات المتبقية ويتيح الموافقة النهائية عند السماح بها؛ ويُنجز هذا القرار أيضًا توثيق الهوية ومنح صلاحية العمل عند استيفاء جميع المتطلبات.',
    verified: 'اكتمل توثيق الهوية.',
    verifiedWorkAllowed: 'يؤكد النظام أن المهني يستطيع العمل.',
    verifiedWorkPending:
      'ما زالت لصلاحية العمل متطلبات مستقلة. راجع قسم قرار الطلب أدناه لمعرفة الموانع الحالية والإجراء المتاح التالي.',
    restart:
      'رُفض ملف توثيق الهوية هذا. على المهني بدء توثيق جديد وإرسال وثائق مصحّحة. فتح ملف قديم لا يحوّل الرفض إلى موافقة.',
    renew:
      'يتطلب توثيق الهوية التجديد. على المهني إرسال الوثائق مجددًا لتراجعها الإدارة. تُفحص أهلية العمل مجددًا بعد القرار.',
    decision: 'الانتقال إلى قرار الطلب وأهلية العمل',
  },
};
