import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Phone,
  Video,
  MoreVertical,
  Check,
  CheckCheck,
} from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  text: string;
  sender: 'user' | 'pro';
  time: string;
  read: boolean;
}

// ─── Seed messages ─────────────────────────────────────────────────────────────
const SEED_MESSAGES_EN: Message[] = [
  {
    id: 'm1',
    sender: 'pro',
    text: "Hello! I've reviewed your plumbing request. I can come today around 3 PM. Does that work for you?",
    time: '9:10 AM',
    read: true,
  },
  {
    id: 'm2',
    sender: 'user',
    text: 'Hi Omar! Yes, 3 PM works perfectly. The issue is under the kitchen sink.',
    time: '9:13 AM',
    read: true,
  },
  {
    id: 'm3',
    sender: 'pro',
    text: "Great! Could you send me a photo of the area? It'll help me bring the right parts.",
    time: '9:14 AM',
    read: true,
  },
  {
    id: 'm4',
    sender: 'user',
    text: 'Sure, just sent a photo through the app.',
    time: '9:16 AM',
    read: true,
  },
  {
    id: 'm5',
    sender: 'pro',
    text: "Perfect, I can see it. Looks like a standard P-trap issue. I'll bring the replacement parts. My rate is $35/hr. Shall I confirm the booking?",
    time: '9:18 AM',
    read: true,
  },
  {
    id: 'm6',
    sender: 'user',
    text: 'Yes please! Please confirm for 3 PM today.',
    time: '9:20 AM',
    read: true,
  },
  {
    id: 'm7',
    sender: 'pro',
    text: "Booking confirmed ✅ I'll send you a notification when I'm on my way. See you at 3!",
    time: '9:21 AM',
    read: true,
  },
  {
    id: 'm8',
    sender: 'pro',
    text: "I'm on my way now, ETA 15 minutes! 📍",
    time: '2:45 PM',
    read: false,
  },
];

