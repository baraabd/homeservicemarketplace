// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// The provider’s own bids, and the booking transition panel beside them.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useLang } from '../../../i18n/LanguageContext';
import { useMyBids } from '../../../hooks/provider/useMyBids';
import {
  useCancelProviderBooking,
  useCompleteProviderBooking,
  useProviderBookings,
  useStartProviderBooking,
} from '../../../hooks/provider/useProviderBookings';
import {
  formatRelativeTime,
  formatResponseTime,
  iconForCategorySlug,
} from '../../../../lib/provider/available-jobs-adapter';
import { Briefcase, X, CheckCircle2 } from 'lucide-react';

// ─── Booking transition panel (Sprint 5.4) ────────────────────────────────────
// Renders the right action button for the linked booking's current
// state. Pure presentation — the parent owns the mutations + their
// pending state.
//
//   SCHEDULED   → "Start Job" (primary) + "Cancel Booking" (link)
//   IN_PROGRESS → "Mark Complete" (primary)
//   COMPLETED   → "Completed" pill (no buttons)
//   CANCELLED   → "Cancelled" pill (no buttons)
//   null        → "Waiting for booking…" copy (race window between
//                 bid acceptance and the booking row landing in the
//                 list — harmless, resolves on the next 30s poll)
function BookingTransitionPanel({
  bookingId,
  bookingStatus,
  onStart,
  onComplete,
  onCancel,
  pending,
  labels,
}: {
  bookingId: string | null;
  bookingStatus: string | null;
  onStart: (bookingId: string) => void;
  onComplete: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
  pending: boolean;
  labels: {
    start: string;
    complete: string;
    cancel: string;
    inProgress: string;
    completed: string;
    cancelled: string;
    pendingBooking: string;
  };
}) {
  if (!bookingId || !bookingStatus) {
    return (
      <p role="status" className="text-slate-400 text-center py-2" style={{ fontSize: '12px' }}>
        {labels.pendingBooking}
      </p>
    );
  }
  if (bookingStatus === 'COMPLETED') {
    return (
      <div
        className="w-full py-3 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        <CheckCircle2 size={14} />
        {labels.completed}
      </div>
    );
  }
  if (bookingStatus === 'CANCELLED') {
    return (
      <div
        className="w-full py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-500 flex items-center justify-center gap-2"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        <X size={14} />
        {labels.cancelled}
      </div>
    );
  }
  if (bookingStatus === 'IN_PROGRESS') {
    return (
      <button
        type="button"
        onClick={() => onComplete(bookingId)}
        disabled={pending}
        className="w-full py-3 rounded-2xl bg-blue-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-blue-200 dark:shadow-none disabled:opacity-60"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        <CheckCircle2 size={16} />
        {labels.complete}
      </button>
    );
  }
  // Default: SCHEDULED. Start + Cancel.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onStart(bookingId)}
        disabled={pending}
        className="w-full py-3 rounded-2xl bg-green-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-green-200 dark:shadow-none disabled:opacity-60"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        <CheckCircle2 size={16} />
        {labels.start}
      </button>
      <button
        type="button"
        onClick={() => onCancel(bookingId)}
        disabled={pending}
        className="w-full py-2 rounded-2xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
        style={{ fontSize: '12px', fontWeight: 600 }}
      >
        {labels.cancel}
      </button>
    </div>
  );
}

