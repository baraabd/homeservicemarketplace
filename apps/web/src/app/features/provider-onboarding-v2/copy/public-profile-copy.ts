// Sprint 9B.22 — every string V2 Task 5 renders.
//
// THE COPY RULE FOR THIS SCREEN IS HONESTY ABOUT WHAT IS NOT BUILT.
//
// Nothing on this platform publishes a provider profile to customers yet, and
// nothing reviews a portfolio photo. A screen that showed a polished "this is
// your public profile" and called unreviewed photos published would be lying to
// the provider about the state of their own application. So the waiting copy
// says what is true, the server tells the client which of those facts still
// hold, and neither sentence is hardcoded optimism.

export type Lang = 'en' | 'ar';

export interface PublicProfileCopy {
  heading: string;
  intro: string;

  // Title
  titleLegend: string;
  titleHint: string;
  titleSuggestionLabel: string;
  titleUse: string;
  titleLabel: string;
  titlePlaceholder: string;
  titleTooShort: (min: number) => string;
  titleRefusal: Record<string, string>;

  // Bio
  bioLegend: string;
  bioHint: string;
  bioLabel: string;
  bioPlaceholder: string;
  bioExamplesLabel: string;
  bioExamples: string[];
  bioTooShort: (min: number) => string;
  bioCounter: (used: string, max: string) => string;
  bioCounterOver: string;

  // Preview
  previewLegend: string;
  previewHint: string;
  previewRefresh: string;
  previewEmptyAbout: string;
  previewNoPhotos: string;
  previewServicesLabel: string;
  previewAreaLabel: string;
  previewLoadFailed: string;

  // The honest notices.
  noticeRouteUnavailable: string;
  noticeAwaitingReview: (count: string) => string;
  noticeNoReviewer: string;
  noticePrivateNotShown: string;

  // Save status — the same vocabulary the other tasks use.
  saving: string;
  saved: string;
  saveFailed: string;
  saveRetry: string;
  saveConflict: string;
  offline: string;
}

