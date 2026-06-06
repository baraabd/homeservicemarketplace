import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  Star,
  Zap,
  CheckCircle2,
  Filter,
  Loader2,
} from 'lucide-react';
import type { BidBadge, BidSortKey, BidSummary } from '@homeservicemarketplace/contracts';
import { ProBidCard } from '../ds/ProBidCard';
import { LeadCardProps } from './LeadCard';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang } from '../../i18n/LanguageContext';
import { useEcosystem } from '../../context/EcosystemContext';
import { useAcceptBid, useBids } from '../../hooks/seeker/useBids';
import { formatPrivacyDisplayName } from '../../../lib/privacy-name';

// ─── Badge config ─────────────────────────────────────────────────────────────
// Keyed on the contract enum value so the API → UI mapping is direct.
// Visuals (colours, copy) are unchanged from the slice 1 mock to keep
// the UI design exactly the same.
const BADGE_CONFIG_EN: Record<BidBadge, { label: string; bg: string; text: string }> = {
  BEST_MATCH: { label: '⭐ Best Match', bg: 'bg-amber-500', text: 'text-white' },
  BEST_VALUE: { label: '💰 Best Value', bg: 'bg-green-500', text: 'text-white' },
  FASTEST: { label: '⚡ Fastest', bg: 'bg-blue-500', text: 'text-white' },
};
const BADGE_CONFIG_AR: Record<BidBadge, { label: string; bg: string; text: string }> = {
  BEST_MATCH: { label: '⭐ الأنسب', bg: 'bg-amber-500', text: 'text-white' },
  BEST_VALUE: { label: '💰 الأوفر', bg: 'bg-green-500', text: 'text-white' },
  FASTEST: { label: '⚡ الأسرع', bg: 'bg-blue-500', text: 'text-white' },
};

