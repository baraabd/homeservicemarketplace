import { useMemo, useState } from 'react';
import { useAdminAuditLogs } from '../../hooks/admin/useAdminAuditLogs';

// Sprint 6.6 — Admin audit log viewer. Real, API-driven table with
// actor + action filter chips. The metadata column is rendered as
// pretty-printed JSON; sensitive keys (passwordHash, JWT_SECRET,
// DATABASE_URL, etc.) are redacted server-side before they leave
// the API, so the rendered string is always safe.

const ACTION_FILTERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'ADMIN_USER_SUSPENDED', label: 'User suspended' },
  { key: 'ADMIN_USER_RESTORED', label: 'User restored' },
  { key: 'ADMIN_PROVIDER_APPROVED', label: 'Provider approved' },
  { key: 'ADMIN_PROVIDER_REJECTED', label: 'Provider rejected' },
  { key: 'ADMIN_PROVIDER_SUSPENDED', label: 'Provider suspended' },
  { key: 'ADMIN_PROVIDER_NOTES_UPDATED', label: 'Provider notes' },
  { key: 'ADMIN_DISPUTE_OPENED', label: 'Dispute opened' },
  { key: 'ADMIN_DISPUTE_RESOLVED', label: 'Dispute resolved' },
  { key: 'ADMIN_DISPUTE_UPDATED', label: 'Dispute updated' },
  { key: 'ADMIN_SETTING_UPDATED', label: 'Setting changed' },
];

export function AuditLogsSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [actor, setActor] = useState('');
  const [committedActor, setCommittedActor] = useState('');
  const [action, setAction] = useState('');

  const filters = useMemo(
    () => ({
      actor: committedActor.trim() || undefined,
      action: action || undefined,
      limit: 50,
    }),
    [committedActor, action],
  );

  const auditQuery = useAdminAuditLogs(filters);
  const items = auditQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'سجل التدقيق' : 'Audit Logs',
    actorPlaceholder: isAr ? 'تصفية حسب معرّف المستخدم' : 'Filter by actor user id',
    actorAction: isAr ? 'بحث' : 'Filter',
    actionFilter: isAr ? 'الإجراء' : 'Action',
    columns: {
      when: isAr ? 'الوقت' : 'When',
      actor: isAr ? 'الفاعل' : 'Actor',
      action: isAr ? 'الإجراء' : 'Action',
      metadata: isAr ? 'البيانات' : 'Metadata',
    },
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل السجل.' : 'Could not load audit log.',
    empty: isAr ? 'لا توجد سجلات مطابقة.' : 'No audit events match the current filter.',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex flex-wrap gap-2 items-center">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCommittedActor(actor.trim());
            }}
            className="flex gap-2"
          >
            <input
              type="search"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder={L.actorPlaceholder}
              className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              style={{ fontSize: '13px', minWidth: '220px' }}
              aria-label={L.actorPlaceholder}
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-2xl bg-blue-600 text-white"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {L.actorAction}
            </button>
          </form>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '13px' }}
            aria-label={L.actionFilter}
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {auditQuery.isPending ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.loading}
          </p>
        ) : auditQuery.isError ? (
          <p className="py-12 text-center text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.failed}
          </p>
        ) : items.length === 0 ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.empty}
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                {[L.columns.when, L.columns.actor, L.columns.action, L.columns.metadata].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-slate-500 text-start"
                      style={{ fontSize: '11px', fontWeight: 700 }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 dark:border-slate-700">
                  <td className="px-3 py-2 text-slate-500" style={{ fontSize: '11px' }}>
                    {new Date(row.createdAt).toLocaleString(isAr ? 'ar' : 'en')}
                  </td>
                  <td
                    className="px-3 py-2 text-slate-700 dark:text-slate-200"
                    style={{ fontSize: '12px' }}
                  >
                    {row.actor ?? '—'}
                  </td>
                  <td className="px-3 py-2" style={{ fontSize: '12px', fontWeight: 600 }}>
                    {row.action}
                  </td>
                  <td
                    className="px-3 py-2 text-slate-500"
                    style={{ fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    <code>{JSON.stringify(row.metadata, null, 0)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
