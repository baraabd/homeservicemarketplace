export type Lang = 'en' | 'ar';

// Sprint 09B.29 Phase 5B — the market substates of the approved work area.
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md G-01
// docs/provider-experience-v2/PHASE5_DEVIATION_REGISTER.md D5-01
//
// COUNTRY NAMES ARE NOT TRANSLATED HERE, AND THAT IS DELIBERATE
//
// The server sends a `displayNameKey` per market rather than a name, precisely
// so the client owns the wording. But a hard-coded table here would go stale
// the moment an operator opens a market this bundle has never heard of, and a
// provider would be offered a blank row or a raw key.
//
// So the key is resolved through `Intl.DisplayNames`, which knows every ISO
// country in both languages and is already in every browser this app supports.
// A market the platform opens tomorrow is named correctly by a bundle shipped
// today. The key is the fallback when Intl has no answer, which is visible and
// debuggable rather than blank.

export interface MarketCopy {
  /** The heading over the picker, when no market is recorded yet. */
  chooseTitle: string;
  chooseBody: string;
  chooseLabel: string;
  /** The placeholder option: never pre-select a country for someone. */
  choosePlaceholder: string;

  /** The operator has closed the market this provider is in. */
  withdrawnTitle: string;
  withdrawnBody: (country: string) => string;

  /** The country decides how far they may travel, so the picker says so. */
  radiusNote: (minKm: number, maxKm: number) => string;

  /** An ambiguous timezone has to be confirmed before hours mean anything. */
  timezoneTitle: string;
  timezoneBody: string;
  timezoneLabel: string;

  /** The registry could not be read. */
  unavailableTitle: string;
  unavailableBody: string;
  retry: string;

  /** Announced after a market is recorded. */
  saved: (country: string) => string;
}

const EN: MarketCopy = {
  chooseTitle: 'Which country do you work in?',
  chooseBody:
    'This decides which customers can find you and how far you are allowed to travel. You can only choose a country the platform has opened.',
  chooseLabel: 'Country',
  choosePlaceholder: 'Choose a country',

  withdrawnTitle: 'We no longer operate in your country',
  withdrawnBody: (country) =>
    `Your application still has ${country} saved. Choose one of the countries below to continue, or leave it as it is — nothing you have entered has been lost.`,

  radiusNote: (minKm, maxKm) => `Travel distance in this country: ${minKm}–${maxKm} km.`,

  timezoneTitle: 'Confirm your timezone',
  timezoneBody:
    'Your country spans more than one timezone, so we cannot work it out on your own behalf. Your working hours are stored in the zone you choose here.',
  timezoneLabel: 'Timezone',

  unavailableTitle: 'We could not load the list of countries',
  unavailableBody: 'Your answers are safe. Try again, or come back to this task later.',
  retry: 'Try again',

  saved: (country) => `Country set to ${country}.`,
};

const AR: MarketCopy = {
  chooseTitle: 'في أي دولة تعمل؟',
  chooseBody:
    'يحدد هذا العملاء الذين يمكنهم الوصول إليك والمسافة المسموح لك بقطعها. يمكنك اختيار الدول التي فتحتها المنصة فقط.',
  chooseLabel: 'الدولة',
  choosePlaceholder: 'اختر دولة',

  withdrawnTitle: 'لم نعد نعمل في دولتك',
  withdrawnBody: (country) =>
    `ما زالت ${country} محفوظة في طلبك. اختر إحدى الدول أدناه للمتابعة، أو اتركها كما هي — لم يُفقد أي مما أدخلته.`,

  radiusNote: (minKm, maxKm) => `مسافة التنقل في هذه الدولة: ${minKm}–${maxKm} كم.`,

  timezoneTitle: 'أكّد منطقتك الزمنية',
  timezoneBody:
    'تمتد دولتك على أكثر من منطقة زمنية، لذلك لا يمكننا تحديدها نيابة عنك. تُحفظ ساعات عملك حسب المنطقة التي تختارها هنا.',
  timezoneLabel: 'المنطقة الزمنية',

  unavailableTitle: 'تعذّر تحميل قائمة الدول',
  unavailableBody: 'إجاباتك محفوظة. حاول مرة أخرى أو عد إلى هذه المهمة لاحقاً.',
  retry: 'حاول مرة أخرى',

  saved: (country) => `تم تعيين الدولة إلى ${country}.`,
};

export const MARKET_COPY: Record<Lang, MarketCopy> = { en: EN, ar: AR };

/**
 * A country's name in the reader's language.
 *
 * `displayNameKey` from the server is an ISO 3166-1 alpha-2 code. `Intl` knows
 * them all, in both languages, and stays correct for markets opened after this
 * bundle shipped — which a hard-coded table cannot.
 *
 * Falls back to the key itself rather than to an empty string: a visible "SY"
 * is debuggable, a blank row is not.
 */
export function countryName(displayNameKey: string, lang: Lang): string {
  try {
    const names = new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], { type: 'region' });
    return names.of(displayNameKey.toUpperCase()) ?? displayNameKey;
  } catch {
    return displayNameKey;
  }
}
