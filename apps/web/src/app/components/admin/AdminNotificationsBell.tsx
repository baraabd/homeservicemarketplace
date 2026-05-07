import { useState } from 'react';
import { Bell, X } from 'lucide-react';

import {
  useAdminNotifications,
  useMarkAdminNotificationRead,
} from '../../hooks/admin/useAdminAuditLogs';

// Sprint 6.6 — admin top-bar notifications. The badge reads its
// unread count from /v1/admin/notifications?unread=true; the drawer
// lists recent items + a single-tap mark-read mutation.
//
// Replaces the prior `useEcosystem.adminNotifs` mock array — the
// data now flows through the real Notification table scoped by
// experience='admin' (deepLink starts with '/admin/').
export function AdminNotificationsBell({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [open, setOpen] = useState(false);
  const unreadQuery = useAdminNotifications({ unread: true });
  const allQuery = useAdminNotifications({});
  const markRead = useMarkAdminNotificationRead();

  const unreadCount = unreadQuery.data?.items.length ?? 0;
  const items = allQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'إشعارات الإدارة' : 'Admin notifications',
    close: isAr ? 'إغلاق' : 'Close',
    empty: isAr ? 'لا توجد إشعارات.' : 'No notifications yet.',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل الإشعارات.' : 'Could not load notifications.',
    markRead: isAr ? 'تم القراءة' : 'Mark read',
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={L.title}
        className="relative w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all"
      >
        <Bell size={17} className="text-slate-600 dark:text-slate-300" />
        {unreadCount > 0 ? (
          <span
            className="absolute -top-1 -end-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-slate-800"
            style={{ fontSize: '8px', fontWeight: 800 }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label={L.close}
          />
          <div className="relative ms-auto w-full max-w-md bg-white dark:bg-slate-800 h-full overflow-y-auto p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '18px', fontWeight: 800 }}
              >
                {L.title}
              </h3>
              <button
                onClick={() => setOpen(false)}
                aria-label={L.close}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            {allQuery.isPending ? (
              <p className="text-slate-400" role="status" style={{ fontSize: '13px' }}>
                {L.loading}
              </p>
            ) : allQuery.isError ? (
              <p className="text-rose-600" role="status" style={{ fontSize: '13px' }}>
                {L.failed}
              </p>
            ) : items.length === 0 ? (
              <p className="text-slate-400" role="status" style={{ fontSize: '13px' }}>
                {L.empty}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={`px-3 py-2 rounded-2xl flex items-start gap-2 ${
                      n.readAt
                        ? 'bg-slate-50 dark:bg-slate-700/40'
                        : 'bg-blue-50 dark:bg-blue-900/30'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '13px', fontWeight: 600 }}
                      >
                        {n.title}
                      </p>
                      <p
                        className="text-slate-500 dark:text-slate-300"
                        style={{ fontSize: '12px' }}
                      >
                        {n.body}
                      </p>
                      <p className="text-slate-400 mt-0.5" style={{ fontSize: '10px' }}>
                        {new Date(n.createdAt).toLocaleString(isAr ? 'ar' : 'en')}
                      </p>
                    </div>
                    {!n.readAt ? (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(n.id)}
                        disabled={markRead.isPending}
                        className="px-2 py-1 rounded-2xl bg-blue-600 text-white disabled:opacity-50"
                        style={{ fontSize: '10px', fontWeight: 700 }}
                      >
                        {L.markRead}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
