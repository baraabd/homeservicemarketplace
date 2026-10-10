// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// The provider’s own bids, and the booking each accepted bid became.
//
// R17-E changed what this screen claims, not how it looks:
//   - a failed load is an error with a retry, not "No bids submitted yet";
//   - withdrawn bids are shown as withdrawn instead of silently disappearing;
//   - a pending bid can be withdrawn, after a confirmation, with the outcome
//     the server returned;
//   - the price is the stored amount, currency and pricing type — the old
//     "$120/hr" ignored a FIXED bid's type and asserted a currency symbol;
//   - Start / Complete / Cancel are the shared BookingActions, which confirm a
//     cancellation and report every failure, and each booking opens its own
//     detail page.
//
// E-18 — and it reaches every bid, not only the first page. The list reads
// the server's cursor pages (useMyBidPages) with the bookings list's "Load
// more" pattern; each accepted bid carries its own booking from the server,
// so a card on any page links to it (before, a booking beyond the first
// bookings page left its card saying "Waiting for booking…"). The status
// counts are counts of the bids loaded so far, marked "+" while more exist.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BookingStatus, MyBidSummary } from '@homeservicemarketplace/contracts';
import { motion, useReducedMotion } from 'motion/react';
import { Briefcase, ChevronRight, Loader2 } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import { flattenBidPages, useMyBidPages, useWithdrawBid } from '../../../hooks/provider/useMyBids';
import {
  formatRelativeTime,
  formatResponseTime,
  iconForCategorySlug,
} from '../../../../lib/provider/available-jobs-adapter';
import {
  ProviderButton,
  ProviderConfirmDialog,
  ProviderErrorState,
  ProviderNotice,
  ProviderSkeleton,
  ProviderStatusBadge,
} from '../../../features/provider-ui';
import { BookingActions } from '../bookings/BookingActions';
import { BookingMessageButton } from '../bookings/BookingMessageButton';
import {
  BOOKING_COPY,
  BOOKING_STATUS_TONE,
  classifyActionError,
  formatOffer,
} from '../bookings/booking-copy';

type BidView = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

/** Withdraw one pending bid: confirm, then report what the server said. */
function WithdrawBid({ bidId, lang }: { bidId: string; lang: 'en' | 'ar' }) {
  const { dir } = useLang();
  const copy = BOOKING_COPY[lang];
  const withdraw = useWithdrawBid();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<'done' | ReturnType<typeof classifyActionError> | null>(
    null,
  );
  const message =
    result === null
      ? null
      : result === 'done'
        ? copy.withdraw.done
        : result === 'CONFLICT'
          ? copy.withdraw.conflict
          : copy.errors[result];
  return (
    <div className="flex flex-col gap-1">
      <button
        ref={trigger}
        type="button"
        onClick={() => setConfirming(true)}
        disabled={withdraw.isPending}
        aria-busy={withdraw.isPending}
        data-testid={`provider-bid-withdraw-${bidId}`}
        className="w-full min-h-[44px] rounded-2xl border border-pv-border-strong text-pv-text flex items-center justify-center gap-2 transition-colors hover:bg-pv-surface-sunken disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {withdraw.isPending && (
          <Loader2
            size={14}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {withdraw.isPending ? copy.withdraw.pending : copy.withdraw.action}
      </button>
      {message && (
        <p
          role={result === 'done' ? 'status' : 'alert'}
          aria-live={result === 'done' ? 'polite' : undefined}
          data-testid={`provider-bid-withdraw-result-${bidId}`}
          data-result={result ?? undefined}
          className={`text-center text-pv-label font-semibold ${
            result === 'done' ? 'text-pv-done' : 'text-pv-danger'
          }`}
        >
          {message}
        </p>
      )}
      <ProviderConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={copy.withdraw.title}
        description={copy.withdraw.body}
        keepLabel={copy.withdraw.keep}
        confirmLabel={copy.withdraw.confirm}
        onConfirm={() => {
          setResult(null);
          withdraw.mutate(bidId, {
            onSuccess: () => setResult('done'),
            onError: (error) => setResult(classifyActionError(error)),
          });
        }}
        dir={dir === 'rtl' ? 'rtl' : 'ltr'}
        testId={`provider-bid-withdraw-dialog-${bidId}`}
        returnFocusRef={trigger}
      />
    </div>
  );
}

