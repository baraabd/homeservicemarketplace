import type { ReviewLanguage } from './copy';

export function formatReviewDate(
  value: string | null | undefined,
  lang: ReviewLanguage,
  fallback: string,
  dateOnly = false,
): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? fallback
    : new Intl.DateTimeFormat(lang, {
        dateStyle: 'medium',
        ...(dateOnly ? {} : { timeStyle: 'short' }),
      }).format(date);
}
