import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, HelpCircle, Send } from 'lucide-react';
import type {
  CreateSupportTicketResponse,
  ListSupportTicketsResponse,
  SupportTicketDetailView,
  SupportTicketSummaryView,
} from '@homeservicemarketplace/contracts';

import { api } from '../../../lib/api';
import { useLang } from '../../i18n/LanguageContext';

const FAQS = [
  {
    en: 'How do I cancel a booking?',
    ar: 'كيف أُلغي الحجز؟',
    answerEn:
      'Open the booking and use the cancellation action when the booking state allows it.',
    answerAr: 'افتح الحجز واستخدم إجراء الإلغاء عندما تسمح حالة الحجز بذلك.',
  },
  {
    en: 'How do payments work?',
    ar: 'كيف تعمل المدفوعات؟',
    answerEn:
      'The current product does not process or hold customer funds. Follow the payment details shown for the booking.',
    answerAr:
      'المنتج الحالي لا يعالج أموال العميل أو يحتفظ بها. اتبع تفاصيل الدفع المعروضة للحجز.',
  },
  {
    en: 'What if I have a problem with a job?',
    ar: 'ماذا أفعل إذا واجهت مشكلة في المهمة؟',
    answerEn:
      'Use the booking dispute flow for a dispute about a job. Use Support below for platform help.',
    answerAr:
      'استخدم مسار النزاع داخل الحجز عند وجود نزاع متعلق بالمهمة، واستخدم الدعم أدناه للمساعدة في المنصة.',
  },
];