export function MyBidsScreen() {
  const { lang } = useLang();
  const language: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const myBidsQuery = useMyBidPages();
  // Cards fade in unless the reader asked for reduced motion.
  const reduceMotion = useReducedMotion();
  const loadingMore = myBidsQuery.isFetchingNextPage;
  const moreFailed = myBidsQuery.isFetchNextPageError;
  const hasMore = myBidsQuery.hasNextPage;

  const myBids = useMemo(() => {
    const items: MyBidSummary[] = flattenBidPages(myBidsQuery.data?.pages);
    return items.map((b) => {
      const labelEn = b.request.category?.labelEn ?? b.request.customServiceText ?? '';
      const labelAr = b.request.category?.labelAr ?? b.request.customServiceText ?? '';
      // Each ACCEPTED bid carries its booking, whose server state decides
      // which transition the card offers.
      const linkedBooking: { id: string; status: BookingStatus } | null = b.booking ?? null;
      return {
        id: b.id,
        requestService: labelEn,
        requestServiceAr: labelAr,
        requestIcon: iconForCategorySlug(b.request.category?.slug ?? null),
        // Wire deliberately omits seeker identity. Show city as the
        // anonymised "where" label until the bid is accepted, after
        // which the booking surfaces the seeker's first name.
        seekerName: b.request.city,
        status: b.status.toLowerCase() as BidView,
        bookingId: linkedBooking?.id ?? null,
        bookingStatus: linkedBooking?.status ?? null,
        offer: formatOffer(b.amount, b.currency, b.pricingType, language),
        executionTime: formatResponseTime(b.responseTimeMinutes, language),
        note: b.note ?? '',
        submittedAt: formatRelativeTime(b.submittedAt, language),
      };
    });
  }, [myBidsQuery.data, language]);

  // Where focus goes once the requested page lands: the first new card.
  const firstNewIndex = useRef<number | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    const index = firstNewIndex.current;
    if (index === null || loadingMore) return;
    firstNewIndex.current = null;
    const next = myBids[index];
    if (next) cardRefs.current.get(next.id)?.focus();
  }, [myBids, loadingMore]);

  const loadMore = () => {
    // One page at a time: never a second request while one is in flight.
    if (!hasMore || loadingMore) return;
    firstNewIndex.current = myBids.length;
    void myBidsQuery.fetchNextPage({ cancelRefetch: false });
  };

  const L = {
    title: lang === 'ar' ? 'عروضي' : 'My Bids',
    allBookings: lang === 'ar' ? 'الحجوزات' : 'Bookings',
    openBooking: lang === 'ar' ? 'فتح الحجز' : 'Open booking',
    pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    accepted: lang === 'ar' ? 'مقبول' : 'Accepted',
    rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
    withdrawn: lang === 'ar' ? 'مسحوب' : 'Withdrawn',
    price: lang === 'ar' ? 'السعر:' : 'Price:',
    time: lang === 'ar' ? 'الوقت:' : 'Time:',
    bookingPending: lang === 'ar' ? 'بانتظار الحجز…' : 'Waiting for booking…',
    noBids: lang === 'ar' ? 'لم تقدم أي عروض بعد' : 'No bids submitted yet',
    noBidsSub:
      lang === 'ar'
        ? 'ابدأ بتقديم عروض على الطلبات القريبة'
        : 'Start placing bids on nearby requests',
    loading: lang === 'ar' ? 'جارٍ تحميل عروضك…' : 'Loading your bids…',
    loadFailed: lang === 'ar' ? 'تعذّر تحميل عروضك.' : 'Couldn’t load your bids.',
    retry: lang === 'ar' ? 'إعادة المحاولة' : 'Try again',
    for: lang === 'ar' ? 'من' : 'for',
    loadMore: lang === 'ar' ? 'عرض المزيد' : 'Load more',
    loadingMore: lang === 'ar' ? 'جارٍ تحميل المزيد من العروض…' : 'Loading more bids…',
    moreFailed: lang === 'ar' ? 'تعذّر تحميل المزيد من العروض.' : 'Couldn’t load more bids.',
    moreFailedBody:
      lang === 'ar'
        ? 'العروض المعروضة أعلاه لا تزال محدّثة.'
        : 'The bids above are still up to date.',
    allShown: lang === 'ar' ? 'تم عرض كل العروض' : 'All bids shown',
    showing: (n: number) => (lang === 'ar' ? `عدد العروض المعروضة: ${n}` : `Showing ${n} bids`),
    atLeast: (n: number) => (lang === 'ar' ? `${n} على الأقل` : `at least ${n}`),
  };

  const STATUS_STYLE: Record<BidView, { bg: string; text: string; label: string }> = {
    pending: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-400',
      label: L.pending,
    },
    accepted: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-400',
      label: L.accepted,
    },
    rejected: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-pv-danger',
      label: L.rejected,
    },
    withdrawn: {
      bg: 'bg-slate-100 dark:bg-slate-700',
      text: 'text-pv-muted',
      label: L.withdrawn,
    },
  };

  const loading = myBidsQuery.isPending;
  const failed = myBidsQuery.isError && !myBidsQuery.data;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <h2
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '22px', fontWeight: 800 }}
          >
            {L.title}
          </h2>
          <Link
            to="/provider/bookings"
            data-testid="provider-bids-bookings-link"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-pv-accent hover:bg-pv-accent-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-accent"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            {L.allBookings}
            <ChevronRight size={16} aria-hidden="true" className="rtl:rotate-180" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {(['pending', 'accepted', 'rejected'] as const).map((s) => {
            const cnt = myBids.filter((b) => b.status === s).length;
            return (
              <div
                key={s}
                className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${STATUS_STYLE[s].bg}`}
                data-testid={`provider-bids-count-${s}`}
              >
                <span
                  className={STATUS_STYLE[s].text}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {STATUS_STYLE[s].label}
                </span>
                {/* While more pages exist this counts the bids loaded so far,
                    not a total: "+" says so, and so does the hidden text. */}
                <span
                  className={`min-w-4 h-4 px-1 rounded-full flex items-center justify-center ${STATUS_STYLE[s].text}`}
                  // A light pill keeps the count's text at AA contrast on the tinted chip
                  // (a dark overlay pushed it below 4.5:1).
                  style={{ fontSize: '9px', fontWeight: 800, background: 'rgba(255,255,255,0.7)' }}
                >
                  {hasMore ? (
                    <>
                      <span aria-hidden="true">{cnt}+</span>
                      <span className="sr-only">{L.atLeast(cnt)}</span>
                    </>
                  ) : (
                    cnt
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <ProviderSkeleton rows={3} label={L.loading} />
        ) : failed ? (
          <ProviderErrorState
            title={L.loadFailed}
            retryLabel={L.retry}
            onRetry={() => void myBidsQuery.refetch()}
            testId="provider-bids-error"
          />
        ) : myBids.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Briefcase size={32} className="text-slate-300" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p
                className="text-slate-700 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {L.noBids}
              </p>
              <p className="text-pv-muted mt-1" style={{ fontSize: '13px' }}>
                {L.noBidsSub}
              </p>
            </div>
          </div>
        ) : (
          <>
            {myBids.map((bid) => {
              const ss = STATUS_STYLE[bid.status] ?? STATUS_STYLE.pending;
              return (
                <motion.div
                  key={bid.id}
                  ref={(node: HTMLDivElement | null) => {
                    if (node) cardRefs.current.set(bid.id, node);
                    else cardRefs.current.delete(bid.id);
                  }}
                  tabIndex={-1}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
                  data-testid={`provider-bid-${bid.id}`}
                  data-status={bid.status}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-2xl flex-shrink-0"
                      aria-hidden="true"
                    >
                      {bid.requestIcon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="min-w-0 break-words text-slate-900 dark:text-white"
                          style={{ fontSize: '14px', fontWeight: 700 }}
                        >
                          {lang === 'ar' ? bid.requestServiceAr : bid.requestService}
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-lg ${ss.bg} ${ss.text}`}
                          style={{ fontSize: '10px', fontWeight: 700 }}
                          data-testid={`provider-bid-status-${bid.id}`}
                        >
                          {ss.label}
                        </span>
                      </div>
                      <p className="text-pv-muted" style={{ fontSize: '12px' }}>
                        {L.for} <bdi>{bid.seekerName}</bdi> · {bid.submittedAt}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 mb-3">
                    <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                      <p className="text-pv-muted" style={{ fontSize: '10px' }}>
                        {L.price}
                      </p>
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '16px', fontWeight: 800 }}
                        data-testid={`provider-bid-price-${bid.id}`}
                      >
                        {/* Amount and currency code stay one left-to-right run in
                          Arabic too; the pricing basis follows in the reader's
                          language. */}
                        <bdi dir="ltr">{bid.offer.value}</bdi>
                        <span
                          className="block text-pv-muted"
                          style={{ fontSize: '12px', fontWeight: 600 }}
                        >
                          {bid.offer.basis}
                        </span>
                      </p>
                    </div>
                    <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                      <p className="text-pv-muted" style={{ fontSize: '10px' }}>
                        {L.time}
                      </p>
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '13px', fontWeight: 700 }}
                      >
                        {bid.executionTime || '—'}
                      </p>
                    </div>
                  </div>

                  {bid.note && (
                    <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2 mb-3">
                      <p
                        className="break-words text-slate-500 dark:text-slate-400"
                        style={{ fontSize: '12px', lineHeight: '1.4' }}
                      >
                        <bdi>“{bid.note}”</bdi>
                      </p>
                    </div>
                  )}

                  {bid.status === 'pending' && <WithdrawBid bidId={bid.id} lang={language} />}

                  {bid.status === 'accepted' &&
                    (bid.bookingId && bid.bookingStatus ? (
                      <div className="flex flex-col gap-2">
                        <span
                          className="self-start"
                          data-testid={`provider-bid-booking-status-${bid.id}`}
                          data-status={bid.bookingStatus}
                        >
                          <ProviderStatusBadge
                            tone={BOOKING_STATUS_TONE[bid.bookingStatus]}
                            label={BOOKING_COPY[language].status[bid.bookingStatus]}
                          />
                        </span>
                        <BookingActions bookingId={bid.bookingId} status={bid.bookingStatus} />
                        <Link
                          to={`/provider/bookings/${bid.bookingId}`}
                          data-testid={`provider-bid-open-booking-${bid.id}`}
                          className="inline-flex min-h-[44px] w-full items-center justify-center gap-1 rounded-2xl text-pv-accent hover:bg-pv-accent-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-accent"
                          style={{ fontSize: '13px', fontWeight: 700 }}
                        >
                          {L.openBooking}
                          <ChevronRight size={16} aria-hidden="true" className="rtl:rotate-180" />
                        </Link>
                        <BookingMessageButton bookingId={bid.bookingId} lang={language} />
                      </div>
                    ) : (
                      <p
                        role="status"
                        className="text-pv-muted text-center py-2"
                        style={{ fontSize: '12px' }}
                      >
                        {L.bookingPending}
                      </p>
                    ))}
                </motion.div>
              );
            })}
            <p className="sr-only" aria-live="polite" data-testid="provider-bids-shown">
              {L.showing(myBids.length)}
            </p>
            {moreFailed && (
              <div className="flex flex-col gap-2 mb-3" data-testid="provider-bids-more-error">
                <ProviderNotice tone="danger" title={L.moreFailed} description={L.moreFailedBody} />
                <ProviderButton tone="secondary" onClick={loadMore} disabled={loadingMore}>
                  {L.retry}
                </ProviderButton>
              </div>
            )}
            {hasMore && !moreFailed ? (
              <ProviderButton
                tone="secondary"
                size="block"
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
                data-testid="provider-bids-load-more"
              >
                {loadingMore ? L.loadingMore : L.loadMore}
              </ProviderButton>
            ) : null}
            {!hasMore && (myBidsQuery.data?.pages.length ?? 0) > 1 ? (
              <p
                className="text-center text-pv-muted"
                style={{ fontSize: '13px' }}
                data-testid="provider-bids-end"
              >
                {L.allShown}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