// Stable avatar palette keyed on the provider id. Keeps the visual
// identity unchanged from the mock SEED_BIDS while never relying on
// the backend to ship Tailwind colour classes.
const AVATAR_PALETTE: { bg: string; color: string }[] = [
  { bg: 'bg-amber-100', color: 'text-amber-700' },
  { bg: 'bg-blue-100', color: 'text-blue-700' },
  { bg: 'bg-green-100', color: 'text-green-700' },
  { bg: 'bg-purple-100', color: 'text-purple-700' },
  { bg: 'bg-slate-100', color: 'text-slate-700' },
  { bg: 'bg-red-100', color: 'text-red-700' },
];
function avatarFor(providerId: string): { bg: string; color: string } {
  let h = 0;
  for (let i = 0; i < providerId.length; i++) h = (h * 31 + providerId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// "within 5 min" / "within 20 min" — converts the API's optional
// responseTimeMinutes into the existing UI string the ProBidCard
// already renders. Returns undefined when no value is supplied so
// the ProBidCard hides the strip cleanly.
function responseTimeText(
  minutes: number | null | undefined,
  lang: 'en' | 'ar',
): string | undefined {
  if (typeof minutes !== 'number' || minutes <= 0) return undefined;
  return lang === 'ar' ? `خلال ${minutes} د` : `within ${minutes} min`;
}

// ─── Price Range Chart ────────────────────────────────────────────────────────
// Takes API bids; visual identical to the slice-1 mock.
function PriceChart({ bids, selectedId }: { bids: BidSummary[]; selectedId: string | null }) {
  const { t } = useLang();
  if (bids.length === 0) return null;
  const prices = bids.map((b) => b.amount);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const range = max - min || 1;

  return (
    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-600" style={{ fontSize: '12px', fontWeight: 600 }}>
          {t('priceComparison')}
        </span>
        <span className="text-slate-400" style={{ fontSize: '11px' }}>
          Avg: <strong className="text-slate-700">${avg}/hr</strong>
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-6 mb-1">
        <div className="absolute inset-y-0 start-0 end-0 flex items-center">
          <div className="w-full h-1.5 bg-slate-200 rounded-full" />
        </div>
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
          style={{ left: `${((avg - min) / range) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="w-px h-6 bg-amber-400 opacity-60" />
        </div>
        {bids.map((bid) => {
          const pct = ((bid.amount - min) / range) * 100;
          const isSelected = bid.id === selectedId;
          return (
            <div
              key={bid.id}
              className="absolute top-1/2 -translate-y-1/2"
              style={{ left: `${pct}%`, transform: `translate(-50%, -50%)` }}
            >
              <div
                className={`rounded-full border-2 transition-all duration-200 ${
                  isSelected
                    ? 'w-4 h-4 bg-amber-500 border-amber-500 shadow-md shadow-amber-200'
                    : 'w-3 h-3 bg-white border-slate-400'
                }`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2">
        <span className="text-green-600" style={{ fontSize: '11px', fontWeight: 700 }}>
          ${min} low
        </span>
        <span className="text-slate-400" style={{ fontSize: '10px' }}>
          avg ${avg}
        </span>
        <span className="text-red-400" style={{ fontSize: '11px', fontWeight: 700 }}>
          ${max} high
        </span>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface BidsScreenProps {
  lead: LeadCardProps;
  onBack: () => void;
  // Fires AFTER the backend confirms the acceptance + the in-screen
  // success overlay completes. The parent uses the bidder name for
  // the snackbar copy and the bookingId to wire the "View booking"
  // CTA on the snackbar action (Sprint 7.5 — post-acceptance UX).
  // bookingId is always present because the backend response carries
  // it on a successful accept; we type it as required so the parent
  // is forced to handle the navigation case.
  onBookBid: (bidderName: string, bookingId: string) => void;
}

// ═════════════════════════════════════════════════════════════════════════════
export function BidsScreen({ lead, onBack, onBookBid }: BidsScreenProps) {
  const { t, lang, dir } = useLang();
  const { showHourlyRate } = useEcosystem();
  const [sortKey, setSortKey] = useState<BidSortKey>('recommended');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Real bids feed for THIS request. Empty array on first load / 401
  // / network error — every render path below treats `bids` as
  // possibly empty so the existing empty / loading / error UI is
  // safe by construction.
  const bidsQuery = useBids(lead.id, sortKey);
  const bids: BidSummary[] = useMemo(() => bidsQuery.data?.items ?? [], [bidsQuery.data]);
  const acceptMut = useAcceptBid(lead.id);

  const isInitialLoading = bidsQuery.isLoading && !bidsQuery.data;
  const isError = bidsQuery.isError && !bidsQuery.data;

  const BADGE_CONFIG = lang === 'ar' ? BADGE_CONFIG_AR : BADGE_CONFIG_EN;

  // Sprint 7.13 — privacy-safe provider name (initial + family name)
  // for the seeker-facing bid surfaces.
  const providerNamePrivacy = (displayName: string): string =>
    formatPrivacyDisplayName(
      { displayName },
      { roleFallback: lang === 'ar' ? 'مزود الخدمة' : 'Provider' },
    );

  // ── Swipe right (LTR) or left (RTL) → back ───────────────────────────────
  const { onTouchStart, onTouchMove, onTouchEnd, dragX } = useSwipe({
    onSwipeRight: dir === 'ltr' ? onBack : undefined,
    onSwipeLeft: dir === 'rtl' ? onBack : undefined,
    threshold: 70,
    edgeStartOnly: true,
    edgeWidth: 55,
  });

  // The server returns bids already ordered for the requested sort
  // (recommended / price / rating / submittedAt). We do not re-sort
  // client-side — that would diverge from the documented contract
  // and from the price chart's interpretation.

  // Slice-2.2 wires Book → real backend accept. The green "Booking
  // confirmed!" overlay is preserved exactly, but it now appears ONLY
  // after the backend returns 200 — never via a fake setTimeout. The
  // parent snackbar continues to fire for visual continuity. On
  // failure we surface a safe friendly message; the raw backend
  // payload is never rendered. 409 (already-accepted / cancelled
  // request) gets a distinct, actionable copy so the user understands
  // why the action was rejected.
  const handleBook = (bid: BidSummary) => {
    if (acceptMut.isPending) return;
    setAcceptError(null);
    acceptMut.mutate(bid.id, {
      onSuccess: (response) => {
        setAcceptedId(bid.id);
        // Brief overlay so the visual confirmation stays on-screen
        // long enough to be perceived; the parent's snackbar then
        // takes over and the BidsScreen typically closes. The new
        // booking id is threaded back so the parent can offer a
        // "View booking" action on the snackbar (Sprint 7.5).
        setTimeout(() => {
          setAcceptedId(null);
          onBookBid(providerNamePrivacy(bid.provider?.displayName ?? ''), response.booking.id);
        }, 900);
      },
      onError: (err) => {
        const status =
          (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
        if (status === 409) {
          setAcceptError(
            lang === 'ar'
              ? 'لم يعد بالإمكان قبول هذا العرض. حدّث الصفحة وحاول مرة أخرى.'
              : 'This bid can no longer be accepted. Refresh and try again.',
          );
        } else if (status === 404) {
          setAcceptError(
            lang === 'ar'
              ? 'لم يتم العثور على هذا الطلب أو العرض.'
              : 'This request or bid was not found.',
          );
        } else {
          setAcceptError(
            lang === 'ar'
              ? 'تعذر تأكيد الحجز. حاول مرة أخرى.'
              : "We couldn't confirm the booking. Please try again.",
          );
        }
      },
    });
  };

  return (
    <div
      className="absolute inset-0 bg-slate-50 flex flex-col z-20"
      style={{
        transform: `translateX(${dir === 'ltr' ? Math.max(dragX, 0) : Math.min(dragX, 0)}px)`,
        transition: dragX !== 0 ? 'none' : 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* ── Sticky Header ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
          >
            {dir === 'rtl' ? (
              <ChevronRight size={20} className="text-slate-700" />
            ) : (
              <ChevronLeft size={20} className="text-slate-700" />
            )}
          </button>
          <div className="flex-1">
            <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
              {bids.length} {t('bids')} · {lead.service}
            </p>
            <p className="text-slate-400" style={{ fontSize: '11px' }}>
              {t('postedAt')} {lead.postedAt}
            </p>
          </div>
          <button className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all">
            <Filter size={16} className="text-slate-600" />
          </button>
        </div>

        {/* Sort tabs */}
        <div className="flex px-4 gap-2 pb-3">
          {[
            { id: 'recommended' as const, labelKey: 'bestMatch', icon: <Star size={11} /> },
            { id: 'price' as const, labelKey: 'bestValue', icon: <TrendingDown size={11} /> },
            { id: 'rating' as const, labelKey: 'fastest', icon: <Zap size={11} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSortKey(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all active:scale-95 ${
                sortKey === tab.id
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        {isInitialLoading ? (
          /* Loading state — neutral skeleton-style spinner; existing colour idiom. */
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={28} className="text-slate-400 animate-spin" />
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {lang === 'ar' ? 'جاري تحميل العروض...' : 'Loading bids...'}
            </p>
          </div>
        ) : isError ? (
          /* Error state — safe friendly copy, no raw backend message. */
          <div className="flex flex-col items-center justify-center py-20 gap-3" role="alert">
            <p className="text-slate-700 text-center" style={{ fontSize: '14px', fontWeight: 600 }}>
              {lang === 'ar'
                ? 'تعذر تحميل العروض. حاول مرة أخرى.'
                : "We couldn't load bids. Please try again."}
            </p>
            <button
              onClick={() => bidsQuery.refetch()}
              className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : bids.length === 0 ? (
          /* Empty state — neutral neutral copy; uses existing slate idiom. */
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-slate-700 text-center" style={{ fontSize: '14px', fontWeight: 700 }}>
              {lang === 'ar' ? 'لا توجد عروض بعد' : 'No bids yet'}
            </p>
            <p className="text-slate-400 text-center" style={{ fontSize: '12px' }}>
              {lang === 'ar'
                ? 'سيظهر مقدمو الخدمة هنا فور تقديم عروضهم.'
                : 'Providers will appear here as they submit bids.'}
            </p>
          </div>
        ) : (
          <>
            {showHourlyRate && <PriceChart bids={bids} selectedId={hoveredId} />}

            {acceptError && (
              <div
                className="mt-3 px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
                style={{ fontSize: '13px', fontWeight: 600 }}
                role="alert"
              >
                {acceptError}
              </div>
            )}

            {/* Bid cards */}
            <div className="flex flex-col gap-4 mt-3">
              {bids.map((bid) => {
                const badgeCfg = bid.badge ? BADGE_CONFIG[bid.badge] : null;
                const isAccepted = acceptedId === bid.id;
                const av = avatarFor(bid.provider.id);
                const respText = responseTimeText(
                  bid.responseTimeMinutes,
                  lang === 'ar' ? 'ar' : 'en',
                );

                return (
                  <div
                    key={bid.id}
                    className="relative"
                    onMouseEnter={() => setHoveredId(bid.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {badgeCfg && (
                      <div className="absolute -top-3 start-4 z-10 flex items-center gap-1">
                        <div
                          className={`${badgeCfg.bg} ${badgeCfg.text} px-3 py-1 rounded-full shadow-sm`}
                          style={{ fontSize: '10px', fontWeight: 800 }}
                        >
                          {badgeCfg.label}
                        </div>
                      </div>
                    )}

                    {isAccepted && (
                      <div className="absolute inset-0 z-20 rounded-3xl bg-green-500/90 flex items-center justify-center gap-3">
                        <CheckCircle2 size={32} className="text-white" />
                        <p className="text-white" style={{ fontSize: '16px', fontWeight: 800 }}>
                          {lang === 'ar' ? 'تم تأكيد الحجز!' : 'Booking confirmed!'}
                        </p>
                      </div>
                    )}

                    <div
                      className={`transition-all duration-300 ${badgeCfg ? 'mt-3' : ''} ${isAccepted ? 'scale-95 opacity-60' : ''}`}
                    >
                      <ProBidCard
                        name={providerNamePrivacy(bid.provider?.displayName ?? '')}
                        initials={bid.provider?.initials ?? ''}
                        avatarBg={av.bg}
                        avatarColor={av.color}
                        avatarUrl={bid.provider.avatarUrl ?? undefined}
                        rating={bid.provider.ratingAvg}
                        reviewCount={bid.provider.reviewCount}
                        jobCount={bid.provider.completedJobs}
                        price={bid.amount}
                        unit={bid.pricingType === 'HOURLY' ? '/hr' : '/job'}
                        tags={[]}
                        verified={bid.provider.verified}
                        topPro={bid.provider.topPro}
                        responseTime={respText}
                        showPrice={showHourlyRate}
                        onBook={() => handleBook(bid)}
                        onMessage={() => {}}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Comparison table */}
            <div className="mt-6 bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <p className="text-slate-700 mb-3" style={{ fontSize: '13px', fontWeight: 700 }}>
                {lang === 'ar' ? 'مقارنة سريعة' : 'Quick Comparison'}
              </p>
              <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                <table className="w-full" style={{ fontSize: '11px' }}>
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-start py-2 pe-3 font-semibold">{t('pro')}</th>
                      <th className="text-center py-2 px-2 font-semibold">
                        {lang === 'ar' ? 'التقييم' : 'Rating'}
                      </th>
                      {showHourlyRate && (
                        <th className="text-center py-2 px-2 font-semibold">
                          {lang === 'ar' ? 'السعر' : 'Price'}
                        </th>
                      )}
                      <th className="text-center py-2 px-2 font-semibold">
                        {lang === 'ar' ? 'الردّ' : 'Response'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bids.slice(0, 4).map((bid) => {
                      const av = avatarFor(bid.provider.id);
                      const respText = responseTimeText(
                        bid.responseTimeMinutes,
                        lang === 'ar' ? 'ar' : 'en',
                      );
                      return (
                        <tr key={bid.id} className="border-t border-slate-50">
                          <td className="py-2 pe-3">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-6 h-6 rounded-lg flex items-center justify-center ${av.bg}`}
                              >
                                <span
                                  className={av.color}
                                  style={{ fontSize: '8px', fontWeight: 800 }}
                                >
                                  {bid.provider?.initials ?? ''}
                                </span>
                              </div>
                              <span
                                className="text-slate-700 font-semibold truncate"
                                style={{ maxWidth: '70px' }}
                              >
                                {providerNamePrivacy(bid.provider?.displayName ?? '')}
                              </span>
                            </div>
                          </td>
                          <td className="text-center py-2 px-2">
                            <span className="text-amber-600 font-bold">
                              {bid.provider.ratingAvg.toFixed(1)}
                            </span>
                          </td>
                          {showHourlyRate && (
                            <td className="text-center py-2 px-2">
                              <span className="text-slate-900 font-bold">${bid.amount}</span>
                            </td>
                          )}
                          <td className="text-center py-2 px-2 text-slate-500">
                            {respText ? respText.replace('within ', '').replace('خلال ', '') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}
