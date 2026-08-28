import type { ProviderSpecialtyState } from '@homeservicemarketplace/contracts';

// Sprint 9B.18 — every string V2 Task 2 renders.
//
// The wording here is load-bearing for one of the acceptance criteria: a
// PENDING specialty must never read as something the provider got wrong. So
// the pending copy talks about US ("we are reviewing this"), and only the
// rejected and inactive copy talks about what they can do next.

export type Lang = 'en' | 'ar';

export interface ServicesCopy {
  heading: string;

  // Picker
  searchLabel: string;
  searchPlaceholder: string;
  noResults: string;
  noResultsHint: string;
  chooseGroup: string;
  selectedCount: (chosen: number, max: number) => string;
  limitReached: string;
  clearSearch: string;

  // Primary
  primaryLegend: string;
  primaryHint: string;
  primaryBadge: string;
  makePrimary: string;
  primaryRequired: string;

  // Review states — the section headings that keep selection and review apart
  stateHeading: Record<ProviderSpecialtyState, string>;
  stateExplain: Record<ProviderSpecialtyState, string>;
  remove: string;

  // Experience
  experienceLegend: string;
  startYearLabel: string;
  startYearHint: string;
  startYearInvalid: string;
  yearsDerived: (years: number) => string;

  // Equipment
  equipmentLegend: string;
  equipmentHint: string;
  equipmentEmpty: string;

  // Transport
  transportLegend: string;
  transportHint: string;
  transportPrimary: string;
  transportPrimaryHint: string;

  // Title
  titleLegend: string;
  titleHint: string;
  titleSuggested: (value: string) => string;
  titleUse: string;
  titleEdit: string;
  titleNotPublished: string;
  titleRefusal: Record<string, string>;
}

