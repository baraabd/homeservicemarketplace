import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Send,
  PhoneOff,
  Check,
  CheckCheck,
  Clock,
  Loader2,
} from 'lucide-react';
import type { MessageSummary } from '@homeservicemarketplace/contracts';
import { useLang } from '../../i18n/LanguageContext';
import { useMarkConversationRead, useMessages, useSendMessage } from '../../hooks/seeker/useChat';
import { keyForSend, type SendAttempt } from '../../../lib/chat/send-attempt';

// ─── Render shape ─────────────────────────────────────────────────────────────
// Slice 3.3 wires ChatScreen to GET /v1/me/conversations/:id/messages.
// The previous SEED_MESSAGES_EN / SEED_MESSAGES_AR constants and the
// 1.5s setTimeout fake provider reply have been removed entirely from
// the production path — there is no fabricated data on this surface.
//
// The render shape stays close to the slice-2 placeholder so every
// existing visual (bubble alignment, time strip, read receipt, typing
// indicator visual) renders without redesign.
interface RenderMessage {
  id: string;
  text: string;
  sender: 'user' | 'pro';
  time: string;
  read: boolean;
  // pendingId on optimistic rows — replaced when the server response
  // arrives; never persisted.
  pending?: boolean;
}

function apiToRender(row: MessageSummary, lang: 'en' | 'ar'): RenderMessage {
  const date = new Date(row.createdAt);
  const time = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
  return {
    id: row.id,
    text: row.body,
    sender: row.sentByMe ? 'user' : 'pro',
    time,
    // The contract doesn't expose a per-message read flag yet — it
    // ships at the conversation level via lastReadAt. We render
    // sender messages as "delivered" (single check) for now; a future
    // slice can reconcile this against the other participant's
    // lastReadAt.
    read: false,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface ChatScreenProps {
  // The conversation backing this chat panel. Slice 3.3 makes this
  // the single source of truth — when null/undefined, the screen
  // shows an empty state. There is no SEED fallback.
  conversationId: string | null | undefined;
  contact: {
    name: string;
    initials: string;
    bg: string;
    textColor: string;
  };
  onBack: () => void;
  isVisible: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export function ChatScreen({ conversationId, contact, onBack, isVisible }: ChatScreenProps) {
  const { t, dir, lang } = useLang();
  const langKey: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';

  const messagesQuery = useMessages(conversationId, { live: isVisible });
  const sendMut = useSendMessage(conversationId);
  const markReadMut = useMarkConversationRead(conversationId);

  const [pending, setPending] = useState<RenderMessage[]>([]);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  // R12 — the last send that has not been acknowledged, with its key.
  const unacknowledged = useRef<SendAttempt | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Server messages → render shape. Pending optimistic rows are
  // appended after the server-confirmed list so they always appear at
  // the bottom; they're removed once the corresponding server row
  // arrives (the response invalidates the messages query, which
  // triggers a refetch).
  const messages: RenderMessage[] = useMemo(() => {
    const rows = (messagesQuery.data?.items ?? []).map((m) => apiToRender(m, langKey));
    // R12 — pending rows are removed by their own outcome, never because some
    // server row has the same text: two identical messages are two messages.
    return [...rows, ...pending];
  }, [messagesQuery.data, pending, langKey]);

  const isInitialLoading = messagesQuery.isLoading && !messagesQuery.data;
  const isError = messagesQuery.isError && !messagesQuery.data;

  // Scroll to bottom on new message
  useEffect(() => {
    if (isVisible) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages, isVisible]);

  // Mark read whenever the newest server message on screen changes. R17: keyed
  // on that message's id, not the page length — once the newest page is full a
  // reply replaces its oldest row and the length no longer changes. The server
  // reads up to this message only, so anything that arrived after it stays
  // unread; the conversation list invalidation updates the badge.
  const newestShownId = messagesQuery.data?.items.at(-1)?.id;
  useEffect(() => {
    if (!isVisible || !conversationId || !newestShownId) return;
    markReadMut.mutate(newestShownId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, conversationId, newestShownId]);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || sendMut.isPending || !conversationId) return;
    setSendError(null);

    // Optimistic-pending row. Reconciled by the messages-list
    // invalidation that the mutation's onSuccess fires. If the send
    // fails, we drop the pending row + surface a safe error.
    const pendingId = `pending-${Date.now()}`;
    // The same text sent again after a failure is the same logical message.
    const idempotencyKey = keyForSend(unacknowledged.current, conversationId, trimmed);
    unacknowledged.current = { conversationId, body: trimmed, idempotencyKey };
    const now = new Date();
    const timeStr = now.toLocaleTimeString(langKey === 'ar' ? 'ar-SA' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setPending((prev) => [
      ...prev,
      { id: pendingId, sender: 'user', text: trimmed, time: timeStr, read: false, pending: true },
    ]);
    setInput('');

    sendMut.mutate(
      { body: trimmed, idempotencyKey },
      {
        onSuccess: () => {
          // The acknowledged row is in the cache now (useSendMessage).
          if (unacknowledged.current?.idempotencyKey === idempotencyKey)
            unacknowledged.current = null;
          setPending((prev) => prev.filter((r) => r.id !== pendingId));
        },
        onError: (err) => {
          setPending((prev) => prev.filter((r) => r.id !== pendingId));
          const status =
            (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
          if (status === 400) {
            setSendError(
              langKey === 'ar' ? 'لا يمكن إرسال رسالة فارغة.' : 'Empty message cannot be sent.',
            );
          } else if (status === 404) {
            setSendError(
              langKey === 'ar' ? 'لم يتم العثور على المحادثة.' : 'Conversation not found.',
            );
          } else {
            setSendError(
              langKey === 'ar'
                ? 'تعذر إرسال الرسالة. حاول مرة أخرى.'
                : "Couldn't send message. Please try again.",
            );
          }
          // Restore the input so the user can retry without retyping. Sending
          // it unchanged reuses the key, so a send that was stored but whose
          // reply was lost is not stored twice.
          setInput(trimmed);
        },
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div
      className="absolute inset-0 bg-white flex flex-col z-30 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{
        transform: isVisible
          ? 'translateX(0)'
          : dir === 'rtl'
            ? 'translateX(-100%)'
            : 'translateX(100%)',
      }}
    >
      {/* ── Header ── */}
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

          {/* Avatar */}
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${contact.bg}`}
          >
            <span className={contact.textColor} style={{ fontSize: '12px', fontWeight: 800 }}>
              {contact.initials}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-slate-900 truncate" style={{ fontSize: '15px', fontWeight: 700 }}>
              {contact.name}
            </p>
          </div>

          {/* R12 — calling is not available and no number is shown. The
              control says so instead of promising it. There is no presence
              information, so no "online" status, and the menu that did
              nothing is gone. docs/production-readiness/r12/COMMUNICATION_POLICY.md */}
          <button
            type="button"
            disabled
            aria-label={
              langKey === 'ar'
                ? 'المكالمات غير متاحة في التطبيق'
                : 'Calls aren’t available in the app'
            }
            title={
              langKey === 'ar'
                ? 'المكالمات غير متاحة في التطبيق'
                : 'Calls aren’t available in the app'
            }
            data-testid="chat-call-unavailable"
            className="w-11 h-11 rounded-xl bg-slate-50 flex items-center justify-center opacity-60 cursor-not-allowed"
          >
            <PhoneOff size={16} className="text-slate-600" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{
          scrollbarWidth: 'none',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        }}
      >
        {isInitialLoading ? (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={28} className="text-slate-400 animate-spin" />
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {langKey === 'ar' ? 'جاري تحميل المحادثة...' : 'Loading conversation...'}
            </p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" role="alert">
            <p className="text-slate-700 text-center" style={{ fontSize: '14px', fontWeight: 600 }}>
              {langKey === 'ar'
                ? 'تعذر تحميل المحادثة. حاول مرة أخرى.'
                : "We couldn't load this conversation. Please try again."}
            </p>
            <button
              onClick={() => messagesQuery.refetch()}
              className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {langKey === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : !conversationId ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {langKey === 'ar' ? 'لا توجد محادثة محددة' : 'No conversation selected'}
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-slate-500" style={{ fontSize: '13px' }}>
              {langKey === 'ar'
                ? 'ابدأ المحادثة بإرسال رسالة'
                : 'Start the conversation by sending a message'}
            </p>
          </div>
        ) : (
          <>
            {/* Date separator */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span
                className="text-slate-400 bg-white px-3 py-1 rounded-full border border-slate-200"
                style={{ fontSize: '11px', fontWeight: 500 }}
              >
                {t('today')}
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {messages.map((msg, idx) => {
              const isUser = msg.sender === 'user';
              const showAvatar = !isUser && (idx === 0 || messages[idx - 1].sender !== 'pro');

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Pro avatar */}
                  {!isUser && (
                    <div className="flex-shrink-0 mb-1" style={{ width: '32px' }}>
                      {showAvatar ? (
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center ${contact.bg}`}
                        >
                          <span
                            className={contact.textColor}
                            style={{ fontSize: '10px', fontWeight: 800 }}
                          >
                            {contact.initials}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div
                    className={`flex flex-col gap-0.5 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    {/* Bubble */}
                    <div
                      className={`px-4 py-2.5 transition-all ${
                        isUser
                          ? `bg-amber-500 text-white rounded-[20px] rounded-br-[6px] ${msg.pending ? 'opacity-70' : ''}`
                          : 'bg-white border border-slate-200 text-slate-800 rounded-[20px] rounded-bl-[6px] shadow-sm'
                      }`}
                      style={{ fontSize: '14px', lineHeight: '1.5' }}
                      dir="auto"
                    >
                      {msg.text}
                    </div>

                    {/* Time + read receipt */}
                    <div
                      className={`flex items-center gap-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}
                    >
                      <span className="text-slate-400" style={{ fontSize: '10px' }}>
                        {msg.time}
                      </span>
                      {/* R12: a message the server has not acknowledged says
                          so. Only an acknowledged one gets the check. */}
                      {isUser &&
                        (msg.pending ? (
                          <span
                            className="flex items-center gap-1 text-slate-500"
                            style={{ fontSize: '10px' }}
                            data-testid="chat-message-pending"
                          >
                            <Clock size={11} aria-hidden="true" />
                            {langKey === 'ar' ? 'جارٍ الإرسال…' : 'Sending…'}
                          </span>
                        ) : msg.read ? (
                          <CheckCheck size={12} className="text-amber-500" />
                        ) : (
                          <Check size={12} className="text-slate-400" />
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input Bar ── */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        {sendError && (
          <div
            className="mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700"
            style={{ fontSize: '12px', fontWeight: 600 }}
            role="alert"
          >
            {sendError}
          </div>
        )}
        <div className="flex items-end gap-3">
          {/* R12: the emoji button that opened nothing is gone. */}
          {/* Text area */}
          <div className="flex-1 bg-slate-100 rounded-2xl px-4 py-2.5 flex items-end gap-2 min-h-[44px]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('typeMessage')}
              aria-label={t('typeMessage')}
              data-testid="chat-input"
              dir="auto"
              rows={1}
              className="flex-1 bg-transparent outline-none text-slate-700 placeholder-slate-400 resize-none"
              style={{ fontSize: '16px', lineHeight: '1.5', maxHeight: '100px' }}
            />
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || sendMut.isPending || !conversationId}
            aria-label={langKey === 'ar' ? 'إرسال' : 'Send'}
            data-testid="chat-send"
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
              input.trim() && !sendMut.isPending && conversationId
                ? 'bg-amber-500 shadow-md shadow-amber-200'
                : 'bg-slate-200'
            }`}
          >
            <Send
              size={16}
              className={input.trim() && !sendMut.isPending ? 'text-white' : 'text-slate-400'}
              style={dir === 'rtl' ? { transform: 'scaleX(-1)' } : undefined}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
