import type {
  ProviderOnboardingField,
  ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

// Sprint 8 — every string the onboarding wizard renders, in both languages.
//
// Kept in one file rather than inline in the component for two reasons:
//
//   1. The wizard is nine screens. Inline ternaries at every label would make
//      the component unreadable and would let an Arabic string quietly go
//      missing behind a conditional nobody re-reads.
//   2. A test can assert that BOTH maps have the same keys, which is the only
//      way an untranslated string gets caught before an Arabic reader sees an
//      English label.
//
// Codes on the wire, prose here. Every step name, issue code, and transport
// mode arrives from the server as a stable code and is rendered from this map,
// so an Arabic client and an English client are always talking about the same
// thing.

export type Lang = 'en' | 'ar';

export const STEP_TITLES: Record<Lang, Record<ProviderOnboardingStep, string>> = {
  en: {
    PROVIDER_TYPE: 'Account type',
    IDENTITY: 'About you',
    LOCATION: 'Where you work',
    SPECIALTIES: 'What you do',
    EXPERIENCE: 'Experience & tools',
    AVAILABILITY: 'Your hours',
    PROFILE: 'Your profile',
    CONSENT: 'Terms',
    REVIEW: 'Review & submit',
  },
  ar: {
    PROVIDER_TYPE: 'نوع الحساب',
    IDENTITY: 'معلوماتك',
    LOCATION: 'أين تعمل',
    SPECIALTIES: 'ما الذي تقدمه',
    EXPERIENCE: 'الخبرة والمعدات',
    AVAILABILITY: 'ساعات عملك',
    PROFILE: 'ملفك الشخصي',
    CONSENT: 'الشروط',
    REVIEW: 'المراجعة والإرسال',
  },
};

export const STEP_HINTS: Record<Lang, Record<ProviderOnboardingStep, string>> = {
  en: {
    PROVIDER_TYPE: 'Are you working as an individual or a registered business?',
    IDENTITY: 'The name seekers will see, and a phone number we can verify.',
    LOCATION: 'The city you serve and how far you are willing to travel.',
    SPECIALTIES:
      'Pick the specialties you want to work in. Each one is reviewed before it goes live.',
    EXPERIENCE: 'How long you have been doing this, what you own, and how you get to a job.',
    AVAILABILITY: 'The hours you normally work each week. You can change these any time.',
    PROFILE: 'A headline and a short description seekers will read.',
    CONSENT: 'Read and accept the provider terms.',
    REVIEW: 'Check everything, then send it to us.',
  },
  ar: {
    PROVIDER_TYPE: 'هل تعمل بصفتك فرداً أم منشأة مسجلة؟',
    IDENTITY: 'الاسم الذي سيراه العملاء، ورقم هاتف يمكننا التحقق منه.',
    LOCATION: 'المدينة التي تخدمها والمسافة التي تستطيع التنقل إليها.',
    SPECIALTIES: 'اختر التخصصات التي تريد العمل بها. تتم مراجعة كل تخصص قبل تفعيله.',
    EXPERIENCE: 'منذ متى تعمل في المهنة، وما المعدات التي تملكها، وكيف تصل إلى الموقع.',
    AVAILABILITY: 'الساعات التي تعمل بها عادة كل أسبوع. يمكنك تعديلها في أي وقت.',
    PROFILE: 'عنوان مختصر ووصف يقرأه العملاء.',
    CONSENT: 'اقرأ شروط مزوّدي الخدمة ووافق عليها.',
    REVIEW: 'راجع كل شيء ثم أرسله إلينا.',
  },
};

/** What each unmet requirement means, in words the provider can act on.
 *
 *  Keyed by the server's `field` code plus its `code`. "bio is REQUIRED" is a
 *  wire fact; "Add a short description of your work" is something to do. */
export const ISSUE_COPY: Record<Lang, Record<string, string>> = {
  en: {
    'displayName:REQUIRED': 'Add the name seekers will see.',
    'displayName:TOO_SHORT': 'That name is too short.',
    'headline:REQUIRED': 'Add a one-line headline.',
    'headline:TOO_SHORT': 'Your headline needs a little more detail.',
    'bio:REQUIRED': 'Add a short description of your work.',
    'bio:TOO_SHORT': 'Your description needs a little more detail.',
    'phoneNumber:REQUIRED': 'Add a phone number.',
    'phoneNumber:NOT_VERIFIED': 'Verify your phone number.',
    'emailVerified:UNVERIFIED': 'Verify your email address.',
    'serviceAreaCity:REQUIRED': 'Choose the city you work in.',
    'serviceAreaCountry:REQUIRED': 'Choose your country.',
    'serviceAreaRadiusKm:REQUIRED': 'Set how far you will travel.',
    'serviceCategories:REQUIRED': 'Choose at least one service.',
    'specialties:REQUIRED': 'Choose at least one specialty.',
    'providerType:REQUIRED': 'Choose individual or business.',
    'legalBusinessName:REQUIRED': 'Add your registered business name.',
    'availability:REQUIRED': 'Add the hours you work.',
    'yearsOfExperience:REQUIRED': 'Add how long you have been doing this.',
    'yearsOfExperience:OUT_OF_RANGE': 'That number of years does not look right.',
    'consent:REQUIRED': 'Accept the provider terms.',
  },
  ar: {
    'displayName:REQUIRED': 'أضف الاسم الذي سيراه العملاء.',
    'displayName:TOO_SHORT': 'الاسم قصير جداً.',
    'headline:REQUIRED': 'أضف عنواناً من سطر واحد.',
    'headline:TOO_SHORT': 'العنوان يحتاج إلى تفاصيل أكثر.',
    'bio:REQUIRED': 'أضف وصفاً مختصراً لعملك.',
    'bio:TOO_SHORT': 'الوصف يحتاج إلى تفاصيل أكثر.',
    'phoneNumber:REQUIRED': 'أضف رقم هاتف.',
    'phoneNumber:NOT_VERIFIED': 'وثّق رقم هاتفك.',
    'emailVerified:UNVERIFIED': 'وثّق بريدك الإلكتروني.',
    'serviceAreaCity:REQUIRED': 'اختر المدينة التي تعمل بها.',
    'serviceAreaCountry:REQUIRED': 'اختر بلدك.',
    'serviceAreaRadiusKm:REQUIRED': 'حدّد المسافة التي تستطيع التنقل إليها.',
    'serviceCategories:REQUIRED': 'اختر خدمة واحدة على الأقل.',
    'specialties:REQUIRED': 'اختر تخصصاً واحداً على الأقل.',
    'providerType:REQUIRED': 'اختر فرد أو منشأة.',
    'legalBusinessName:REQUIRED': 'أضف الاسم التجاري المسجل.',
    'availability:REQUIRED': 'أضف ساعات عملك.',
    'yearsOfExperience:REQUIRED': 'أضف عدد سنوات خبرتك.',
    'yearsOfExperience:OUT_OF_RANGE': 'عدد السنوات لا يبدو صحيحاً.',
    'consent:REQUIRED': 'وافق على شروط مزوّدي الخدمة.',
  },
};

/** Fall back to a generic line rather than rendering a raw wire code.
 *
 *  A server that adds a rule before the client ships its copy would otherwise
 *  show "legalBusinessName:REQUIRED" to a provider, which is both meaningless
 *  and a small leak of internal field names. */
export function issueText(lang: Lang, field: ProviderOnboardingField, code: string): string {
  return (
    ISSUE_COPY[lang][`${field}:${code}`] ??
    (lang === 'ar' ? 'هذه الخانة تحتاج إلى استكمال.' : 'This still needs completing.')
  );
}

export const TRANSPORT_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    ON_FOOT: 'On foot',
    MOTORCYCLE: 'Motorcycle',
    CAR: 'Car',
    VAN: 'Van',
    TRUCK: 'Truck',
    PUBLIC_TRANSPORT: 'Public transport',
  },
  ar: {
    ON_FOOT: 'سيراً على الأقدام',
    MOTORCYCLE: 'دراجة نارية',
    CAR: 'سيارة',
    VAN: 'فان',
    TRUCK: 'شاحنة',
    PUBLIC_TRANSPORT: 'مواصلات عامة',
  },
};

