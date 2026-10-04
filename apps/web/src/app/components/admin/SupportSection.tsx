import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type {
  AdminSupportTicketDetailView,
  AdminSupportTicketSummaryView,
  ListAdminSupportTicketsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../../../lib/api';

function submissionKey() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function SupportSection({ lang }: { lang: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  const [items, setItems] = useState<AdminSupportTicketSummaryView[]>([]);
  const [selected, setSelected] = useState<AdminSupportTicketDetailView | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  async function loadList() {
    const { data } =
      await api.get<ListAdminSupportTicketsResponse>('/v1/admin/support/tickets');
    setItems(data.items);
  }

  async function loadDetail(id: string) {
    const { data } = await api.get<AdminSupportTicketDetailView>(
      `/v1/admin/support/tickets/${id}`,
    );
    setSelected(data);
  }

  useEffect(() => {
    void loadList().catch(() =>
      setError(ar ? 'تعذر تحميل طلبات الدعم.' : 'Could not load support tickets.'),
    );
  }, [ar]);

  async function reply() {
    if (!selected || !body.trim() || busy) return;
    const value = body.trim();
    if (!attempt.current || attempt.current.body !== value) {
      attempt.current = { body: value, key: submissionKey() };
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/v1/admin/support/tickets/${selected.id}/messages`, {
        body: value,
        idempotencyKey: attempt.current.key,
      });
      attempt.current = null;
      setBody('');
      await loadDetail(selected.id);
      await loadList();
    } catch {
      setError(ar ? 'تعذر إرسال الرد.' : 'Could not send reply.');
    } finally {
      setBusy(false);
    }
  }

  async function change(action: 'close' | 'reopen') {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<AdminSupportTicketDetailView>(
        `/v1/admin/support/tickets/${selected.id}/${action}`,
      );
      setSelected(data);
      await loadList();
    } catch {
      setError(ar ? 'تعذر تحديث حالة الطلب.' : 'Could not update ticket status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-3 text-lg font-extrabold">{ar ? 'طلبات الدعم' : 'Support tickets'}</h2>
        <div className="space-y-2">
          {items.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => void loadDetail(ticket.id)}
              className="min-h-11 w-full rounded-xl border border-slate-200 p-3 text-start dark:border-slate-700"
            >
              <span className="block font-semibold">{ticket.subject}</span>
              <span className="text-xs text-slate-500">
                {ticket.requester.email} · {ticket.status}
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-slate-500">{ar ? 'لا توجد طلبات.' : 'No tickets.'}</p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        {error && (
          <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-rose-700">
            {error}
          </p>
        )}
        {!selected ? (
          <p className="text-sm text-slate-500">
            {ar ? 'اختر طلب دعم.' : 'Select a support ticket.'}
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-extrabold">{selected.subject}</h3>
                <p className="text-sm text-slate-500">
                  {selected.requester.firstName} {selected.requester.lastName} ·{' '}
                  {selected.requester.email}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void change(selected.status === 'OPEN' ? 'close' : 'reopen')}
                className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold"
              >
                {selected.status === 'OPEN'
                  ? ar
                    ? 'إغلاق'
                    : 'Close'
                  : ar
                    ? 'إعادة فتح'
                    : 'Reopen'}
              </button>
            </div>
            <div className="max-h-[32rem] space-y-3 overflow-y-auto">
              {selected.messages.map((msg) => (
                <div
                  key={msg.id}
                  dir="auto"
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    msg.authorRole === 'SUPPORT'
                      ? 'ms-auto bg-amber-500 text-white'
                      : 'me-auto bg-slate-100 dark:bg-slate-700'
                  }`}
                >
                  {msg.body}
                </div>
              ))}
            </div>
            {selected.status === 'OPEN' && (
              <div className="mt-4 flex items-end gap-2">
                <label className="flex-1">
                  <span className="sr-only">{ar ? 'رد الدعم' : 'Support reply'}</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    className="w-full rounded-xl border border-slate-300 bg-transparent p-3 text-base"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void reply()}
                  disabled={busy || !body.trim()}
                  aria-label={ar ? 'إرسال الرد' : 'Send reply'}
                  className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-white disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
