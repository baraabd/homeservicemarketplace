// Sprint 9B.23 — V2 Task 6 copy.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// THE SERVER SENDS CODES; THIS FILE OWNS THE SENTENCES.
//
// `/onboarding/review` returns `field` + `code` (and a `taskId`), never prose.
// A server that sent the sentence would decide the app's language and its
// tone, and would make every copy change a backend deploy. So the mapping from
// a policy code to a human line lives here, in both languages, beside every
// other screen's copy.
//
// An UNKNOWN code is not a crash and not a blank line: `blockerLine` falls back
// to a generic sentence that still names the task to open. A rule added to the
// policy tomorrow therefore degrades to "something here needs attention, open
// this task" rather than to an empty amber card.

export type Lang = 'en' | 'ar';

export interface ReviewCopy {
  heading: string;
  intro: string;

  groupBlocking: string;
  groupOptional: string;
  groupWaiting: string;
  groupComplete: string;

  completeNow: string;
  /** Announced when the review refreshes and the verdict changed. */
  refreshed: string;

  termsHeading: string;
  /** The acknowledgement sentence, versioned by the SERVER. The version is
   *  shown so a provider can say which document they agreed to. */
  termsBody: (version: string) => string;
  termsAccept: string;
  termsAccepted: (version: string) => string;
  termsStale: string;

  submit: string;
  submitting: string;
  submitted: string;
  submittedBody: string;
  /** The single next action, when the button is disabled. */
  blockedPrefix: string;

  waitingSpecialties: (count: string) => string;
  waitingPortfolio: (count: string) => string;
  optionalPortfolioEmpty: string;

  stepLabel: Record<string, string>;
  blocker: Record<string, string>;
  blockerFallback: string;

  loadFailed: string;
  retry: string;
  conflict: string;
}

/** Localised digits, so Arabic gets Arabic-Indic numerals rather than a Latin
 *  count sitting inside an Arabic sentence. */
export function formatCount(value: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US').format(value);
}