export const SERVICES_COPY: Record<Lang, ServicesCopy> = {
  en: {
    heading: 'Services and experience',

    searchLabel: 'Search services',
    searchPlaceholder: 'Try “leak”, “wiring”, “paint”…',
    noResults: 'Nothing matches that',
    noResultsHint: 'Try a shorter word, or browse the groups below.',
    chooseGroup: 'Browse by group',
    selectedCount: (chosen, max) => `${chosen} of ${max} chosen`,
    limitReached: 'You have chosen the maximum. Remove one to add another.',
    clearSearch: 'Clear search',

    primaryLegend: 'Your main service',
    primaryHint: 'The one you want to be known for. We use it to suggest your job title.',
    primaryBadge: 'Main',
    makePrimary: 'Make this my main service',
    primaryRequired: 'Choose which of these is your main service.',

    stateHeading: {
      APPROVED: 'Approved',
      PENDING: 'With us for review',
      REJECTED: 'Not approved',
      INACTIVE: 'No longer offered',
    },
    stateExplain: {
      APPROVED: 'You can be matched with customers for these.',
      // Deliberately about US, not them. There is nothing to fix.
      PENDING:
        'We are checking these. You do not need to do anything, and you can carry on with the rest of your application.',
      REJECTED:
        'We could not approve these. You can choose something else, or contact support to ask why.',
      INACTIVE:
        'We no longer offer these services. Nothing you did caused this — choose another to replace it.',
    },
    remove: 'Remove',

    experienceLegend: 'Experience',
    startYearLabel: 'The year you started this trade',
    startYearHint: 'We work out your years of experience from this, so it stays accurate.',
    startYearInvalid: 'Enter a year between 1950 and this year.',
    yearsDerived: (years) =>
      years === 1 ? '1 year of experience' : `${years} years of experience`,

    equipmentLegend: 'Equipment you own',
    equipmentHint: 'Optional. It helps us match you with the right jobs.',
    equipmentEmpty: 'No equipment listed for your services yet.',

    transportLegend: 'How you get to a job',
    transportHint: 'Choose everything you can use.',
    transportPrimary: 'Usually',
    transportPrimaryHint: 'Which one do you use most?',

    titleLegend: 'Your job title',
    titleHint: 'This is what customers see next to your name.',
    titleSuggested: (value) => `Based on your main service, we suggest “${value}”.`,
    titleUse: 'Use this title',
    titleEdit: 'Write my own',
    // The sentence that makes the acceptance criterion visible to the user.
    titleNotPublished: 'Nothing is published yet. You will confirm your title on the profile step.',
    titleRefusal: {
      TOO_SHORT: 'That is too short to be a job title.',
      TOO_LONG: 'That is too long. Keep it short enough to read at a glance.',
      CONTAINS_URL: 'A job title cannot contain a website address.',
      CONTAINS_CONTACT: 'A job title cannot contain a phone number or email address.',
      PROHIBITED_CLAIM: 'We cannot show claims like this because we cannot check them.',
      UNSUPPORTED_CREDENTIAL:
        'We can only show credentials we have verified. Add your documents and we will show them properly.',
    },
  },
  ar: {
    heading: 'الخدمات والخبرة',

    searchLabel: 'ابحث عن خدمة',
    searchPlaceholder: 'جرّب «تسريب»، «تمديدات»، «دهان»…',
    noResults: 'لا توجد نتائج مطابقة',
    noResultsHint: 'جرّب كلمة أقصر، أو تصفّح المجموعات بالأسفل.',
    chooseGroup: 'تصفّح حسب المجموعة',
    selectedCount: (chosen, max) => `اخترت ${chosen} من ${max}`,
    limitReached: 'وصلت إلى الحد الأقصى. أزل واحدة لإضافة أخرى.',
    clearSearch: 'مسح البحث',

    primaryLegend: 'خدمتك الأساسية',
    primaryHint: 'التي تريد أن تُعرف بها. نستخدمها لاقتراح المسمّى المهني.',
    primaryBadge: 'الأساسية',
    makePrimary: 'اجعلها خدمتي الأساسية',
    primaryRequired: 'اختر أي هذه الخدمات هي خدمتك الأساسية.',

    stateHeading: {
      APPROVED: 'معتمدة',
      PENDING: 'قيد المراجعة لدينا',
      REJECTED: 'غير معتمدة',
      INACTIVE: 'لم تعد متاحة',
    },
    stateExplain: {
      APPROVED: 'يمكن ربطك بالعملاء في هذه الخدمات.',
      PENDING: 'نقوم بمراجعتها الآن. لا حاجة إلى أي إجراء منك، ويمكنك متابعة بقية طلبك.',
      REJECTED: 'لم نتمكن من اعتمادها. يمكنك اختيار غيرها، أو التواصل مع الدعم لمعرفة السبب.',
      INACTIVE: 'لم نعد نقدّم هذه الخدمات. لا علاقة لك بذلك — اختر غيرها بدلاً منها.',
    },
    remove: 'إزالة',

    experienceLegend: 'الخبرة',
    startYearLabel: 'سنة بدايتك في هذه المهنة',
    startYearHint: 'نحسب سنوات خبرتك منها، لتبقى دقيقة دائماً.',
    startYearInvalid: 'أدخل سنة بين 1950 والسنة الحالية.',
    yearsDerived: (years) => (years === 1 ? 'سنة خبرة واحدة' : `${years} سنوات خبرة`),

    equipmentLegend: 'المعدات التي تملكها',
    equipmentHint: 'اختياري. يساعدنا على ربطك بالطلبات المناسبة.',
    equipmentEmpty: 'لا توجد معدات مسجّلة لخدماتك بعد.',

    transportLegend: 'كيف تصل إلى العمل',
    transportHint: 'اختر كل ما يمكنك استخدامه.',
    transportPrimary: 'غالباً',
    transportPrimaryHint: 'أيها تستخدم أكثر؟',

    titleLegend: 'مسمّاك المهني',
    titleHint: 'هذا ما يراه العملاء بجانب اسمك.',
    titleSuggested: (value) => `بناءً على خدمتك الأساسية، نقترح «${value}».`,
    titleUse: 'استخدام هذا المسمّى',
    titleEdit: 'أكتب مسمّاي بنفسي',
    titleNotPublished: 'لم يُنشر شيء بعد. ستؤكّد مسمّاك في خطوة الملف الشخصي.',
    titleRefusal: {
      TOO_SHORT: 'هذا أقصر من أن يكون مسمّى مهنياً.',
      TOO_LONG: 'هذا طويل جداً. اجعله قصيراً بما يكفي ليُقرأ بسرعة.',
      CONTAINS_URL: 'لا يمكن أن يحتوي المسمّى المهني على عنوان موقع.',
      CONTAINS_CONTACT: 'لا يمكن أن يحتوي المسمّى المهني على رقم هاتف أو بريد إلكتروني.',
      PROHIBITED_CLAIM: 'لا يمكننا عرض ادعاءات كهذه لأننا لا نستطيع التحقق منها.',
      UNSUPPORTED_CREDENTIAL:
        'نعرض فقط الشهادات التي تحققنا منها. أضف مستنداتك وسنعرضها بالشكل الصحيح.',
    },
  },
};

/** The visual weight a state should carry.
 *
 *  PENDING is deliberately NEUTRAL, not a warning colour: it is not a problem,
 *  and painting it amber next to real validation errors is how "we have not
 *  looked yet" starts reading as "you did something wrong". */
export const STATE_TONE: Record<ProviderSpecialtyState, 'positive' | 'neutral' | 'negative'> = {
  APPROVED: 'positive',
  PENDING: 'neutral',
  REJECTED: 'negative',
  INACTIVE: 'neutral',
};
