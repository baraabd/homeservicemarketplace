import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, CheckCircle2, Briefcase } from 'lucide-react';
import type { BookingListItem } from '@homeservicemarketplace/contracts';

import { useLang } from '../../i18n/LanguageContext';
import { useBookings } from '../../hooks/seeker/useBookings';

// Sprint 7.12 — Completed Posts page (Seeker Profile → Completed Posts).
//
// Source: GET /v1/me/bookings?status=COMPLETED — the existing seeker
// bookings list endpoint already accepts a status filter (see
// useBookings(filter?: { status })), so we don't need a new backend
// route. Hard-refresh consistent by construction — the canonical
// state lives on the server and the page reads it directly via React
// Query; no UI-only cache patching.
//
// Tapping a completed post opens the SAME JobDetailView used by the
// Bookings tab via the `onOpenBooking` callback (the parent wires
// it to setJobDetail({ kind: 'booking', id })) so there's no fork of
// the detail view.
//
// Cache invalidation: when a booking becomes COMPLETED, the
// dispatchInvalidations cascade invalidates `seekerQueryKeys.bookings.root`
// which covers BOTH the all-bookings list AND this status-filtered
// list — the completed posts page refreshes automatically.

interface CompletedPostsPageProps {
  onBack: () => void;
  onOpenBooking?: (bookingId: string) => void;
}

function formatCompletedDate(iso: string, lang: 'en' | 'ar'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  return d.toLocaleDateString(locale, opts);
}

function getServiceLabel(row: BookingListItem, lang: 'en' | 'ar'): string {
  if (lang === 'ar') {
    return (
      row.service.categoryLabelAr ??
      row.service.categoryLabelEn ??
      row.service.customServiceText ??
      'خدمة'
    );
  }
  return row.service.categoryLabelEn ?? row.service.customServiceText ?? 'Service';
}

export function CompletedPostsPage({ onBack, onOpenBooking }: CompletedPostsPageProps) {
  const { lang, dir } = useLang();
  const langKey: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  // Server-side status filter — never relies on client-side filtering
  // of a possibly-partial paginated list, so hard refresh always
  // returns the complete set.
  const bookingsQuery = useBookings({ status: 'COMPLETED' });

  const items = useMemo(() => bookingsQuery.data?.items ?? [], [bookingsQuery.data]);

  const L = {
    title: langKey === 'ar' ? 'الطلبات المكتملة' : 'Completed Posts',
    empty: langKey === 'ar' ? 'لا توجد طلبات مكتملة بعد' : 'No completed posts yet',
    emptyHint:
      langKey === 'ar'
        ? 'ستظهر طلباتك المكتملة هنا بعد إنهاء الخدمة.'
        : 'Completed jobs appear here once the service is finished.',
    loading: langKey === 'ar' ? 'جاري التحميل...' : 'Loading...',
    error: langKey === 'ar' ? 'تعذر تحميل القائمة.' : "Couldn't load the list.",
    retry: langKey === 'ar' ? 'إعادة المحاولة' : 'Retry',
    completed: langKey === 'ar' ? 'مكتمل' : 'Completed',
    pro: langKey === 'ar' ? 'المحترف' : 'Pro',
  };

  return (
    <motion.div
      key="completed-posts"
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900"
      initial={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      animate={{ x: 0 }}
      exit={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      transition={{ type: 'tween', duration: 0.22 }}
    >
      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
            aria-label={langKey === 'ar' ? 'رجوع' : 'Back'}
            data-testid="completed-posts-back"
          >
            {dir === 'rtl' ? (
              <ChevronRight size={20} className="text-slate-700 dark:text-slate-200" />
            ) : (
              <ChevronLeft size={20} className="text-slate-700 dark:text-slate-200" />
            )}
          </button>
          <p
            className="flex-1 text-slate-900 dark:text-white"
            style={{ fontSize: '17px', fontWeight: 800 }}
          >
            {L.title}
          </p>
        </div>
      </div>

      {/* ── Body ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ scrollbarWidth: 'none' }}
        data-testid="completed-posts-list"
      >
        {bookingsQuery.isLoading && !bookingsQuery.data ? (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            role="status"
            aria-live="polite"
          >
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {L.loading}
            </p>
          </div>
        ) : bookingsQuery.isError && !bookingsQuery.data ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3" role="alert">
            <p
              className="text-slate-700 dark:text-slate-200 text-center"
              style={{ fontSize: '14px', fontWeight: 600 }}
            >
              {L.error}
            </p>
            <button
              onClick={() => bookingsQuery.refetch()}
              className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {L.retry}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 gap-4"
            data-testid="completed-posts-empty"
          >
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-slate-300" />
            </div>
            <p
              className="text-slate-700 dark:text-slate-200"
              style={{ fontSize: '16px', fontWeight: 700 }}
            >
              {L.empty}
            </p>
            <p className="text-slate-400 text-center" style={{ fontSize: '13px' }}>
              {L.emptyHint}
            </p>
          </div>
        ) : (
          items.map((b) => (
            <motion.button
              key={b.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => onOpenBooking?.(b.id)}
              className="w-full bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3 text-start cursor-pointer"
              data-testid={`completed-post-${b.id}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p
                    className="text-slate-900 dark:text-white truncate"
                    style={{ fontSize: '14px', fontWeight: 700 }}
                  >
                    {getServiceLabel(b, langKey)}
                  </p>
                  <p className="text-slate-400 mt-0.5" style={{ fontSize: '12px' }}>
                    {formatCompletedDate(b.createdAt, langKey)}
                  </p>
                </div>
                <span
                  className="px-2.5 py-1 rounded-full border bg-green-50 border-green-200 text-green-700 flex-shrink-0 flex items-center gap-1"
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  <CheckCircle2 size={10} />
                  {L.completed}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {b.provider.initials && b.provider.displayName !== '—' && (
                    <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-amber-700" style={{ fontSize: '8px', fontWeight: 800 }}>
                        {b.provider.initials}
                      </span>
                    </div>
                  )}
                  <span
                    className="text-slate-500 dark:text-slate-400 truncate"
                    style={{ fontSize: '12px' }}
                  >
                    {L.pro}: {b.provider.displayName}
                  </span>
                </div>
                <ChevronRight size={14} className="text-slate-300 rtl:rotate-180 flex-shrink-0" />
              </div>
            </motion.button>
          ))
        )}

        {/* Sentinel padding so the last card isn't flush with the bottom edge */}
        <div className="h-6" />
      </div>

      {/* Bottom hint banner — clarifies what "completed" means and
          differentiates from active/cancelled posts. */}
      {items.length > 0 && (
        <div className="flex-shrink-0 px-4 py-3 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-t border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <Briefcase size={12} className="text-slate-400 flex-shrink-0" />
          <p className="text-slate-400" style={{ fontSize: '11px' }}>
            {langKey === 'ar'
              ? 'لا تظهر الطلبات النشطة أو الملغاة هنا.'
              : 'Active or cancelled posts do not appear here.'}
          </p>
        </div>
      )}
    </motion.div>
  );
}
