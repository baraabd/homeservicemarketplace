// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// The notifications bell and its drawer. Shell furniture, not a route.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { motion } from 'motion/react';
import { useLang } from '../../../i18n/LanguageContext';
import {
  useMarkAllProviderNotificationsRead,
  useMarkProviderNotificationRead,
  useProviderNotifications,
  useProviderUnreadNotificationsCount,
} from '../../../hooks/provider/useProviderNotifications';
import { formatRelativeTime } from '../../../../lib/provider/available-jobs-adapter';
import { X, Bell } from 'lucide-react';

// ─── Notifications bell button (Sprint 5.5) ──────────────────────────────────
// Reads the unread count from /v1/me/notifications/unread-count?
// experience=provider with a 15 s poll. Renders a 99+ pill when the
// count is large enough that it would overflow the badge.
export function ProviderNotificationsBellButton({ onOpen }: { onOpen: () => void }) {
  const countQuery = useProviderUnreadNotificationsCount();
  const count = countQuery.data?.count ?? 0;
  const display = count > 99 ? '99+' : String(count);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open notifications"
      className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
    >
      <Bell size={17} className="text-slate-600 dark:text-slate-300" />
      {count > 0 && (
        <span
          className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white"
          style={{ fontSize: '8px', fontWeight: 800 }}
        >
          {display}
        </span>
      )}
    </button>
  );
}

// ─── Notifications drawer (Sprint 5.5) ───────────────────────────────────────
// Slides in from the right. Lists provider notifications, lets the
// operator mark one read or mark-all-read. The mark-all-read mutation
// passes ?experience=provider so the seeker badge stays untouched.
export function ProviderNotificationsDrawer({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const listQuery = useProviderNotifications();
  const markRead = useMarkProviderNotificationRead();
  const markAllRead = useMarkAllProviderNotificationsRead();

  const items = listQuery.data?.items ?? [];

  const L = {
    title: lang === 'ar' ? 'الإشعارات' : 'Notifications',
    markAll: lang === 'ar' ? 'تعليم الكل كمقروء' : 'Mark all read',
    empty: lang === 'ar' ? 'لا توجد إشعارات بعد.' : 'No notifications yet.',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…',
    failed: lang === 'ar' ? 'تعذّر تحميل الإشعارات.' : 'Could not load notifications.',
  };

  const empty = items.length === 0;
  const allRead = items.every((n) => n.readAt !== null);

  return (
    <>
      {/* Sprint 7.14 — `absolute` (NOT `fixed`) so the drawer is bounded
          by the provider app shell (the root div is now `relative`)
          exactly like the seeker drawer, instead of escaping to the full
          browser viewport on wide screens. z-indices sit above the
          top-bar / bottom-nav (z-20). */}
      <motion.div
        className="absolute inset-0 bg-slate-900/40 z-40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="absolute top-0 end-0 bottom-0 w-full sm:w-[400px] bg-white dark:bg-slate-800 z-50 flex flex-col shadow-2xl"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        role="dialog"
        aria-label={L.title}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '16px', fontWeight: 800 }}
          >
            {L.title}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={empty || allRead || markAllRead.isPending}
              className="text-blue-600 disabled:text-slate-400 disabled:cursor-not-allowed"
              style={{ fontSize: '12px', fontWeight: 600 }}
            >
              {L.markAll}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center"
            >
              <X size={14} className="text-slate-500" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {empty ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Bell size={20} className="text-slate-300" />
              </div>
              <p role="status" className="text-slate-400" style={{ fontSize: '13px' }}>
                {listQuery.isError ? L.failed : listQuery.isPending ? L.loading : L.empty}
              </p>
            </div>
          ) : (
            items.map((n) => {
              const isRead = n.readAt !== null;
              return (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => {
                    if (!isRead) markRead.mutate(n.id);
                  }}
                  className={`w-full text-start px-5 py-4 border-b border-slate-50 dark:border-slate-700/50 active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors ${
                    isRead ? '' : 'bg-blue-50/50 dark:bg-blue-900/10'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!isRead && (
                      <span className="mt-1 w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '13px', fontWeight: isRead ? 500 : 700 }}
                      >
                        {/* `body` and `title` come from the server,
                            already escaped on the JSON wire. React
                            renders them as text (never as HTML), so
                            no XSS surface here. */}
                        {n.title}
                      </p>
                      <p
                        className="text-slate-500 dark:text-slate-400 mt-0.5"
                        style={{ fontSize: '12px', lineHeight: 1.4 }}
                      >
                        {n.body}
                      </p>
                      <p className="text-slate-400 mt-1" style={{ fontSize: '10px' }}>
                        {formatRelativeTime(n.createdAt, lang)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </motion.div>
    </>
  );
}
