import type { MoneyWire } from '@homeservicemarketplace/contracts';

export type ManualPaymentLanguage = 'ar' | 'en';

export const MANUAL_PAYMENT_COPY = {
  en: {
    title: 'Manual subscription payment',
    reviewTitle: 'Review subscription payment',
    queueTitle: 'Manual payment reviews',
    subtitle: 'Follow the payment instructions and keep your receipt with this purchase.',
    reviewSubtitle: 'Compare the receipt with an independently recorded deposit before deciding.',
    back: 'Back to provider',
    backQueue: 'Back to reviews',
    language: 'العربية',
    refresh: 'Refresh status',
    loading: 'Loading payment…',
    retry: 'Try again',
    unavailable: 'This payment is unavailable. Your access or the payment may have changed.',
    denied:
      'Your session or permission no longer allows this action. Sign in again or contact an authorized reviewer.',
    conflict:
      'This payment changed while you were working. Refresh and inspect the current receipt before trying again.',
    failure: 'The request could not be confirmed. Refresh the status before trying again.',
    disabled: 'This payment method is currently unavailable.',
    disabledHint:
      'Merchant details and payment policy must be approved before this method can be used.',
    simulation: 'Sandbox operator simulation',
    simulationHint:
      'This workspace records simulated deposits for testing. It does not confirm a real transfer.',
    amount: 'Amount due',
    method: 'Payment method',
    expires: 'Payment expires',
    instructions: 'Payment instructions',
    instructionVersion: 'Instruction version',
    receiptWarning: 'Uploading a receipt does not confirm payment or activate your plan.',
    history: 'Receipt history',
    emptyReceipts: 'No receipt has been uploaded for this payment.',
    revision: 'Receipt version',
    current: 'Current',
    scan: 'Security scan',
    open: 'Inspect receipt',
    close: 'Close preview',
    preview: 'Private receipt preview',
    previewHint: 'Opening a receipt checks your permission and records the access.',
    previewUnavailable: 'The receipt could not be displayed. Reopen it to check access again.',
    previewExpired: 'This preview has expired. Reopen the receipt before continuing.',
    previewUnsupported: 'This receipt format cannot be displayed safely.',
    inspected: 'Use this inspected receipt',
    inspectionRecorded: 'Current receipt inspected',
    inspectionNeeded: 'Open and inspect the current receipt before recording a decision.',
    image: 'Uploaded payment receipt',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    receiptArea: 'Receipt area. Use arrow keys to scroll.',
    upload: 'Upload a receipt',
    replace: 'Upload a replacement receipt',
    chooseFile: 'Receipt file',
    uploadHint: 'A replacement is saved as a new version. Earlier receipts remain in the history.',
    invalidFile: 'Choose a supported, nonempty file within the displayed upload limit.',
    uploading: 'Uploading and checking receipt…',
    uploadDone: 'Receipt uploaded. Check its scan status before submitting.',
    submit: 'Submit for review',
    submitting: 'Submitting…',
    submitted: 'Submitted for review. Payment has not yet been confirmed.',
    changes: 'Reviewer feedback',
    decisions: 'Review history',
    emptyHistory: 'No review decision has been recorded.',
    emptyQueue: 'No manual payments are waiting in this list.',
    more: 'Load more',
    openReview: 'Open review',
    status: 'Status',
    paymentReference: 'Purchase reference',
    settlementTitle: 'Independent deposit record',
    settlementHint:
      'Record the deposit from the permitted independent source. Another authorized reviewer must compare it with the receipt.',
    settlementReference: 'Deposit reference',
    settlementAmount: 'Amount recorded by the payment source',
    settlementTime: 'Deposit time (UTC)',
    settlementSource: 'Evidence source',
    recordSettlement: 'Record simulated deposit',
    settlementSaved: 'Independent record saved. A separate reviewer must confirm the payment.',
    settlementInvalid: 'Enter the deposit reference, exact amount and valid UTC deposit time.',
    settlements: 'Recorded deposits',
    noSettlements: 'No independent deposit record is available for approval.',
    selectSettlement: 'Deposit to match',
    selectPlaceholder: 'Select an eligible independent record',
    separateReviewer: 'Requires a separate reviewer',
    decision: 'Record a decision',
    message: 'Message to the provider',
    messageHint: 'Explain the precise decision or the replacement that is needed.',
    internalNote: 'Internal reviewer note (optional)',
    internalHint: 'Visible only to authorized finance reviewers.',
    approve: 'Confirm matched deposit',
    reject: 'Reject receipt',
    replacement: 'Request a replacement',
    decisionInvalid:
      'Inspect the current receipt and enter a message. Approval also requires an eligible independent deposit.',
    decisionSaved: 'Decision recorded. The current server status is shown below.',
    confirmTitle: 'Confirm the matched deposit?',
    confirmHint:
      'Confirm only after comparing the current receipt, amount, currency and independent deposit record. This does not grant identity verification or work access.',
    confirm: 'Confirm decision',
    cancel: 'Keep reviewing',
    minorUnits: 'minor units',
    unknown: 'Not available',
    awaitingActivation:
      'Payment confirmation and plan activation are still in progress. The payment is not yet complete.',
    reconciliation:
      'Payment confirmation needs a finance review. The outcome is unresolved. Wait for an update before making another payment.',
    retryConfirmation: 'Retry payment confirmation',
    retryConfirmationHint:
      'Check that the blocking issue has been resolved. This retries the existing reviewed receipt and independent deposit.',
    approvedNotice:
      'The server has confirmed this payment. Identity verification and work access remain separate.',
    saving: 'Saving…',
    changedRefresh: 'Updated status loaded.',
    maxFile: 'Maximum file size',
    formats: 'Supported formats',
  },
  ar: {
    title: 'دفع الاشتراك يدويًا',
    reviewTitle: 'مراجعة دفع الاشتراك',
    queueTitle: 'مراجعات الدفع اليدوي',
    subtitle: 'اتبع تعليمات الدفع واحتفظ بالإيصال ضمن عملية الشراء هذه.',
    reviewSubtitle: 'قارن الإيصال بإيداع مسجّل من مصدر مستقل قبل اتخاذ القرار.',
    back: 'العودة إلى حساب المهني',
    backQueue: 'العودة إلى المراجعات',
    language: 'English',
    refresh: 'تحديث الحالة',
    loading: 'جارٍ تحميل الدفع…',
    retry: 'إعادة المحاولة',
    unavailable: 'عملية الدفع غير متاحة. ربما تغيّرت صلاحية وصولك أو حالة العملية.',
    denied:
      'لم تعد الجلسة أو الصلاحية تسمح بهذا الإجراء. سجّل الدخول مجددًا أو تواصل مع مراجع مخوّل.',
    conflict:
      'تغيّرت عملية الدفع أثناء عملك. حدّث الحالة وافحص الإيصال الحالي قبل المحاولة مجددًا.',
    failure: 'تعذّر التأكد من نتيجة الطلب. حدّث الحالة قبل المحاولة مجددًا.',
    disabled: 'طريقة الدفع هذه غير متاحة حاليًا.',
    disabledHint: 'يلزم اعتماد بيانات التاجر وسياسة الدفع قبل استخدام هذه الطريقة.',
    simulation: 'محاكاة إيداع في بيئة الاختبار',
    simulationHint: 'تُسجّل هذه المساحة إيداعات محاكية للاختبار، ولا تؤكد تحويل أموال حقيقيًا.',
    amount: 'المبلغ المستحق',
    method: 'طريقة الدفع',
    expires: 'انتهاء مهلة الدفع',
    instructions: 'تعليمات الدفع',
    instructionVersion: 'نسخة التعليمات',
    receiptWarning: 'رفع الإيصال لا يؤكد الدفع ولا يفعّل خطتك.',
    history: 'سجل الإيصالات',
    emptyReceipts: 'لم يُرفع إيصال لعملية الدفع هذه بعد.',
    revision: 'نسخة الإيصال',
    current: 'الحالية',
    scan: 'الفحص الأمني',
    open: 'فحص الإيصال',
    close: 'إغلاق المعاينة',
    preview: 'معاينة خاصة للإيصال',
    previewHint: 'عند فتح الإيصال يُتحقق من صلاحيتك ويُسجّل الاطلاع عليه.',
    previewUnavailable: 'تعذّر عرض الإيصال. أعد فتحه للتحقق من صلاحية الوصول مجددًا.',
    previewExpired: 'انتهت مدة المعاينة. أعد فتح الإيصال قبل المتابعة.',
    previewUnsupported: 'لا يمكن عرض صيغة هذا الإيصال بأمان.',
    inspected: 'اعتماد فحص هذا الإيصال',
    inspectionRecorded: 'تم فحص الإيصال الحالي',
    inspectionNeeded: 'افتح الإيصال الحالي وافحصه قبل تسجيل القرار.',
    image: 'إيصال الدفع المرفوع',
    previousPage: 'الصفحة السابقة',
    nextPage: 'الصفحة التالية',
    receiptArea: 'مساحة الإيصال. استخدم مفاتيح الأسهم للتمرير.',
    upload: 'رفع إيصال',
    replace: 'رفع إيصال بديل',
    chooseFile: 'ملف الإيصال',
    uploadHint: 'يُحفظ الإيصال البديل كنسخة جديدة، وتبقى الإيصالات السابقة في السجل.',
    invalidFile: 'اختر ملفًا مدعومًا وغير فارغ ضمن الحد الأقصى المعروض للحجم.',
    uploading: 'جارٍ رفع الإيصال وفحصه…',
    uploadDone: 'رُفع الإيصال. تحقّق من نتيجة الفحص قبل الإرسال.',
    submit: 'إرسال للمراجعة',
    submitting: 'جارٍ الإرسال…',
    submitted: 'أُرسل الإيصال للمراجعة. لم يُؤكد الدفع بعد.',
    changes: 'ملاحظات المراجع',
    decisions: 'سجل المراجعات',
    emptyHistory: 'لم يُسجّل قرار مراجعة بعد.',
    emptyQueue: 'لا توجد عمليات دفع يدوي في هذه القائمة.',
    more: 'تحميل المزيد',
    openReview: 'فتح المراجعة',
    status: 'الحالة',
    paymentReference: 'مرجع عملية الشراء',
    settlementTitle: 'سجل إيداع مستقل',
    settlementHint:
      'سجّل الإيداع من المصدر المستقل المسموح. يجب أن يقارنه مراجع مخوّل آخر بالإيصال.',
    settlementReference: 'مرجع الإيداع',
    settlementAmount: 'المبلغ المسجّل لدى مصدر الدفع',
    settlementTime: 'وقت الإيداع بالتوقيت العالمي UTC',
    settlementSource: 'مصدر الإثبات',
    recordSettlement: 'تسجيل الإيداع المحاكى',
    settlementSaved: 'حُفظ السجل المستقل. يلزم مراجع آخر لتأكيد الدفع.',
    settlementInvalid: 'أدخل مرجع الإيداع والمبلغ الدقيق ووقت إيداع صالحًا بالتوقيت العالمي.',
    settlements: 'الإيداعات المسجّلة',
    noSettlements: 'لا يوجد سجل إيداع مستقل متاح للموافقة.',
    selectSettlement: 'الإيداع المراد مطابقته',
    selectPlaceholder: 'اختر سجلًا مستقلًا مؤهلًا',
    separateReviewer: 'يلزم مراجع آخر',
    decision: 'تسجيل القرار',
    message: 'رسالة إلى المهني',
    messageHint: 'وضّح سبب القرار أو المطلوب في الإيصال البديل بدقة.',
    internalNote: 'ملاحظة داخلية للمراجع (اختيارية)',
    internalHint: 'لا يطّلع عليها إلا المراجعون الماليون المخوّلون.',
    approve: 'تأكيد الإيداع المطابق',
    reject: 'رفض الإيصال',
    replacement: 'طلب إيصال بديل',
    decisionInvalid:
      'افحص الإيصال الحالي واكتب رسالة. تتطلب الموافقة أيضًا سجل إيداع مستقلًا ومؤهلًا.',
    decisionSaved: 'سُجّل القرار. تظهر الحالة الحالية من الخادم أدناه.',
    confirmTitle: 'هل تريد تأكيد الإيداع المطابق؟',
    confirmHint:
      'أكّد فقط بعد مقارنة الإيصال الحالي والمبلغ والعملة وسجل الإيداع المستقل. هذا لا يمنح توثيق الهوية أو صلاحية العمل.',
    confirm: 'تأكيد القرار',
    cancel: 'متابعة المراجعة',
    minorUnits: 'وحدة صغرى',
    unknown: 'غير متاح',
    awaitingActivation: 'لا يزال تأكيد الدفع وتفعيل الخطة قيد التنفيذ. لم يكتمل الدفع بعد.',
    reconciliation:
      'يتطلب تأكيد الدفع مراجعة مالية، ولا تزال النتيجة غير محسومة. انتظر تحديث الحالة قبل إجراء دفعة أخرى.',
    retryConfirmation: 'إعادة محاولة تأكيد الدفع',
    retryConfirmationHint:
      'تحقق من حل المشكلة التي منعت التأكيد. تعيد هذه المحاولة استخدام الإيصال والإيداع المستقل اللذين تمت مراجعتهما.',
    approvedNotice: 'أكّد الخادم عملية الدفع هذه. يظل توثيق الهوية وصلاحية العمل منفصلين.',
    saving: 'جارٍ الحفظ…',
    changedRefresh: 'حُمّلت الحالة المحدّثة.',
    maxFile: 'الحد الأقصى لحجم الملف',
    formats: 'الصيغ المدعومة',
  },
} as const;

