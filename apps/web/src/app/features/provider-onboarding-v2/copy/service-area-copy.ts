// Sprint 9B.19 — every string V2 Task 3 renders.
//
// Two things this copy must get right, because they are acceptance criteria
// rather than polish:
//
//   PRIVACY. The provider is being asked where they are based, which is often
//   their home. They will only answer honestly if they know what is published,
//   so the screen says it plainly and in the same breath as the question —
//   not in a policy nobody opens.
//
//   NO PROMISES. A larger radius is not more work. Saying "reach more
//   customers" would be a volume guarantee the marketplace cannot keep, and
//   the provider who travels further on that promise pays for the fuel.

export type Lang = 'en' | 'ar';

export interface ServiceAreaCopy {
  heading: string;
  intro: string;

  // Base
  baseLegend: string;
  baseHint: string;
  cityLabel: string;
  cityPlaceholder: string;
  cityRequired: string;
  countryLabel: string;
  countryPlaceholder: string;

  // Device location
  useMyLocation: string;
  locating: string;
  locationHelp: string;
  permissionDenied: string;
  permissionUnavailable: string;
  enterManually: string;
  clearLocation: string;

  // Privacy
  privacyTitle: string;
  privacyBody: string;
  privacyPublic: string;

  // Radius
  radiusLegend: string;
  radiusValue: (km: number) => string;
  radiusBasedOn: (mode: string) => string;
  radiusNoBasis: string;
  radiusBounds: (min: number, max: number) => string;
  radiusReduceHint: string;

  // Timezone
  timezoneResolved: (city: string, offset: string) => string;
  timezoneNeedsConfirmation: string;

  // Area preview
  previewTitle: string;
  previewApprox: (km: number) => string;
  previewNoLocation: string;

  transportNames: Record<string, string>;
}

export const SERVICE_AREA_COPY: Record<Lang, ServiceAreaCopy> = {
  en: {
    heading: 'Where you work',
    intro: 'Tell us where you are based and how far you are willing to travel.',

    baseLegend: 'Your operating base',
    baseHint: 'The place you usually set off from. We ask once — you do not need to repeat it.',
    cityLabel: 'City',
    cityPlaceholder: 'e.g. Damascus',
    cityRequired: 'Enter the city you work from.',
    countryLabel: 'Country',
    countryPlaceholder: 'Choose a country',

    useMyLocation: 'Use my current location',
    locating: 'Finding your location…',
    locationHelp:
      'Optional. It only makes the map more accurate for you — you can type everything instead.',
    permissionDenied:
      'Your device did not share a location. That is fine — fill in the city and country below and carry on.',
    permissionUnavailable:
      'We could not get a location from this device. Fill in the city and country below instead.',
    enterManually: 'Enter it manually',
    clearLocation: 'Remove the pinned location',

    privacyTitle: 'Your exact location stays private',
    privacyBody:
      'We never show your address or your exact position to anyone. Customers see an approximate area only.',
    privacyPublic:
      'Publicly visible: your city and a rough area. Never your street or a pin on your home.',

    radiusLegend: 'How far you travel',
    radiusValue: (km) => (km === 1 ? 'Up to 1 km' : `Up to ${km} km`),
    radiusBasedOn: (mode) => `Suggested because you travel by ${mode}.`,
    radiusNoBasis: 'A starting suggestion. Tell us how you travel and we will refine it.',
    radiusBounds: (min, max) => `Between ${min} and ${max} km.`,
    // Deliberately not "reach more customers": that is a volume promise, and
    // the provider who drives further on it pays for the fuel.
    radiusReduceHint: 'Choose what you are actually willing to travel. You can change it any time.',

    timezoneResolved: (city, offset) => `Times will be shown in ${city} time (${offset}).`,
    timezoneNeedsConfirmation: 'We will confirm your time zone when you set your working hours.',

    previewTitle: 'What customers see',
    previewApprox: (km) => `An approximate area about ${km} km across.`,
    previewNoLocation: 'Add a city to see the area customers will see.',

    transportNames: {
      ON_FOOT: 'foot',
      MOTORCYCLE: 'motorcycle',
      CAR: 'car',
      VAN: 'van',
      TRUCK: 'truck',
      PUBLIC_TRANSPORT: 'public transport',
    },
  },
  ar: {
    heading: 'أين تعمل',
    intro: 'أخبرنا أين مقرّك وإلى أي مدى أنت مستعد للتنقّل.',

    baseLegend: 'مقرّ عملك',
    baseHint: 'المكان الذي تنطلق منه عادة. نسأل مرة واحدة فقط — لا حاجة لتكراره.',
    cityLabel: 'المدينة',
    cityPlaceholder: 'مثال: دمشق',
    cityRequired: 'أدخل المدينة التي تعمل منها.',
    countryLabel: 'الدولة',
    countryPlaceholder: 'اختر الدولة',

    useMyLocation: 'استخدام موقعي الحالي',
    locating: 'جارٍ تحديد موقعك…',
    locationHelp: 'اختياري. يجعل الخريطة أدق لك فقط — يمكنك إدخال كل شيء يدوياً.',
    permissionDenied: 'لم يشارك جهازك الموقع. لا مشكلة — أدخل المدينة والدولة أدناه وتابع.',
    permissionUnavailable:
      'تعذّر الحصول على موقع من هذا الجهاز. أدخل المدينة والدولة أدناه بدلاً من ذلك.',
    enterManually: 'إدخال يدوي',
    clearLocation: 'إزالة الموقع المحدد',

    privacyTitle: 'موقعك الدقيق يبقى خاصاً',
    privacyBody: 'لا نعرض عنوانك أو موقعك الدقيق لأي أحد. يرى العملاء منطقة تقريبية فقط.',
    privacyPublic: 'الظاهر للعموم: مدينتك ومنطقة تقريبية. لا شارعك ولا علامة على منزلك.',

    radiusLegend: 'إلى أي مدى تتنقّل',
    radiusValue: (km) => (km === 1 ? 'حتى 1 كم' : `حتى ${km} كم`),
    radiusBasedOn: (mode) => `اقتراح لأنك تتنقّل بـ${mode}.`,
    radiusNoBasis: 'اقتراح مبدئي. أخبرنا كيف تتنقّل وسنحسّنه.',
    radiusBounds: (min, max) => `بين ${min} و${max} كم.`,
    radiusReduceHint: 'اختر ما أنت مستعد فعلاً للتنقّل إليه. يمكنك تغييره في أي وقت.',

    timezoneResolved: (city, offset) => `ستُعرض الأوقات بتوقيت ${city} (${offset}).`,
    timezoneNeedsConfirmation: 'سنؤكّد منطقتك الزمنية عند تحديد ساعات عملك.',

    previewTitle: 'ما يراه العملاء',
    previewApprox: (km) => `منطقة تقريبية بعرض ${km} كم تقريباً.`,
    previewNoLocation: 'أضف مدينة لرؤية المنطقة التي سيراها العملاء.',

    transportNames: {
      ON_FOOT: 'المشي',
      MOTORCYCLE: 'دراجة نارية',
      CAR: 'سيارة',
      VAN: 'فان',
      TRUCK: 'شاحنة',
      PUBLIC_TRANSPORT: 'المواصلات العامة',
    },
  },
};
