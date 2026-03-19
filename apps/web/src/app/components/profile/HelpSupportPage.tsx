import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Check,
  CheckCheck,
  HelpCircle,
  CreditCard,
  Clock,
  Star,
  X,
} from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';

interface Message {
  id: string;
  from: 'bot' | 'user';
  text: string;
  time: string;
  read: boolean;
}

type FAQ = { en: string; ar: string };

const FAQS: FAQ[] = [
  { en: 'How do I cancel a booking?', ar: 'كيف أُلغي الحجز؟' },
  { en: 'When do pros get paid?', ar: 'متى يحصل المحترفون على المدفوعات؟' },
  { en: 'How is the price calculated?', ar: 'كيف يُحسب السعر؟' },
  { en: "What if I'm not satisfied?", ar: 'ماذا لو لم أكن راضياً؟' },
];

const BOT_REPLIES: Record<string, { en: string; ar: string }> = {
  cancel: {
    en: 'You can cancel a booking up to 2 hours before the scheduled time from the Bookings tab. Late cancellations may incur a fee.',
    ar: 'يمكنك إلغاء الحجز قبل ساعتين من الموعد المحدد من تبويب الحجوزات. قد تُفرض رسوم على الإلغاء المتأخر.',
  },
  paid: {
    en: 'Professionals receive payment within 24 hours of job completion after the customer confirms. We use secure bank transfers.',
    ar: 'يحصل المحترفون على المدفوعات خلال 24 ساعة من اكتمال العمل بعد تأكيد العميل. نستخدم تحويلات بنكية آمنة.',
  },
  price: {
    en: "Pricing is based on the pro's hourly rate. You'll always see the total estimate before confirming a booking.",
    ar: 'يعتمد التسعير على السعر بالساعة للمحترف. ستتمكن دائماً من رؤية التقدير الكلي قبل تأكيد الحجز.',
  },
  satisfied: {
    en: "Your satisfaction is our priority! If you're not happy, contact us within 48 hours and we'll arrange a re-service or full refund.",
    ar: 'رضاك أولويتنا! إذا لم تكن راضياً، تواصل معنا خلال 48 ساعة وسنرتب لك خدمة مجانية أو استرداداً كاملاً.',
  },
  default: {
    en: 'Thanks for reaching out! A support agent will respond shortly. Our usual response time is under 5 minutes. 🙂',
    ar: 'شكراً للتواصل! سيرد عليك أحد فريق الدعم قريباً. وقت استجابتنا المعتاد أقل من 5 دقائق. 🙂',
  },
};

function getBotReply(text: string, lang: string): string {
  const lower = text.toLowerCase();
  const key =
    lower.includes('cancel') || lower.includes('إلغ')
      ? 'cancel'
      : lower.includes('paid') || lower.includes('مدفو')
        ? 'paid'
        : lower.includes('price') || lower.includes('سعر')
          ? 'price'
          : lower.includes('satisf') || lower.includes('راض')
            ? 'satisfied'
            : 'default';
  return BOT_REPLIES[key][lang as 'en' | 'ar'];
}

function now() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const SEED_EN: Message[] = [
  {
    id: 'b0',
    from: 'bot',
    text: "👋 Hi Ahmed! I'm your FixNow Support assistant. How can I help you today?",
    time: '9:00 AM',
    read: true,
  },
  {
    id: 'b1',
    from: 'bot',
    text: 'You can ask me about bookings, payments, how the platform works, or anything else!',
    time: '9:00 AM',
    read: true,
  },
];
const SEED_AR: Message[] = [
  {
    id: 'b0',
    from: 'bot',
    text: '👋 مرحباً أحمد! أنا مساعد دعم فيكس ناو. كيف يمكنني مساعدتك اليوم؟',
    time: '9:00 ص',
    read: true,
  },
  {
    id: 'b1',
    from: 'bot',
    text: 'يمكنك سؤالي عن الحجوزات، المدفوعات، كيفية عمل المنصة، أو أي شيء آخر!',
    time: '9:00 ص',
    read: true,
  },
];

interface HelpSupportPageProps {
  onBack: () => void;
}