/** Sunday-first, matching `dayOfWeek` 0-6 and JS `Date#getDay()`. There is no
 *  conversion layer between the client, the server, and the database CHECK. */
export const DAY_LABELS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

export const UI = {
  en: {
    wizardTitle: 'Set up your provider account',
    progress: 'complete',
    back: 'Back',
    next: 'Next',
    submit: 'Send application',
    submitting: 'Sending…',
    withdraw: 'Withdraw application',
    withdrawing: 'Withdrawing…',
    edit: 'Edit',
    saving: 'Saving…',
    saved: 'Saved',
    saveError: 'Could not save',
    retry: 'Retry',
    offline: 'Offline — your changes are kept and will save when you reconnect.',
    conflict: 'This application was changed in another tab. Reload to see the latest version.',
    reload: 'Reload',
    loading: 'Loading your application…',
    loadError: 'We could not load your application. Please try again.',
    stepOf: 'Step',
    // The state a valid submission lands in. Worded so it cannot be mistaken
    // for approval, because it is not one.
    submittedTitle: 'Application received',
    submittedBody:
      'Thank you. We still need to check your identity documents before you can start working — we will be in touch about what to send.',
    submittedNotApproved: 'This is not approval yet.',
    awaitingTitle: 'With our team',
    awaitingBody: 'Your application is being reviewed. We will let you know as soon as we decide.',
    // Fields
    individual: 'Individual',
    individualHint: 'You work under your own name.',
    business: 'Business',
    businessHint: 'You work under a registered trading name.',
    legalBusinessName: 'Registered business name',
    displayName: 'Name seekers see',
    profileImage: 'Profile photo URL',
    phoneNumber: 'Phone number',
    phoneUnverified: 'Not verified yet',
    phoneVerified: 'Verified',
    city: 'City',
    country: 'Country',
    radius: 'How far will you travel? (km)',
    workshopAddress: 'Workshop address (optional)',
    useMyLocation: 'Use my location',
    locationDenied: 'We could not read your location. Enter your city and address instead.',
    locating: 'Finding you…',
    coordinatesSet: 'Location set',
    groups: 'Service groups',
    groupsHint: 'Choosing a group does not grant anything — pick the specialties beneath it.',
    specialties: 'Specialties',
    specialtyPending: 'Awaiting review',
    specialtyApproved: 'Approved',
    yearsOfExperience: 'Years of experience',
    equipment: 'Equipment you own',
    transport: 'How do you get to a job?',
    timezone: 'Timezone',
    addHours: 'Add hours',
    remove: 'Remove',
    from: 'From',
    to: 'To',
    overlapError: 'These hours overlap with another window on the same day.',
    noHours: 'No hours added yet.',
    headline: 'Headline',
    bio: 'About your work',
    additionalInformation: 'Anything else (optional)',
    consentText: 'I have read and accept the provider terms.',
    consentVersion: 'Version',
    reviewIntro: 'Here is everything you have told us. Anything still needed is marked.',
    nothingYet: 'Not answered yet',
    // Shown for a 403: signed in, but this account is not a provider. A 401
    // never reaches this screen — the api client fires auth:session-expired
    // and the auth layer routes to login before the wizard can render.
    notAProvider: 'This account is not set up as a provider yet.',
  },
  ar: {
    wizardTitle: 'إعداد حساب مزوّد الخدمة',
    progress: 'مكتمل',
    back: 'رجوع',
    next: 'التالي',
    submit: 'إرسال الطلب',
    submitting: 'جارٍ الإرسال…',
    withdraw: 'سحب الطلب',
    withdrawing: 'جارٍ السحب…',
    edit: 'تعديل',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    saveError: 'تعذّر الحفظ',
    retry: 'إعادة المحاولة',
    offline: 'لا يوجد اتصال — تم الاحتفاظ بتعديلاتك وسيتم حفظها عند عودة الاتصال.',
    conflict: 'تم تعديل هذا الطلب في نافذة أخرى. أعد التحميل لعرض أحدث نسخة.',
    reload: 'إعادة التحميل',
    loading: 'جارٍ تحميل طلبك…',
    loadError: 'تعذّر تحميل طلبك. حاول مرة أخرى.',
    stepOf: 'الخطوة',
    submittedTitle: 'تم استلام الطلب',
    submittedBody:
      'شكراً لك. ما زلنا بحاجة إلى التحقق من وثائق هويتك قبل أن تتمكن من بدء العمل — سنتواصل معك بشأن ما يلزم إرساله.',
    submittedNotApproved: 'هذه ليست موافقة نهائية بعد.',
    awaitingTitle: 'قيد المراجعة',
    awaitingBody: 'طلبك قيد المراجعة. سنعلمك فور صدور القرار.',
    individual: 'فرد',
    individualHint: 'تعمل باسمك الشخصي.',
    business: 'منشأة',
    businessHint: 'تعمل باسم تجاري مسجل.',
    legalBusinessName: 'الاسم التجاري المسجل',
    displayName: 'الاسم الذي يراه العملاء',
    profileImage: 'رابط صورة الملف',
    phoneNumber: 'رقم الهاتف',
    phoneUnverified: 'غير موثّق بعد',
    phoneVerified: 'موثّق',
    city: 'المدينة',
    country: 'البلد',
    radius: 'ما المسافة التي تستطيع التنقل إليها؟ (كم)',
    workshopAddress: 'عنوان الورشة (اختياري)',
    useMyLocation: 'استخدم موقعي',
    locationDenied: 'تعذّر تحديد موقعك. أدخل المدينة والعنوان يدوياً.',
    locating: 'جارٍ تحديد موقعك…',
    coordinatesSet: 'تم تحديد الموقع',
    groups: 'مجموعات الخدمات',
    groupsHint: 'اختيار المجموعة لا يمنحك شيئاً — اختر التخصصات التي تندرج تحتها.',
    specialties: 'التخصصات',
    specialtyPending: 'قيد المراجعة',
    specialtyApproved: 'معتمد',
    yearsOfExperience: 'سنوات الخبرة',
    equipment: 'المعدات التي تملكها',
    transport: 'كيف تصل إلى موقع العمل؟',
    timezone: 'المنطقة الزمنية',
    addHours: 'إضافة ساعات',
    remove: 'حذف',
    from: 'من',
    to: 'إلى',
    overlapError: 'هذه الساعات تتداخل مع فترة أخرى في اليوم نفسه.',
    noHours: 'لم تُضف ساعات بعد.',
    headline: 'العنوان',
    bio: 'عن عملك',
    additionalInformation: 'أي معلومات إضافية (اختياري)',
    consentText: 'قرأت شروط مزوّدي الخدمة وأوافق عليها.',
    consentVersion: 'الإصدار',
    reviewIntro: 'هذا كل ما أخبرتنا به. تم تمييز أي بند ما زال ناقصاً.',
    nothingYet: 'لم تتم الإجابة بعد',
    notAProvider: 'هذا الحساب غير مُهيأ كمزوّد خدمة بعد.',
  },
} as const;

/** Minutes from midnight as HH:mm, for `<input type="time">` and for display.
 *  1440 renders as 24:00 because the end of a window is exclusive — "until
 *  00:00" reads as the start of the day it is actually the end of. */
export function minuteToTime(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Parse an `<input type="time">` value back to minutes. Returns null on
 *  anything unparseable rather than NaN, so a bad value cannot travel. */
export function timeToMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total >= 0 && total <= 1440 ? total : null;
}