const EN: ReviewCopy = {
  heading: 'Review and submit',
  intro: 'Check what you have entered, agree to the terms, then hand your application in.',

  groupBlocking: 'Needs your attention',
  groupOptional: 'Worth adding',
  groupWaiting: 'With us',
  groupComplete: 'Done',

  completeNow: 'Complete now',
  refreshed: 'Your application was rechecked.',

  termsHeading: 'Terms',
  termsBody: (version) =>
    `I have read and agree to the provider terms (version ${version}), and confirm the information in this application is accurate.`,
  termsAccept: 'I agree to the terms',
  termsAccepted: (version) => `You agreed to version ${version}.`,
  termsStale: 'The terms have been updated. Please read and agree to the current version.',

  submit: 'Submit application',
  submitting: 'Submitting…',
  submitted: 'Application submitted',
  submittedBody:
    'We have it. Submitting does not give you access to work yet — we will tell you what happens next.',
  blockedPrefix: 'Next:',

  waitingSpecialties: (count) => `${count} specialty applications are being reviewed.`,
  waitingPortfolio: (count) => `${count} photos are waiting to be reviewed.`,
  optionalPortfolioEmpty: 'Adding a few photos of your work helps customers choose you.',

  stepLabel: {
    PROVIDER_TYPE: 'Account type',
    IDENTITY: 'Your details',
    LOCATION: 'Where you work',
    SPECIALTIES: 'Your services',
    EXPERIENCE: 'Experience',
    AVAILABILITY: 'Working hours',
    PROFILE: 'Public profile',
    CONSENT: 'Terms',
    REVIEW: 'Review',
  },

  blocker: {
    'displayName:REQUIRED': 'Add the name customers will see.',
    'displayName:TOO_SHORT': 'Your display name is too short.',
    'headline:REQUIRED': 'Add a professional title.',
    'headline:TOO_SHORT': 'Your professional title is too short.',
    'bio:REQUIRED': 'Write a short description of what you do.',
    'bio:TOO_SHORT': 'Your description is too short.',
    'phoneNumber:REQUIRED': 'Add a phone number.',
    'emailVerified:UNVERIFIED': 'Confirm your email address.',
    'serviceAreaCity:REQUIRED': 'Choose the city you work in.',
    'serviceAreaCountry:REQUIRED': 'Choose the country you work in.',
    'serviceAreaRadiusKm:REQUIRED': 'Set how far you are willing to travel.',
    'serviceCategories:REQUIRED': 'Choose at least one service.',
    'providerType:REQUIRED': 'Choose whether you work as an individual or a business.',
    'legalBusinessName:REQUIRED': 'Add your registered business name.',
    'yearsOfExperience:REQUIRED': 'Tell us how long you have worked in your trade.',
    'availability:REQUIRED': 'Set your weekly working hours.',
    'timezone:REQUIRED': 'Set your timezone.',
    'acceptedConsentVersion:REQUIRED': 'Agree to the terms below.',
    'acceptedConsentVersion:STALE_VERSION': 'The terms have changed — agree to the new version.',
    // The policy emits the consent issue under the field name `consent`, not
    // `acceptedConsentVersion` — that is the DRAFT column it writes, not the
    // issue it raises. Without this key the one blocker standing between a
    // finished application and submission rendered as the fallback below:
    // "Something here still needs attention", on the very screen that collects
    // it. See provider-onboarding.policy.ts.
    'consent:REQUIRED': 'Agree to the terms below to submit your application.',
    'phoneNumber:NOT_VERIFIED': 'Confirm your phone number.',
    // AWAITING_REVIEW is not REQUIRED, and saying so matters: the provider has
    // done their part and is waiting on us. Telling them a field is required
    // says they have not.
    'serviceCategories:AWAITING_REVIEW': 'Your services are with us for review.',
    'specialties:REQUIRED': 'Choose at least one specialty you work in.',
    'specialties:AWAITING_REVIEW': 'Your specialties are with us for review.',
    'yearsOfExperience:OUT_OF_RANGE': 'Check the number of years you entered.',
  },
  blockerFallback: 'Something here still needs attention.',

  loadFailed: 'We could not load your application. Please try again.',
  retry: 'Try again',
  conflict:
    'Your application changed somewhere else. We have reloaded it — please check and resubmit.',
};