export function HelpSupportPage({ onBack }: HelpSupportPageProps) {
  const { lang, dir } = useLang();
  const [messages, setMessages] = useState<Message[]>(lang === 'ar' ? SEED_AR : SEED_EN);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(lang === 'ar' ? SEED_AR : SEED_EN);
  }, [lang]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  }, [messages, typing]);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: `u${Date.now()}`,
      from: 'user',
      text: text.trim(),
      time: now(),
      read: false,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `b${Date.now()}`,
          from: 'bot',
          text: getBotReply(text, lang),
          time: now(),
          read: false,
        },
      ]);
    }, 1400);
  };

  const L = {
    title: lang === 'ar' ? 'المساعدة والدعم' : 'Help & Support',
    online: lang === 'ar' ? 'متصل' : 'Online',
    support: lang === 'ar' ? 'دعم فيكس ناو' : 'FixNow Support',
    today: lang === 'ar' ? 'اليوم' : 'Today',
    placeholder: lang === 'ar' ? 'اكتب سؤالك…' : 'Type your question…',
    faqTitle: lang === 'ar' ? 'أسئلة شائعة' : 'Quick Questions',
    rateChat: lang === 'ar' ? 'كيف كانت تجربتك مع الدعم؟' : 'How was your support experience?',
    thankRate: lang === 'ar' ? 'شكراً على تقييمك! 🌟' : 'Thank you for rating! 🌟',
  };

  const FAQ_ICONS = [
    <HelpCircle size={13} />,
    <CreditCard size={13} />,
    <Clock size={13} />,
    <Star size={13} />,
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900"
      initial={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      animate={{ x: 0 }}
      exit={{ x: dir === 'rtl' ? '-100%' : '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
          >
            {dir === 'rtl' ? (
              <ChevronRight size={20} className="text-slate-700 dark:text-slate-300" />
            ) : (
              <ChevronLeft size={20} className="text-slate-700 dark:text-slate-300" />
            )}
          </button>

          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
              FN
            </span>
          </div>

          <div className="flex-1">
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {L.support}
            </p>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-slate-400 dark:text-slate-500" style={{ fontSize: '11px' }}>
                {L.online}
              </span>
            </div>
          </div>
        </div>

        {/* Quick FAQ chips */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {FAQS.map((faq, i) => (
            <button
              key={i}
              onClick={() => sendMessage(lang === 'ar' ? faq.ar : faq.en)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-100 dark:border-amber-800 flex-shrink-0 active:bg-amber-100 transition-all"
            >
              <span className="text-amber-600 dark:text-amber-400">{FAQ_ICONS[i]}</span>
              <span
                className="text-amber-700 dark:text-amber-300"
                style={{ fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {lang === 'ar' ? faq.ar : faq.en}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{
          scrollbarWidth: 'none',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        }}
      >
        {/* Date separator */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          <span
            className="text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700"
            style={{ fontSize: '11px' }}
          >
            {L.today}
          </span>
          <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        </div>

        {messages.map((msg) => {
          const isUser = msg.from === 'user';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-end gap-2 mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mb-1 bg-gradient-to-br from-amber-400 to-orange-500">
                  <span className="text-white" style={{ fontSize: '10px', fontWeight: 800 }}>
                    FN
                  </span>
                </div>
              )}
              <div
                className={`max-w-[78%] flex flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`px-4 py-2.5 ${
                    isUser
                      ? 'bg-amber-500 text-white rounded-[20px] rounded-br-[6px]'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-[20px] rounded-bl-[6px] shadow-sm'
                  }`}
                  style={{ fontSize: '13px', lineHeight: '1.5' }}
                >
                  {msg.text}
                </div>
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
            </motion.div>
          );
        })}

        {/* Typing indicator */}
        {typing && (
          <div className="flex items-end gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-1">
              <span className="text-white" style={{ fontSize: '10px', fontWeight: 800 }}>
                FN
              </span>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-[20px] rounded-bl-[6px] shadow-sm px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Rate support */}
        {messages.length > 4 && !rated && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-3 mb-3">
            <p
              className="text-slate-600 dark:text-slate-300 text-center mb-2"
              style={{ fontSize: '12px' }}
            >
              {L.rateChat}
            </p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setRating(s);
                    setRated(true);
                  }}
                  className="active:scale-90 transition-all"
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill={s <= rating ? '#F59E0B' : 'none'}
                    stroke={s <= rating ? '#F59E0B' : '#CBD5E1'}
                    strokeWidth="1.5"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
        {rated && (
          <div className="flex items-center justify-center gap-2 bg-green-50 dark:bg-green-900/20 rounded-2xl py-3 mb-3 border border-green-100 dark:border-green-800">
            <span
              className="text-green-600 dark:text-green-400"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {L.thankRate}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-end gap-3">
          <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-2.5 flex items-end gap-2 min-h-[44px]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={L.placeholder}
              rows={1}
              className="flex-1 bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none"
              style={{ fontSize: '14px', lineHeight: '1.5', maxHeight: '100px' }}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-all ${
              input.trim()
                ? 'bg-amber-500 shadow-md shadow-amber-200'
                : 'bg-slate-200 dark:bg-slate-600'
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
    </motion.div>
  );
}