const STATUS_COPY: Record<string, { en: string; ar: string }> = {
  RECEIPT_REQUIRED: { en: 'Receipt required', ar: 'إيصال مطلوب' },
  ACTION_REQUIRED: { en: 'Replacement required', ar: 'إيصال بديل مطلوب' },
  AWAITING_RECEIPT: { en: 'Awaiting receipt', ar: 'بانتظار الإيصال' },
  DRAFT: { en: 'Preparing receipt', ar: 'تجهيز الإيصال' },
  RESERVED: { en: 'Upload reserved', ar: 'حُجز الرفع' },
  UPLOADED: { en: 'Uploaded', ar: 'مرفوع' },
  SCAN_PENDING: { en: 'Awaiting security scan', ar: 'بانتظار الفحص الأمني' },
  SCAN_FAILED: { en: 'Security scan unavailable', ar: 'الفحص الأمني غير متاح' },
  PENDING: { en: 'Pending', ar: 'قيد الانتظار' },
  SCANNING: { en: 'Security scan in progress', ar: 'الفحص الأمني جارٍ' },
  CLEAN: { en: 'Security scan passed', ar: 'اجتاز الفحص الأمني' },
  READY: { en: 'Ready to submit', ar: 'جاهز للإرسال' },
  QUARANTINED: { en: 'Quarantined', ar: 'معزول أمنيًا' },
  INFECTED: { en: 'Security scan rejected', ar: 'رفضه الفحص الأمني' },
  ERROR: { en: 'Check unavailable', ar: 'الفحص غير متاح' },
  FAILED: { en: 'Could not complete', ar: 'تعذّر الإكمال' },
  SUBMITTED: { en: 'Awaiting review', ar: 'بانتظار المراجعة' },
  IN_REVIEW: { en: 'Under review', ar: 'قيد المراجعة' },
  REPLACEMENT_REQUESTED: { en: 'Replacement requested', ar: 'إيصال بديل مطلوب' },
  REQUEST_REPLACEMENT: { en: 'Replacement requested', ar: 'طُلب إيصال بديل' },
  REJECTED: { en: 'Rejected', ar: 'مرفوض' },
  REJECT: { en: 'Rejected', ar: 'رُفض' },
  CONFIRMING: { en: 'Awaiting payment activation', ar: 'بانتظار تفعيل الدفع' },
  RECONCILIATION_REQUIRED: { en: 'Finance review needed', ar: 'مراجعة مالية مطلوبة' },
  APPROVED: { en: 'Payment confirmed', ar: 'الدفع مؤكد' },
  APPROVE: { en: 'Approval requested', ar: 'طُلبت الموافقة' },
  EXPIRED: { en: 'Expired', ar: 'منتهي المهلة' },
  UNKNOWN: { en: 'Outcome unresolved', ar: 'النتيجة غير محسومة' },
};
const METHOD_COPY: Record<string, { en: string; ar: string }> = {
  SHAM_CASH: { en: 'Sham Cash', ar: 'شام كاش' },
  SYRIATEL_CASH: { en: 'Syriatel Cash', ar: 'سيريتل كاش' },
  CASH_OFFICE: { en: 'Approved cash office', ar: 'مكتب دفع نقدي معتمد' },
};
export function manualStatusLabel(status: string, lang: ManualPaymentLanguage): string {
  return STATUS_COPY[status]?.[lang] ?? MANUAL_PAYMENT_COPY[lang].unknown;
}
export function manualMethodLabel(method: string, lang: ManualPaymentLanguage): string {
  return METHOD_COPY[method]?.[lang] ?? MANUAL_PAYMENT_COPY[lang].unknown;
}

