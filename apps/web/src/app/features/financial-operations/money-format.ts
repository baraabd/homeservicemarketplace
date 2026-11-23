import type { MoneyWire } from '@homeservicemarketplace/contracts';

export type FinancialLanguage = 'en' | 'ar';

/**
 * R18 D-2 has no approved currency scale. Render the stored integer explicitly;
 * Intl may localize digits/grouping, but never chooses a scale or converts money.
 * Neither a decimal string nor a bigint passes through Number.
 */
export function formatMoneyMinor(money: MoneyWire | null, lang: FinancialLanguage): string {
  if (
    !money ||
    typeof money.amountMinor !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/u.test(money.amountMinor) ||
    (money.amountMinor.length === 19 && money.amountMinor > '9223372036854775807') ||
    !/^[A-Z]{3}$/u.test(money.currency)
  ) {
    return lang === 'ar' ? 'المبلغ غير متاح' : 'Amount unavailable';
  }
  const integer = new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-arab' : 'en', {
    maximumFractionDigits: 0,
  }).format(BigInt(money.amountMinor));
  return integer + ' ' + money.currency + (lang === 'ar' ? ' · وحدة صغرى' : ' · minor units');
}

export function formatFinancialDate(value: string | null, lang: FinancialLanguage): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-arab' : 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date) + ' UTC';
}