export const PUBLIC_PROFILE_COPY: Record<Lang, PublicProfileCopy> = {
  en: {
    heading: 'Your public profile',
    intro: 'This is what customers will see. Your contact details are never shown.',

    titleLegend: 'What you do',
    titleHint: 'A short professional title. It appears under your name.',
    titleSuggestionLabel: 'Suggested from your main service',
    titleUse: 'Use this',
    titleLabel: 'Professional title',
    titlePlaceholder: 'e.g. Certified electrician',
    titleTooShort: (min) => `Use at least ${min} characters so customers know what you do.`,
    titleRefusal: {
      TOO_SHORT: 'That is too short to tell a customer anything.',
      TOO_LONG: 'That is too long for a title.',
      CONTAINS_CONTACT: 'Leave phone numbers and email addresses out of your title.',
      CONTAINS_URL: 'Links are not allowed in a title.',
      PROHIBITED_CLAIM: 'That claim cannot be shown without proof.',
      UNSUPPORTED_CREDENTIAL: 'We cannot show a credential we have not verified.',
      EMPTY: 'Add a title.',
    },

    bioLegend: 'About your work',
    bioHint: 'A few sentences about what you do and how you work.',
    bioLabel: 'About you',
    bioPlaceholder: 'Tell customers what you do, how long you have done it, and how you work.',
    bioExamplesLabel: 'Things worth mentioning',
    bioExamples: [
      'The work you do most often',
      'How many years you have been doing it',
      'What a customer can expect when you arrive',
      'Any tools or equipment you bring',
    ],
    bioTooShort: (min) => `Write at least ${min} characters.`,
    bioCounter: (used, max) => `${used} of ${max} characters`,
    bioCounterOver: 'Too long — shorten it before it can be saved.',

    previewLegend: 'What customers see',
    previewHint: 'Built from the same data a customer request would return.',
    previewRefresh: 'Refresh preview',
    previewEmptyAbout: 'Nothing here yet — add a title and a few sentences above.',
    previewNoPhotos: 'No photos are visible to customers yet.',
    previewServicesLabel: 'Services',
    previewAreaLabel: 'Area',
    previewLoadFailed: 'The preview could not be loaded.',

    noticeRouteUnavailable:
      'Customer-facing profiles are not live on the platform yet. This is the data a profile page will show when it is.',
    noticeAwaitingReview: (count) =>
      `${count} photo(s) uploaded and waiting to be reviewed. They are not visible to customers.`,
    noticeNoReviewer:
      'Photo review is not available yet, so nothing has been reviewed. Your photos are saved and stay private until it is.',
    noticePrivateNotShown:
      'Your phone number, exact location and any documents you uploaded are never part of this.',

    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Could not save.',
    saveRetry: 'Try again',
    saveConflict: 'Your profile changed somewhere else. Reload to see the current version.',
    offline: 'Offline — your changes are waiting.',
  },
  ar: {
    heading: 'ملفك العام',
    intro: 'هذا ما سيراه العملاء. لا تُعرض بيانات التواصل الخاصة بك أبداً.',

    titleLegend: 'ماذا تعمل',
    titleHint: 'مسمّى مهني قصير. يظهر أسفل اسمك.',
    titleSuggestionLabel: 'اقتراح من خدمتك الرئيسية',
    titleUse: 'استخدم هذا',
    titleLabel: 'المسمّى المهني',
    titlePlaceholder: 'مثال: كهربائي معتمد',
    titleTooShort: (min) => `استخدم ${min} حرفاً على الأقل ليعرف العملاء ما تقدّمه.`,
    titleRefusal: {
      TOO_SHORT: 'هذا أقصر من أن يوضّح شيئاً للعميل.',
      TOO_LONG: 'هذا أطول من اللازم لمسمّى مهني.',
      CONTAINS_CONTACT: 'لا تضع أرقام هواتف أو بريداً إلكترونياً في المسمّى.',
      CONTAINS_URL: 'الروابط غير مسموحة في المسمّى.',
      PROHIBITED_CLAIM: 'لا يمكن عرض هذا الادعاء دون إثبات.',
      UNSUPPORTED_CREDENTIAL: 'لا يمكننا عرض شهادة لم نتحقق منها.',
      EMPTY: 'أضف مسمّى مهنياً.',
    },

    bioLegend: 'عن عملك',
    bioHint: 'بضع جمل عن عملك وطريقتك فيه.',
    bioLabel: 'نبذة عنك',
    bioPlaceholder: 'أخبر العملاء بما تقدّمه، ومنذ متى، وكيف تعمل.',
    bioExamplesLabel: 'أمور يستحق ذكرها',
    bioExamples: [
      'العمل الذي تقوم به غالباً',
      'عدد سنوات خبرتك فيه',
      'ما الذي يتوقعه العميل عند وصولك',
      'الأدوات أو المعدات التي تحضرها',
    ],
    bioTooShort: (min) => `اكتب ${min} حرفاً على الأقل.`,
    bioCounter: (used, max) => `${used} من ${max} حرف`,
    bioCounterOver: 'أطول من اللازم — اختصره ليتم الحفظ.',

    previewLegend: 'ما يراه العملاء',
    previewHint: 'مبني من البيانات نفسها التي سيحصل عليها طلب العميل.',
    previewRefresh: 'تحديث المعاينة',
    previewEmptyAbout: 'لا يوجد شيء بعد — أضف مسمّى وبضع جمل أعلاه.',
    previewNoPhotos: 'لا توجد صور ظاهرة للعملاء بعد.',
    previewServicesLabel: 'الخدمات',
    previewAreaLabel: 'المنطقة',
    previewLoadFailed: 'تعذّر تحميل المعاينة.',

    noticeRouteUnavailable:
      'الملفات العامة للمزوّدين ليست مفعّلة على المنصّة بعد. هذه هي البيانات التي ستعرضها صفحة الملف عند تفعيلها.',
    noticeAwaitingReview: (count) =>
      `${count} صورة مرفوعة وبانتظار المراجعة. وهي غير ظاهرة للعملاء.`,
    noticeNoReviewer:
      'مراجعة الصور غير متاحة بعد، لذلك لم تُراجَع أي صورة. صورك محفوظة وتبقى خاصة حتى تتوفّر المراجعة.',
    noticePrivateNotShown: 'رقم هاتفك وموقعك الدقيق وأي مستندات رفعتها ليست جزءاً من هذا إطلاقاً.',

    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    saveFailed: 'تعذّر الحفظ.',
    saveRetry: 'إعادة المحاولة',
    saveConflict: 'تغيّر ملفك في مكان آخر. أعد التحميل لعرض النسخة الحالية.',
    offline: 'غير متصل — تغييراتك في الانتظار.',
  },
};

/**
 * The character count, localised.
 *
 * Counted on the TRIMMED value because that is what the server measures: the
 * DTO trims before its length check, so a counter that included trailing
 * spaces would promise a save the server refuses.
 *
 * `Intl.NumberFormat` rather than string interpolation, so Arabic gets
 * Arabic-Indic digits — the whole point of calling it a localised counter.
 */
export function formatCount(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US').format(value);
}