/** Exact formatting only. Policy supplies the scale; no floating-point money. */
export function formatManualAmount(
  amount: MoneyWire,
  scale: number | null,
  lang: ManualPaymentLanguage,
): string {
  const text = amount.amountMinor;
  if (!/^(0|[1-9]\d*)$/.test(text)) return MANUAL_PAYMENT_COPY[lang].unknown;
  if (scale === null || !Number.isInteger(scale) || scale < 0 || scale > 9) {
    return `${text} ${amount.currency} (${MANUAL_PAYMENT_COPY[lang].minorUnits})`;
  }
  const padded = text.padStart(scale + 1, '0');
  const whole = scale === 0 ? padded : padded.slice(0, -scale);
  const locale = lang === 'ar' ? 'ar' : 'en';
  const formatted = new Intl.NumberFormat(locale).format(BigInt(whole));
  if (scale === 0) return `${formatted} ${amount.currency}`;
  const symbols = new Intl.NumberFormat(locale, { useGrouping: false });
  const decimal = symbols.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  const fraction = padded.slice(-scale).replace(/\d/g, (digit) => symbols.format(Number(digit)));
  return `${formatted}${decimal}${fraction} ${amount.currency}`;
}

/** Exact operator input with explicitly approved currency scale. */
export function parseManualAmount(value: string, scale: number | null): string | null {
  if (scale === null || !Number.isInteger(scale) || scale < 0 || scale > 9) return null;
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace('٫', '.');
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > scale) return null;
  const result = BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
  return result <= 9223372036854775807n ? result.toString() : null;
}

export function manualDate(value: string, lang: ManualPaymentLanguage): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? MANUAL_PAYMENT_COPY[lang].unknown
    : new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date) + ' UTC';
}
