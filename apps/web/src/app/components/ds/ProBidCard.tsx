import { ReactNode } from 'react';

// ─── Rating Stars ─────────────────────────────────────────────────────────────
function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill={s <= Math.round(rating) ? '#F59E0B' : 'none'}
          stroke={s <= Math.round(rating) ? '#F59E0B' : '#CBD5E1'}
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ProBidCardProps {
  name: string;
  initials: string;
  avatarBg?: string; // Tailwind bg class
  avatarColor?: string; // Tailwind text class
  avatarUrl?: string;
  rating: number;
  reviewCount: number;
  jobCount: number;
  price: number;
  unit?: string; // "/hr", "/job", etc.
  tags?: string[];
  verified?: boolean;
  topPro?: boolean;
  responseTime?: string;
  onBook?: () => void;
  onMessage?: () => void;
  trailingSlot?: ReactNode; // for extensibility
  showPrice?: boolean; // admin-controlled visibility
}

export function ProBidCard({
  name,
  initials,
  avatarBg = 'bg-amber-100',
  avatarColor = 'text-amber-700',
  avatarUrl,
  rating,
  reviewCount,
  jobCount,
  price,
  unit = '/hr',
  tags = [],
  verified = false,
  topPro = false,
  responseTime,
  onBook,
  onMessage,
  showPrice = true,
}: ProBidCardProps) {
  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Top accent — TopPro badge */}
      {topPro && <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-400" />}

      <div className="p-4 flex flex-col gap-4">
        {/* ── Header row ── */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div
              className={[
                'w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden',
                !avatarUrl ? avatarBg : '',
              ].join(' ')}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
              ) : (
                <span className={avatarColor} style={{ fontSize: '16px', fontWeight: 800 }}>
                  {initials}
                </span>
              )}
            </div>
            {/* Verified badge */}
            {verified && (
              <div className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center">
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
          </div>

          {/* Name + rating */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-slate-900 truncate" style={{ fontSize: '15px', fontWeight: 700 }}>
                {name}
              </h3>
              {topPro && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white flex-shrink-0"
                  style={{ fontSize: '9px', fontWeight: 700 }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="white" stroke="none">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  TOP PRO
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <RatingStars rating={rating} />
              <span className="text-slate-500" style={{ fontSize: '11px' }}>
                {rating.toFixed(1)} ({reviewCount})
              </span>
            </div>
            <p className="text-slate-400 mt-0.5" style={{ fontSize: '11px' }}>
              {jobCount} jobs completed
            </p>
          </div>

          {/* Price — hidden when admin disables hourly rate */}
          {showPrice && (
            <div className="flex-shrink-0 text-end">
              <p
                className="text-slate-900"
                style={{ fontSize: '20px', fontWeight: 800, lineHeight: '1.1' }}
              >
                ${price}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {unit}
              </p>
            </div>
          )}
        </div>

        {/* ── Tags ── */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600"
                style={{ fontSize: '11px', fontWeight: 500 }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* ── Response time ── */}
        {responseTime && (
          <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <p className="text-green-700" style={{ fontSize: '12px', fontWeight: 500 }}>
              Typically responds {responseTime}
            </p>
          </div>
        )}

        {/* ── Action row ── */}
        <div className="flex gap-3">
          {/* Message */}
          {onMessage && (
            <button
              onClick={onMessage}
              className="flex items-center justify-center gap-2 flex-1 h-11 rounded-2xl border-2 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:scale-95 transition-all"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Message
            </button>
          )}
          {/* Book */}
          <button
            onClick={onBook}
            className="flex items-center justify-center gap-2 flex-[2] h-11 rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-200 hover:bg-amber-600 active:scale-95 transition-all"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Book Now
          </button>
        </div>
      </div>
    </div>
  );
}