// ─── My Bids Screen ───────────────────────────────────────────────────────────
// Sprint 5.3 — live read from /v1/me/provider/bids. The screen filters
// out WITHDRAWN bids client-side because the existing UI only renders
// 'pending' / 'accepted' / 'rejected' tabs.
// Sprint 5.4 — when a bid is ACCEPTED the linked booking surfaces
// state-aware Start / Complete / Cancel transition buttons.
export function MyBidsScreen() {
  const { lang } = useLang();
  const myBidsQuery = useMyBids();
  // Sprint 5.4: load bookings so the screen can map an ACCEPTED bid
  // to its booking id and surface the right transition button.
  const bookingsQuery = useProviderBookings();
  const startBooking = useStartProviderBooking();
  const completeBooking = useCompleteProviderBooking();
  const cancelBooking = useCancelProviderBooking();

  // bidId -> { bookingId, status } so we can:
  //   * render Start when SCHEDULED
  //   * render Complete when IN_PROGRESS
  //   * render Cancel when SCHEDULED (not after start)
  //   * hide buttons entirely when COMPLETED / CANCELLED
  const bookingByBidId = useMemo<Record<string, { bookingId: string; status: string }>>(() => {
    const map: Record<string, { bookingId: string; status: string }> = {};
    for (const b of bookingsQuery.data?.items ?? []) {
      map[b.bidId] = { bookingId: b.id, status: b.status };
    }
    return map;
  }, [bookingsQuery.data]);

  const myBids = useMemo(() => {
    const items = myBidsQuery.data?.items ?? [];
    return items
      .filter((b) => b.status !== 'WITHDRAWN')
      .map((b) => {
        const labelEn = b.request.category?.labelEn ?? b.request.customServiceText ?? '';
        const labelAr = b.request.category?.labelAr ?? b.request.customServiceText ?? '';
        const icon = iconForCategorySlug(b.request.category?.slug ?? null);
        const linkedBooking = bookingByBidId[b.id] ?? null;
        return {
          id: b.id,
          requestService: labelEn,
          requestServiceAr: labelAr,
          requestIcon: icon,
          // Wire deliberately omits seeker identity. Show city as the
          // anonymised "where" label until the bid is accepted, after
          // which the booking conversation surfaces the seeker name.
          seekerName: b.request.city,
          status: b.status.toLowerCase() as 'pending' | 'accepted' | 'rejected',
          bookingId: linkedBooking?.bookingId ?? null,
          bookingStatus: linkedBooking?.status ?? null,
          price: b.amount,
          executionTime: formatResponseTime(b.responseTimeMinutes, lang),
          note: b.note ?? '',
          submittedAt: formatRelativeTime(b.submittedAt, lang),
        };
      });
  }, [myBidsQuery.data, bookingByBidId, lang]);

  const L = {
    title: lang === 'ar' ? 'عروضي' : 'My Bids',
    pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    accepted: lang === 'ar' ? 'مقبول' : 'Accepted',
    rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
    price: lang === 'ar' ? 'السعر:' : 'Price:',
    time: lang === 'ar' ? 'الوقت:' : 'Time:',
    startJob: lang === 'ar' ? 'ابدأ العمل' : 'Start Job',
    completeJob: lang === 'ar' ? 'إنهاء العمل' : 'Mark Complete',
    cancelJob: lang === 'ar' ? 'إلغاء الحجز' : 'Cancel Booking',
    inProgress: lang === 'ar' ? 'قيد التنفيذ' : 'In Progress',
    completed: lang === 'ar' ? 'مكتمل' : 'Completed',
    cancelled: lang === 'ar' ? 'ملغى' : 'Cancelled',
    bookingPending: lang === 'ar' ? 'بانتظار التأكيد…' : 'Waiting for booking…',
    noBids: lang === 'ar' ? 'لم تقدم أي عروض بعد' : 'No bids submitted yet',
    noBidsSub:
      lang === 'ar'
        ? 'ابدأ بتقديم عروض على الطلبات القريبة'
        : 'Start placing bids on nearby requests',
    for: lang === 'ar' ? 'من' : 'for',
  };

  const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
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
      text: 'text-red-600 dark:text-red-400',
      label: L.rejected,
    },
  };

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-5 pb-4">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex gap-2 mt-3">
          {(['pending', 'accepted', 'rejected'] as const).map((s) => {
            const cnt = myBids.filter((b) => b.status === s).length;
            return (
              <div
                key={s}
                className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${STATUS_STYLE[s].bg}`}
              >
                <span
                  className={STATUS_STYLE[s].text}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {STATUS_STYLE[s].label}
                </span>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${STATUS_STYLE[s].text}`}
                  style={{ fontSize: '9px', fontWeight: 800, background: 'rgba(0,0,0,0.08)' }}
                >
                  {cnt}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-4">
        {myBids.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Briefcase size={32} className="text-slate-300" />
            </div>
            <div className="text-center">
              <p
                className="text-slate-700 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {L.noBids}
              </p>
              <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
                {L.noBidsSub}
              </p>
            </div>
          </div>
        ) : (
          myBids.map((bid) => {
            const ss = STATUS_STYLE[bid.status];
            return (
              <motion.div
                key={bid.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                    {bid.requestIcon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '14px', fontWeight: 700 }}
                      >
                        {lang === 'ar' ? bid.requestServiceAr : bid.requestService}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-lg ${ss.bg} ${ss.text}`}
                        style={{ fontSize: '10px', fontWeight: 700 }}
                      >
                        {ss.label}
                      </span>
                    </div>
                    <p className="text-slate-400" style={{ fontSize: '12px' }}>
                      {L.for} {bid.seekerName} · {bid.submittedAt}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 mb-3">
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.price}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '16px', fontWeight: 800 }}
                    >
                      ${bid.price}/hr
                    </p>
                  </div>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.time}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 700 }}
                    >
                      {bid.executionTime}
                    </p>
                  </div>
                </div>

                {bid.note && (
                  <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2 mb-3">
                    <p
                      className="text-slate-500 dark:text-slate-400"
                      style={{ fontSize: '12px', lineHeight: '1.4' }}
                    >
                      "{bid.note}"
                    </p>
                  </div>
                )}

                {bid.status === 'accepted' && (
                  <BookingTransitionPanel
                    bookingId={bid.bookingId}
                    bookingStatus={bid.bookingStatus}
                    onStart={(id) => startBooking.mutate(id)}
                    onComplete={(id) => completeBooking.mutate(id)}
                    onCancel={(id) => cancelBooking.mutate(id)}
                    pending={
                      startBooking.isPending || completeBooking.isPending || cancelBooking.isPending
                    }
                    labels={{
                      start: L.startJob,
                      complete: L.completeJob,
                      cancel: L.cancelJob,
                      inProgress: L.inProgress,
                      completed: L.completed,
                      cancelled: L.cancelled,
                      pendingBooking: L.bookingPending,
                    }}
                  />
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Wallet Screen ────────────────────────────────────────────────────────────
// Bucket COMPLETED transactions into the last 7 days for the wallet
// weekly chart. Pure: takes the raw transaction list, returns one
// Wallet screen day-label localiser. The server returns ISO 'YYYY-MM-DD'
// strings; the Recharts X-axis just needs a short human-readable tick.
