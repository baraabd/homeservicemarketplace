import { minorToDecimal } from '@homeservicemarketplace/contracts';

// K02 (hsm.amount-unit.v1) — the one web formatter for bid and booking
// amounts, used by every role's screen.
//
// • amountScale non-null: the integer is minor units. It is turned into an
//   exact decimal STRING (10025 at scale 2 → "100.25") and handed to Intl as
//   a string, so no binary float ever stands between the stored integer and
//   the text. Each amount is formatted in its OWN currency.
// • amountScale null: a pre-K02 amount whose unit nobody can prove. It is
//   printed as stored, with an explicit "unverified" label — never divided,
//   multiplied or given a currency symbol it may not deserve.
//
// Locales carry an explicit region: a bare "ar" resolves differently in
// Node and in Chromium (see env_icu_ar_locale_split).

export type MoneyLang = 'en' | 'ar';

export const MONEY_LOCALE: Record<MoneyLang, string> = { en: 'en-SA', ar: 'ar-SA' };

const LEGACY_LABEL: Record<MoneyLang, string> = {
  en: 'unverified legacy amount',
  ar: 'مبلغ قديم بوحدة غير مؤكدة',
};

export function formatAmount(
  amount: number,
  currency: string,
  amountScale: number | null | undefined,
  lang: MoneyLang,
): string {
  const locale = MONEY_LOCALE[lang];
  // A missing scale (an older API payload) is treated exactly like null:
  // the unit is unproven, so nothing is divided and the label says so.
  if (amountScale === null || amountScale === undefined) {
    const raw = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    return `${raw} ${currency} · ${LEGACY_LABEL[lang]}`;
  }
  const decimal = minorToDecimal(amount, amountScale);
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: amountScale,
    maximumFractionDigits: amountScale,
  }).format as unknown as (value: string) => string;
  return format(decimal);
}

export function isLegacyAmount(amountScale: number | null | undefined): boolean {
  return amountScale === null || amountScale === undefined;
}
