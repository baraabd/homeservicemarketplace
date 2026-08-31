// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// Conversation list and thread.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLang } from '../../../i18n/LanguageContext';
import {
  useProviderConversations,
  useProviderMessages,
  useSendProviderMessage,
} from '../../../hooks/provider/useProviderChat';
import { formatRelativeTime } from '../../../../lib/provider/available-jobs-adapter';
import { formatPrivacyDisplayName } from '../../../../lib/privacy-name';
import { ArrowLeft, MessageCircle, Send } from 'lucide-react';

// ─── Provider chat screen (Sprint 5.5) ───────────────────────────────────────
// Two-pane: left lists conversations, right shows the active thread
// + send-message form. On mobile width the right pane is full-screen
// once a conversation is selected (the back arrow returns to the list).
export function ProviderChatScreen() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const conversationsQuery = useProviderConversations();
  const items = conversationsQuery.data?.items ?? [];

  // The open thread is the URL, not component state (Mode B).
  //
  // A conversation is the single most linkable thing in the workspace — "see
  // this thread" is what support and providers actually say to each other —
  // and it was the one thing that could not be linked to. It also means the
  // phone back gesture now closes a thread, which is what a phone user
  // expects, instead of leaving the workspace entirely.
  const { threadId } = useParams<{ threadId: string }>();
  const activeId = threadId ?? null;
  const openThread = (id: string) => navigate(`/provider/messages/${id}`);

  // When the list first arrives, open the most recent so the provider lands in
  // a thread without an extra tap. `replace` so it does not add a history
  // entry, and the ref makes it happen ONCE per mount — without that guard,
  // closing a thread would navigate back to the list and be bounced straight
  // into the newest thread again, making the back arrow look broken.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!threadId && items.length > 0) {
      autoSelectedRef.current = true;
      navigate(`/provider/messages/${items[0].id}`, { replace: true });
    }
  }, [items, threadId, navigate]);

  const L = {
    title: lang === 'ar' ? 'الدردشات' : 'Chats',
    empty:
      lang === 'ar'
        ? 'لا توجد محادثات بعد. ستظهر بعد قبول العرض.'
        : 'No conversations yet. They appear once a bid is accepted.',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading conversations…',
    failed: lang === 'ar' ? 'تعذّر تحميل المحادثات.' : 'Could not load conversations.',
    selectThread: lang === 'ar' ? 'اختر محادثة من القائمة.' : 'Pick a conversation to open it.',
  };

  return (
    <div className="absolute inset-0 flex bg-slate-50 dark:bg-slate-900 overflow-hidden">
      <aside
        className={`flex-shrink-0 w-full md:w-[320px] bg-white dark:bg-slate-800 border-e border-slate-100 dark:border-slate-700 flex flex-col ${
          activeId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="px-5 pt-5 pb-3">
          <h2
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '20px', fontWeight: 800 }}
          >
            {L.title}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <MessageCircle size={20} className="text-slate-300" />
              </div>
              <p role="status" className="text-slate-400" style={{ fontSize: '13px' }}>
                {conversationsQuery.isError
                  ? L.failed
                  : conversationsQuery.isPending
                    ? L.loading
                    : L.empty}
              </p>
            </div>
          ) : (
            items.map((conv) => {
              const isActive = conv.id === activeId;
              const previewText = conv.lastMessageBody ?? '';
              return (
                <button
                  type="button"
                  key={conv.id}
                  onClick={() => openThread(conv.id)}
                  className={`w-full text-start px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 active:bg-slate-50 transition-colors ${
                    isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">
                      {conv.otherParticipant?.initials || '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white truncate"
                        style={{ fontSize: '13px', fontWeight: 700 }}
                      >
                        {formatPrivacyDisplayName(
                          { displayName: conv.otherParticipant?.displayName ?? '' },
                          { roleFallback: lang === 'ar' ? 'مستخدم' : 'User' },
                        )}
                      </p>
                      <p
                        className="text-slate-500 dark:text-slate-400 truncate"
                        style={{ fontSize: '12px' }}
                      >
                        {previewText}
                      </p>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span
                        className="min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white flex items-center justify-center"
                        style={{ fontSize: '10px', fontWeight: 800 }}
                      >
                        {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>
      <section
        className={`flex-1 flex-col bg-slate-50 dark:bg-slate-900 ${
          activeId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {activeId ? (
          <ProviderChatThread
            conversationId={activeId}
            onBack={() => navigate('/provider/messages')}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center px-6">
            <p role="status" className="text-slate-400" style={{ fontSize: '13px' }}>
              {L.selectThread}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// Active thread (Sprint 5.5): polls /v1/provider/conversations/:id/
// messages every 4 s, sends new messages via the canonical send
// endpoint. Trims body, enforces 1..2000 chars on the client too so
// the user gets immediate feedback before the wire-side validator
// runs.
function ProviderChatThread({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const messagesQuery = useProviderMessages(conversationId);
  const sendMessage = useSendProviderMessage(conversationId);
  const [draft, setDraft] = useState('');
  const messages = messagesQuery.data?.items ?? [];
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom on every render so the freshly polled
  // tail is in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= 2000 && !sendMessage.isPending;

  const L = {
    placeholder: lang === 'ar' ? 'اكتب رسالة…' : 'Type a message…',
    send: lang === 'ar' ? 'إرسال' : 'Send',
    empty:
      lang === 'ar'
        ? 'ابدأ المحادثة بإرسال أول رسالة.'
        : 'Start the conversation by sending the first message.',
    loading: lang === 'ar' ? 'جارٍ تحميل الرسائل…' : 'Loading messages…',
    failed: lang === 'ar' ? 'تعذّر تحميل الرسائل.' : 'Could not load messages.',
    sendFailed: lang === 'ar' ? 'تعذّر إرسال الرسالة.' : 'Could not send the message.',
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    sendMessage.mutate(
      { body: trimmed },
      {
        onSuccess: () => setDraft(''),
      },
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center"
        >
          <ArrowLeft size={16} className="text-slate-500 rtl:rotate-180" />
        </button>
        <p className="text-slate-900 dark:text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
          {lang === 'ar' ? 'محادثة' : 'Conversation'}
        </p>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {messages.length === 0 ? (
          <p
            role="status"
            className="text-slate-400 text-center py-10"
            style={{ fontSize: '13px' }}
          >
            {messagesQuery.isError ? L.failed : messagesQuery.isPending ? L.loading : L.empty}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === 'PROVIDER';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-2 ${
                    mine
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-slate-700'
                  }`}
                >
                  {/* `body` is server-emitted text — React renders as text,
                      never HTML, so no XSS surface. */}
                  <p style={{ fontSize: '13px', lineHeight: 1.4 }}>{m.body}</p>
                  <p
                    className={`mt-1 ${mine ? 'text-blue-100' : 'text-slate-400'}`}
                    style={{ fontSize: '10px' }}
                  >
                    {formatRelativeTime(m.createdAt, lang)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 px-3 py-3 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={L.placeholder}
          maxLength={2000}
          aria-label={L.placeholder}
          className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-2.5 text-slate-900 dark:text-slate-100 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-300"
          style={{ fontSize: '13px' }}
        />
        <button
          type="submit"
          disabled={!canSend}
          className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
          aria-label={L.send}
        >
          <Send size={16} />
        </button>
      </form>
      {sendMessage.isError && (
        <p role="alert" className="text-red-600 text-center pb-2" style={{ fontSize: '12px' }}>
          {L.sendFailed}
        </p>
      )}
    </div>
  );
}