function submissionKey() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function HelpSupportPage({ onBack }: { onBack: () => void }) {
  const { lang, dir } = useLang();
  const ar = lang === 'ar';
  const [tickets, setTickets] = useState<SupportTicketSummaryView[]>([]);
  const [selected, setSelected] = useState<SupportTicketDetailView | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const createAttempt = useRef<{ signature: string; key: string } | null>(null);
  const sendAttempt = useRef<{ signature: string; key: string } | null>(null);

  const copy = useMemo(
    () => ({
      title: ar ? 'المساعدة والدعم' : 'Help & Support',
      faq: ar ? 'أسئلة شائعة' : 'Frequently asked questions',
      tickets: ar ? 'طلبات الدعم' : 'Support tickets',
      newTicket: ar ? 'طلب دعم جديد' : 'New support ticket',
      subject: ar ? 'الموضوع' : 'Subject',
      describe: ar ? 'صف المشكلة أو السؤال' : 'Describe the problem or question',
      create: ar ? 'إرسال الطلب' : 'Create ticket',
      send: ar ? 'إرسال' : 'Send',
      empty: ar ? 'لا توجد طلبات دعم بعد.' : 'No support tickets yet.',
      open: ar ? 'مفتوح' : 'Open',
      closed: ar ? 'مغلق' : 'Closed',
      back: ar ? 'العودة' : 'Back',
      loadFail: ar ? 'تعذر تحميل الدعم. حاول مجدداً.' : 'Could not load support. Try again.',
      sendFail: ar
        ? 'تعذر الإرسال. رسالتك لم تُسجل كناجحة.'
        : 'Could not send. The message was not marked as saved.',
    }),
    [ar],
  );

  async function loadTickets() {
    const { data } = await api.get<ListSupportTicketsResponse>('/v1/me/support/tickets');
    setTickets(data.items);
  }

  async function loadDetail(id: string) {
    const { data } = await api.get<SupportTicketDetailView>(`/v1/me/support/tickets/${id}`);
    setSelected(data);
  }

  useEffect(() => {
    let alive = true;
    void loadTickets()
      .catch(() => {
        if (alive) setError(copy.loadFail);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [copy.loadFail]);

  useEffect(() => {
    if (!selected || selected.status !== 'OPEN') return;
    const id = selected.id;
    const timer = window.setInterval(() => {
      void loadDetail(id).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status]);

  async function createTicket() {
    const s = subject.trim();
    const m = message.trim();
    if (!s || !m || busy) return;
    const signature = `${s}\n${m}`;
    if (!createAttempt.current || createAttempt.current.signature !== signature) {
      createAttempt.current = { signature, key: submissionKey() };
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<CreateSupportTicketResponse>('/v1/me/support/tickets', {
        subject: s,
        message: m,
        idempotencyKey: createAttempt.current.key,
      });
      createAttempt.current = null;
      setSubject('');
      setMessage('');
      setSelected(data.ticket);
      await loadTickets();
    } catch {
      setError(copy.sendFail);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!selected || selected.status !== 'OPEN') return;
    const body = newMessage.trim();
    if (!body || busy) return;
    if (!sendAttempt.current || sendAttempt.current.signature !== body) {
      sendAttempt.current = { signature: body, key: submissionKey() };
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/v1/me/support/tickets/${selected.id}/messages`, {
        body,
        idempotencyKey: sendAttempt.current.key,
      });
      sendAttempt.current = null;
      setNewMessage('');
      await loadDetail(selected.id);
      await loadTickets();
    } catch {
      setError(copy.sendFail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900" dir={dir}>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
        <button
          type="button"
          onClick={selected ? () => setSelected(null) : onBack}
          aria-label={copy.back}
          className="flex size-11 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700"
        >
          {dir === 'rtl' ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
        <div className="flex size-10 items-center justify-center rounded-2xl bg-amber-500 text-white">
          <HelpCircle size={20} />
        </div>
        <div>
          <h2 className="font-extrabold text-slate-900 dark:text-white">{copy.title}</h2>
          <p className="text-xs text-slate-500">
            {ar
              ? 'ردود الدعم تظهر فقط بعد حفظها في الخادم.'
              : 'Support replies appear only after the server stores them.'}
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        {selected ? (
          <section aria-label={selected.subject}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">{selected.subject}</h3>
                <span className="text-xs text-slate-500">
                  {selected.status === 'OPEN' ? copy.open : copy.closed}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              {selected.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    msg.authorRole === 'REQUESTER'
                      ? 'ms-auto bg-amber-500 text-white'
                      : 'me-auto border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                  dir="auto"
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  <time className="mt-1 block text-[10px] opacity-70">
                    {new Date(msg.createdAt).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
            {selected.status === 'OPEN' && (
              <div className="sticky bottom-0 mt-5 flex items-end gap-2 bg-slate-50 py-3 dark:bg-slate-900">
                <label className="flex-1">
                  <span className="sr-only">{copy.describe}</span>
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={2}
                    maxLength={4000}
                    className="min-h-11 w-full rounded-2xl border border-slate-300 bg-white p-3 text-base dark:border-slate-600 dark:bg-slate-800"
                    placeholder={copy.describe}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || !newMessage.trim()}
                  aria-label={copy.send}
                  className="flex size-11 items-center justify-center rounded-xl bg-amber-500 text-white disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            )}
          </section>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 font-bold text-slate-900 dark:text-white">{copy.faq}</h3>
              <div className="space-y-2">
                {FAQS.map((faq, index) => (
                  <div
                    key={faq.en}
                    className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                  >
                    <button
                      type="button"
                      onClick={() => setFaqOpen(faqOpen === index ? null : index)}
                      className="min-h-11 w-full px-4 py-3 text-start font-semibold"
                      aria-expanded={faqOpen === index}
                    >
                      {ar ? faq.ar : faq.en}
                    </button>
                    {faqOpen === index && (
                      <p className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300">
                        {ar ? faq.answerAr : faq.answerEn}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="mb-3 font-bold">{copy.newTicket}</h3>
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-semibold">{copy.subject}</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={160}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-transparent px-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">{copy.describe}</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-xl border border-slate-300 bg-transparent p-3 text-base"
                />
              </label>
              <button
                type="button"
                onClick={() => void createTicket()}
                disabled={busy || !subject.trim() || !message.trim()}
                className="mt-3 min-h-11 rounded-xl bg-amber-500 px-4 font-bold text-white disabled:opacity-50"
              >
                {copy.create}
              </button>
            </section>

            <section>
              <h3 className="mb-2 font-bold">{copy.tickets}</h3>
              {loading ? (
                <p role="status" className="text-sm text-slate-500">
                  {ar ? 'جارٍ التحميل…' : 'Loading…'}
                </p>
              ) : tickets.length === 0 ? (
                <p className="text-sm text-slate-500">{copy.empty}</p>
              ) : (
                <div className="space-y-2">
                  {tickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() =>
                        void loadDetail(ticket.id).catch(() => setError(copy.loadFail))
                      }
                      className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white p-4 text-start dark:border-slate-700 dark:bg-slate-800"
                    >
                      <span className="block font-semibold">{ticket.subject}</span>
                      <span className="text-xs text-slate-500">
                        {ticket.status === 'OPEN' ? copy.open : copy.closed}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