const SEED_MESSAGES_AR: Message[] = [
  {
    id: 'm1',
    sender: 'pro',
    text: 'مرحباً! راجعت طلب السباكة الخاص بك. أستطيع الحضور اليوم حوالي الساعة 3 مساءً. هل يناسبك ذلك؟',
    time: '9:10 ص',
    read: true,
  },
  {
    id: 'm2',
    sender: 'user',
    text: 'مرحباً عمر! نعم، الساعة 3 مساءً مناسبة تماماً. المشكلة تحت حوض المطبخ.',
    time: '9:13 ص',
    read: true,
  },
  {
    id: 'm3',
    sender: 'pro',
    text: 'رائع! هل يمكنك إرسال صورة للمنطقة؟ سيساعدني ذلك على إحضار القطع المناسبة.',
    time: '9:14 ص',
    read: true,
  },
  {
    id: 'm4',
    sender: 'user',
    text: 'بالتأكيد، أرسلت صورة عبر التطبيق.',
    time: '9:16 ص',
    read: true,
  },
  {
    id: 'm5',
    sender: 'pro',
    text: 'ممتاز، أرى الصورة. يبدو أنها مشكلة في الفخ الصيفوني. سأحضر قطع الاستبدال. سعري 130 ريال/ساعة. هل تأكد الحجز؟',
    time: '9:18 ص',
    read: true,
  },
  {
    id: 'm6',
    sender: 'user',
    text: 'نعم من فضلك! أكّد الموعد الساعة 3 مساءً اليوم.',
    time: '9:20 ص',
    read: true,
  },
  {
    id: 'm7',
    sender: 'pro',
    text: 'تم تأكيد الحجز ✅ سأرسل لك إشعاراً عندما أكون في الطريق. إلى اللقاء الساعة 3!',
    time: '9:21 ص',
    read: true,
  },
  {
    id: 'm8',
    sender: 'pro',
    text: 'أنا في الطريق الآن، الوصول خلال 15 دقيقة! 📍',
    time: '2:45 م',
    read: false,
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface ChatScreenProps {
  contact: {
    name: string;
    initials: string;
    bg: string;
    textColor: string;
    status: string;
  };
  onBack: () => void;
  isVisible: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export function ChatScreen({ contact, onBack, isVisible }: ChatScreenProps) {
  const { t, dir, lang } = useLang();
  const seedMessages = lang === 'ar' ? SEED_MESSAGES_AR : SEED_MESSAGES_EN;
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset messages when language changes
  useEffect(() => {
    setMessages(lang === 'ar' ? SEED_MESSAGES_AR : SEED_MESSAGES_EN);
  }, [lang]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (isVisible) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages, isVisible]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setMessages((prev) => [
      ...prev,
      { id: `m${Date.now()}`, sender: 'user', text: input.trim(), time: timeStr, read: false },
    ]);
    setInput('');

    // Simulate pro reply
    setTimeout(() => {
      const reply =
        lang === 'ar'
          ? 'شكراً على رسالتك! سأرد عليك في أقرب وقت ممكن. 👍'
          : "Thanks for your message! I'll get back to you shortly. 👍";
      const replyTime = new Date().toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setMessages((prev) => [
        ...prev,
        { id: `m${Date.now()}`, sender: 'pro', text: reply, time: replyTime, read: false },
      ]);
    }, 1500);
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
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-slate-400" style={{ fontSize: '11px' }}>
                {contact.status}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center active:bg-slate-100 transition-all">
              <Phone size={16} className="text-slate-600" />
            </button>
            <button className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center active:bg-slate-100 transition-all">
              <Video size={16} className="text-slate-600" />
            </button>
            <button className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center active:bg-slate-100 transition-all">
              <MoreVertical size={16} className="text-slate-600" />
            </button>
          </div>
        </div>

        {/* Active job banner */}
        <div className="mx-4 mb-3 bg-amber-50 border border-amber-100 rounded-2xl px-3 py-2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
          <p className="text-amber-700" style={{ fontSize: '11px', fontWeight: 600 }}>
            {lang === 'ar'
              ? 'طلب نشط: إصلاح سباكة — اليوم الساعة 3 م'
              : 'Active Job: Plumbing Repair — Today 3:00 PM'}
          </p>
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
                      ? 'bg-amber-500 text-white rounded-[20px] rounded-br-[6px]'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-[20px] rounded-bl-[6px] shadow-sm'
                  }`}
                  style={{ fontSize: '14px', lineHeight: '1.5' }}
                >
                  {msg.text}
                </div>

                {/* Time + read receipt */}
                <div className={`flex items-center gap-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <span className="text-slate-400" style={{ fontSize: '10px' }}>
                    {msg.time}
                  </span>
                  {isUser &&
                    (msg.read ? (
                      <CheckCheck size={12} className="text-amber-500" />
                    ) : (
                      <Check size={12} className="text-slate-400" />
                    ))}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        <div className="flex items-end gap-2 mb-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mb-1"
            style={{ background: '#fef3c7' }}
          >
            <span className="text-amber-700" style={{ fontSize: '10px', fontWeight: 800 }}>
              {contact.initials}
            </span>
          </div>
          <div className="bg-white border border-slate-200 rounded-[20px] rounded-bl-[6px] shadow-sm px-4 py-3 flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
              />
            ))}
          </div>
        </div>

        <div ref={bottomRef} />
      </div>

      {/* ── Input Bar ── */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-end gap-3">
          {/* Emoji button */}
          <button className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-all">
            <span style={{ fontSize: '18px' }}>😊</span>
          </button>

          {/* Text area */}
          <div className="flex-1 bg-slate-100 rounded-2xl px-4 py-2.5 flex items-end gap-2 min-h-[44px]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('typeMessage')}
              rows={1}
              className="flex-1 bg-transparent outline-none text-slate-700 placeholder-slate-400 resize-none"
              style={{ fontSize: '14px', lineHeight: '1.5', maxHeight: '100px' }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={sendMessage}
            disabled={!input.trim()}
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
              input.trim() ? 'bg-amber-500 shadow-md shadow-amber-200' : 'bg-slate-200'
            }`}
          >
            <Send
              size={16}
              className={input.trim() ? 'text-white' : 'text-slate-400'}
              style={dir === 'rtl' ? { transform: 'scaleX(-1)' } : undefined}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
