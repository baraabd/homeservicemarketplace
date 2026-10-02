// R11 — a provider's rating, as the server derived it from real reviews.
//
// A provider nobody has reviewed has no rating. Showing "0.0" with five empty
// stars says they were rated badly, which is false; this says what is true.

interface ProviderRatingProps {
  ratingAvg: number | null | undefined;
  reviewCount: number | null | undefined;
  lang: 'en' | 'ar';
  className?: string;
}

/** True when there is at least one counted review to show a rating for. */
function hasRating(reviewCount: number | null | undefined): boolean {
  return typeof reviewCount === 'number' && reviewCount > 0;
}

export function ProviderRating({ ratingAvg, reviewCount, lang, className }: ProviderRatingProps) {
  if (!hasRating(reviewCount)) {
    return (
      <p
        className={`text-slate-500 ${className ?? ''}`}
        style={{ fontSize: '11px' }}
        data-testid="provider-rating-none"
      >
        {lang === 'ar' ? 'لا توجد تقييمات بعد' : 'No reviews yet'}
      </p>
    );
  }
  const rating = ratingAvg ?? 0;
  const count = reviewCount as number;
  const shown = rating.toFixed(1);
  const label =
    lang === 'ar'
      ? `التقييم ${shown} من 5، ${count} تقييم`
      : `Rated ${shown} out of 5, ${count} ${count === 1 ? 'review' : 'reviews'}`;
  return (
    <div
      className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}
      role="img"
      aria-label={label}
      data-testid="provider-rating"
      data-review-count={count}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((s) => (
          <svg
            key={s}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill={s <= Math.round(rating) ? '#F59E0B' : 'none'}
            stroke={s <= Math.round(rating) ? '#F59E0B' : '#CBD5E1'}
            strokeWidth="1.5"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ))}
      </span>
      <span className="text-slate-500" style={{ fontSize: '11px' }} aria-hidden="true">
        {shown} · {count} {lang === 'ar' ? 'تقييم' : count === 1 ? 'review' : 'reviews'}
      </span>
    </div>
  );
}