const AR: ReviewCopy = {
  heading: 'المراجعة والإرسال',
  intro: 'راجع ما أدخلته، ووافق على الشروط، ثم أرسل طلبك.',

  groupBlocking: 'يحتاج انتباهك',
  groupOptional: 'يستحق الإضافة',
  groupWaiting: 'لدينا',
  groupComplete: 'مكتمل',

  completeNow: 'أكمل الآن',
  refreshed: 'تمت إعادة فحص طلبك.',

  termsHeading: 'الشروط',
  termsBody: (version) =>
    `لقد قرأت شروط مقدّمي الخدمة (الإصدار ${version}) وأوافق عليها، وأؤكد أن المعلومات في هذا الطلب صحيحة.`,
  termsAccept: 'أوافق على الشروط',
  termsAccepted: (version) => `وافقت على الإصدار ${version}.`,
  termsStale: 'تم تحديث الشروط. يرجى قراءة الإصدار الحالي والموافقة عليه.',

  submit: 'إرسال الطلب',
  submitting: 'جارٍ الإرسال…',
  submitted: 'تم إرسال الطلب',
  submittedBody: 'وصلنا طلبك. الإرسال لا يمنحك صلاحية العمل بعد — سنخبرك بالخطوة التالية.',
  blockedPrefix: 'التالي:',

  waitingSpecialties: (count) => `${count} من طلبات التخصص قيد المراجعة.`,
  waitingPortfolio: (count) => `${count} من الصور بانتظار المراجعة.`,
  optionalPortfolioEmpty: 'إضافة بعض صور أعمالك تساعد العملاء على اختيارك.',

  stepLabel: {
    PROVIDER_TYPE: 'نوع الحساب',
    IDENTITY: 'بياناتك',
    LOCATION: 'أين تعمل',
    SPECIALTIES: 'خدماتك',
    EXPERIENCE: 'الخبرة',
    AVAILABILITY: 'ساعات العمل',
    PROFILE: 'الملف العام',
    CONSENT: 'الشروط',
    REVIEW: 'المراجعة',
  },

  blocker: {
    'displayName:REQUIRED': 'أضف الاسم الذي سيراه العملاء.',
    'displayName:TOO_SHORT': 'الاسم المعروض قصير جداً.',
    'headline:REQUIRED': 'أضف مسمّى مهنياً.',
    'headline:TOO_SHORT': 'المسمّى المهني قصير جداً.',
    'bio:REQUIRED': 'اكتب وصفاً موجزاً لما تقدّمه.',
    'bio:TOO_SHORT': 'الوصف قصير جداً.',
    'phoneNumber:REQUIRED': 'أضف رقم هاتف.',
    'emailVerified:UNVERIFIED': 'أكّد بريدك الإلكتروني.',
    'serviceAreaCity:REQUIRED': 'اختر المدينة التي تعمل فيها.',
    'serviceAreaCountry:REQUIRED': 'اختر الدولة التي تعمل فيها.',
    'serviceAreaRadiusKm:REQUIRED': 'حدّد المسافة التي يمكنك السفر إليها.',
    'serviceCategories:REQUIRED': 'اختر خدمة واحدة على الأقل.',
    'providerType:REQUIRED': 'اختر إن كنت تعمل كفرد أو كمنشأة.',
    'legalBusinessName:REQUIRED': 'أضف الاسم المسجّل لمنشأتك.',
    'yearsOfExperience:REQUIRED': 'أخبرنا منذ متى تعمل في مهنتك.',
    'availability:REQUIRED': 'حدّد ساعات عملك الأسبوعية.',
    'timezone:REQUIRED': 'حدّد المنطقة الزمنية.',
    'acceptedConsentVersion:REQUIRED': 'وافق على الشروط أدناه.',
    'acceptedConsentVersion:STALE_VERSION': 'تغيّرت الشروط — وافق على الإصدار الجديد.',
    'consent:REQUIRED': 'وافق على الشروط أدناه لإرسال طلبك.',
    'phoneNumber:NOT_VERIFIED': 'أكّد رقم هاتفك.',
    'serviceCategories:AWAITING_REVIEW': 'خدماتك قيد المراجعة لدينا.',
    'specialties:REQUIRED': 'اختر تخصصاً واحداً على الأقل.',
    'specialties:AWAITING_REVIEW': 'تخصصاتك قيد المراجعة لدينا.',
    'yearsOfExperience:OUT_OF_RANGE': 'راجع عدد السنوات الذي أدخلته.',
  },
  blockerFallback: 'ما زال هناك ما يحتاج انتباهك.',

  loadFailed: 'تعذّر تحميل طلبك. حاول مرة أخرى.',
  retry: 'حاول مرة أخرى',
  conflict: 'تغيّر طلبك في مكان آخر. أعدنا تحميله — راجعه ثم أعد الإرسال.',
};

export const REVIEW_COPY: Record<Lang, ReviewCopy> = { en: EN, ar: AR };

/**
 * The sentence for one blocker.
 *
 * Keyed `field:code`, falling back to a generic line rather than to nothing: a
 * policy rule added without copy should still produce a card the provider can
 * act on, because the card carries the task to open.
 */
export function blockerLine(copy: ReviewCopy, field: string | null, code: string | null): string {
  if (field && code) {
    const exact = copy.blocker[`${field}:${code}`];
    if (exact) return exact;
  }
  return copy.blockerFallback;
}
