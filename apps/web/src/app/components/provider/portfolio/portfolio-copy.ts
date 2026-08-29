// Sprint 9B.10 — every string the portfolio surface renders, in both languages.
//
// Same shape as the onboarding wizard's `wizard-copy.ts`, and for the same two
// reasons recorded there:
//
//   1. Inline ternaries at every label make a component unreadable and let an
//      Arabic string quietly go missing behind a conditional nobody re-reads.
//   2. A test can assert both maps have identical keys, which is the only way
//      an untranslated string is caught before an Arabic reader sees an
//      English label.
//
// Codes on the wire, prose here. The server sends `LIMIT_REACHED`, not a
// sentence, so an Arabic client and an English client are always refused for
// the same reason.

export type Lang = 'en' | 'ar';

/** Refusal codes the API can return from the portfolio routes. */
export type PortfolioErrorCode =
  | 'LIMIT_REACHED'
  | 'FILE_TOO_LARGE'
  | 'DISALLOWED_FORMAT'
  | 'NOT_A_PORTFOLIO_KEY'
  | 'PUBLICATION_RIGHT_NOT_ACKNOWLEDGED'
  | 'UPLOAD_FAILED'
  | 'UNKNOWN';

export const PORTFOLIO_COPY: Record<Lang, Record<string, string>> = {
  en: {
    sectionTitle: 'Your work',
    sectionSubtitle: 'Photos of finished jobs help customers choose you.',

    emptyTitle: 'No photos yet',
    emptyBody: 'Add a few photos of work you have finished. Customers see these on your profile.',

    addButton: 'Add photo',
    fileInputLabel: 'Choose a photo file',
    addAnother: 'Add another',
    slotsRemaining: 'photos left',
    limitReachedNotice: 'You have reached the maximum number of photos.',

    uploading: 'Uploading',
    uploadRetry: 'Try again',
    uploadCancel: 'Cancel',

    consentHint: 'A customer’s home may be in it. Ask them first.',

    captionLabel: 'Caption',
    captionPlaceholder: 'e.g. Kitchen tap replaced',
    descriptionLabel: 'Details',
    categoryLabel: 'Service',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',

    moveUp: 'Move earlier',
    moveDown: 'Move later',
    reorderHint: 'The first photo is the one customers see first.',

    delete: 'Remove',
    deleteConfirmTitle: 'Remove this photo?',
    deleteConfirmBody: 'It will no longer appear on your profile. This cannot be undone.',
    deleteConfirm: 'Remove',
    deleteCancel: 'Keep it',

    moderationPending: 'Being checked',
    moderationApproved: 'Visible to customers',
    moderationRejected: 'Not published',

    loading: 'Loading your photos',
    loadFailed: 'We could not load your photos.',
    retry: 'Try again',

    errLIMIT_REACHED: 'You have reached the maximum number of photos.',
    errFILE_TOO_LARGE: 'That photo is too large. Try a smaller one.',
    errDISALLOWED_FORMAT: 'That file type is not supported. Use a JPEG, PNG or WebP image.',
    errNOT_A_PORTFOLIO_KEY: 'That file could not be published. Please pick it again.',
    errPUBLICATION_RIGHT_NOT_ACKNOWLEDGED: 'Confirm you may publish this photo first.',
    errUPLOAD_FAILED: 'The upload did not finish. Check your connection and try again.',
    errUNKNOWN: 'Something went wrong. Please try again.',
  },
  ar: {
    sectionTitle: 'أعمالك',
    sectionSubtitle: 'صور الأعمال المنجزة تساعد العملاء على اختيارك.',

    emptyTitle: 'لا توجد صور بعد',
    emptyBody: 'أضف بعض صور الأعمال التي أنجزتها. يراها العملاء في ملفك الشخصي.',

    addButton: 'إضافة صورة',
    fileInputLabel: 'اختر ملف صورة',
    addAnother: 'إضافة صورة أخرى',
    slotsRemaining: 'صورة متبقية',
    limitReachedNotice: 'لقد وصلت إلى الحد الأقصى لعدد الصور.',

    uploading: 'جارٍ الرفع',
    uploadRetry: 'أعد المحاولة',
    uploadCancel: 'إلغاء',

    consentHint: 'قد يظهر فيها منزل عميل. اسأله أولاً.',

    captionLabel: 'التسمية',
    captionPlaceholder: 'مثال: تبديل حنفية المطبخ',
    descriptionLabel: 'التفاصيل',
    categoryLabel: 'الخدمة',
    save: 'حفظ',
    cancel: 'إلغاء',
    edit: 'تعديل',

    moveUp: 'تقديم',
    moveDown: 'تأخير',
    reorderHint: 'الصورة الأولى هي التي يراها العملاء أولاً.',

    delete: 'إزالة',
    deleteConfirmTitle: 'إزالة هذه الصورة؟',
    deleteConfirmBody: 'لن تظهر بعد الآن في ملفك الشخصي. لا يمكن التراجع عن هذا.',
    deleteConfirm: 'إزالة',
    deleteCancel: 'الاحتفاظ بها',

    moderationPending: 'قيد المراجعة',
    moderationApproved: 'ظاهرة للعملاء',
    moderationRejected: 'غير منشورة',

    loading: 'جارٍ تحميل صورك',
    loadFailed: 'تعذر تحميل صورك.',
    retry: 'أعد المحاولة',

    errLIMIT_REACHED: 'لقد وصلت إلى الحد الأقصى لعدد الصور.',
    errFILE_TOO_LARGE: 'هذه الصورة كبيرة جدًا. جرّب صورة أصغر.',
    errDISALLOWED_FORMAT: 'نوع الملف غير مدعوم. استخدم صورة JPEG أو PNG أو WebP.',
    errNOT_A_PORTFOLIO_KEY: 'تعذر نشر هذا الملف. الرجاء اختياره مرة أخرى.',
    errPUBLICATION_RIGHT_NOT_ACKNOWLEDGED: 'أكّد أولاً أنه يحق لك نشر هذه الصورة.',
    errUPLOAD_FAILED: 'لم يكتمل الرفع. تحقق من اتصالك وأعد المحاولة.',
    errUNKNOWN: 'حدث خطأ ما. الرجاء المحاولة مرة أخرى.',
  },
};

/** Localised text for a refusal code, falling back to the generic message so an
 *  unrecognised code never renders as a raw identifier to a provider. */
export function portfolioErrorText(lang: Lang, code: string | undefined): string {
  const copy = PORTFOLIO_COPY[lang];
  return copy[`err${code ?? 'UNKNOWN'}`] ?? copy.errUNKNOWN;
}
