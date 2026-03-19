import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Calendar,
  Clock,
  MessageCircle,
  Phone,
  Navigation,
  CheckCircle2,
  MoreVertical,
  Wrench,
  Zap,
  Wind,
  Sparkles,
  Hammer,
  PaintBucket,
  Shield,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { LeadCardProps, LeadStatus } from './LeadCard';
import { useLang } from '../../i18n/LanguageContext';
import { useEcosystem } from '../../context/EcosystemContext';

// ─── Job data shape (superset of LeadCardProps + booking extras) ──────────────
export interface JobData {
  id: string;
  service: string;
  serviceAr?: string;
  status: LeadStatus;
  proName?: string;
  proInitials?: string;
  proRating?: number;
  proReviews?: number;
  proJobs?: number;
  proTags?: string[];
  postedAt: string;
  price?: number;
  bids?: number;
  date?: string;
  dateAr?: string;
  address?: string;
  addressAr?: string;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SERVICE_ICON: Record<string, React.ReactNode> = {
  Plumbing: <Wrench size={20} />,
  Electrical: <Zap size={20} />,
  'AC Repair': <Wind size={20} />,
  Cleaning: <Sparkles size={20} />,
  Carpentry: <Hammer size={20} />,
  Painting: <PaintBucket size={20} />,
  General: <Wrench size={20} />,
  // Arabic
  سباكة: <Wrench size={20} />,
  كهرباء: <Zap size={20} />,
  تكييف: <Wind size={20} />,
  تنظيف: <Sparkles size={20} />,
  نجارة: <Hammer size={20} />,
  دهانات: <PaintBucket size={20} />,
};

const SERVICE_COLOR: Record<string, { bg: string; icon: string }> = {
  Plumbing: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  Electrical: { bg: 'bg-amber-100', icon: 'text-amber-600' },
  'AC Repair': { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
  Cleaning: { bg: 'bg-green-100', icon: 'text-green-600' },
  Carpentry: { bg: 'bg-orange-100', icon: 'text-orange-700' },
  Painting: { bg: 'bg-purple-100', icon: 'text-purple-600' },
  General: { bg: 'bg-slate-100', icon: 'text-slate-600' },
  سباكة: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  كهرباء: { bg: 'bg-amber-100', icon: 'text-amber-600' },
  تكييف: { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
  تنظيف: { bg: 'bg-green-100', icon: 'text-green-600' },
  نجارة: { bg: 'bg-orange-100', icon: 'text-orange-700' },
  دهانات: { bg: 'bg-purple-100', icon: 'text-purple-600' },
};

// ─── Status Timeline ──────────────────────────────────────────────────────────
function StatusTimeline({ status, lang }: { status: LeadStatus; lang: string }) {
  const steps = [
    {
      en: 'Posted',
      ar: 'تم النشر',
      doneAt: '9:00 AM',
      doneFills: ['pending', 'active', 'completed', 'cancelled'],
    },
    {
      en: 'Bids Received',
      ar: 'وصلت عروض',
      doneAt: '9:15 AM',
      doneFills: ['active', 'completed'],
    },
    {
      en: 'Pro Assigned',
      ar: 'تعيين محترف',
      doneAt: '9:32 AM',
      doneFills: ['active', 'completed'],
    },
    {
      en: 'In Progress',
      ar: 'جارٍ التنفيذ',
      doneAt: '3:00 PM',
      doneFills: ['active', 'completed'],
    },
    {
      en: 'Completed',
      ar: 'مكتمل',
      doneAt: '5:10 PM',
      doneFills: ['completed'],
    },
  ];

  const activeIndex =
    status === 'completed' ? 4 : status === 'active' ? 3 : status === 'pending' ? 0 : 0;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
      <p
        className="text-slate-500 mb-4"
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {lang === 'ar' ? 'مراحل الطلب' : 'Job Progress'}
      </p>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute start-[18px] top-4 bottom-4 w-0.5 bg-slate-100 z-0" />

        {steps.map((step, i) => {
          const isDone = step.doneFills.includes(status);
          const isCurrent = i === activeIndex;

          return (
            <div key={i} className="relative flex items-start gap-4 mb-4 last:mb-0 z-10">
              {/* Circle */}
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                  isDone
                    ? 'bg-amber-500 border-amber-500 shadow-sm shadow-amber-200'
                    : isCurrent
                      ? 'bg-white border-amber-500 ring-2 ring-amber-100'
                      : 'bg-slate-100 border-slate-200'
                }`}
              >
                {isDone ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : isCurrent ? (
                  <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                )}
              </div>

              {/* Label + time */}
              <div className="flex-1 pt-1.5">
                <div className="flex items-center justify-between">
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: isDone || isCurrent ? 700 : 400,
                      color: isDone ? '#0f172a' : isCurrent ? '#F59E0B' : '#94a3b8',
                    }}
                  >
                    {lang === 'ar' ? step.ar : step.en}
                  </span>
                  {isDone && (
                    <span className="text-slate-400" style={{ fontSize: '10px' }}>
                      {step.doneAt}
                    </span>
                  )}
                </div>
                {isCurrent && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-amber-600" style={{ fontSize: '11px', fontWeight: 500 }}>
                      {lang === 'ar' ? 'الحالة الحالية' : 'Current status'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rating Stars ──────────────────────────────────────────────────────────────
function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill={s <= Math.round(rating) ? '#F59E0B' : 'none'}
          stroke={s <= Math.round(rating) ? '#F59E0B' : '#CBD5E1'}
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface JobDetailViewProps {
  job: JobData;
  isVisible: boolean;
  onBack: () => void;
  onOpenChat: (contact: {
    name: string;
    initials: string;
    bg: string;
    textColor: string;
    status: string;
  }) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function JobDetailView({ job, isVisible, onBack, onOpenChat }: JobDetailViewProps) {
  const { lang, dir } = useLang();
  const { showHourlyRate } = useEcosystem();
  const [showRateModal, setShowRateModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  const svc = SERVICE_COLOR[job.service] ?? SERVICE_COLOR.General;
  const ico = SERVICE_ICON[job.service] ?? SERVICE_ICON.General;

  const displayService = lang === 'ar' && job.serviceAr ? job.serviceAr : job.service;
  const displayAddress =
    lang === 'ar' && job.addressAr
      ? job.addressAr
      : (job.address ?? (lang === 'ar' ? 'حي العليا، الرياض' : 'Al Olaya District, Riyadh'));
  const displayDate =
    lang === 'ar' && job.dateAr
      ? job.dateAr
      : (job.date ?? (lang === 'ar' ? 'اليوم، 3:00 م' : 'Today, 3:00 PM'));

  const statusColor =
    job.status === 'active'
      ? 'bg-blue-50 border-blue-200 text-blue-700'
      : job.status === 'pending'
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : job.status === 'completed'
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-red-50 border-red-200 text-red-700';

  const statusLabel =
    job.status === 'active'
      ? lang === 'ar'
        ? 'جارٍ التنفيذ'
        : 'In Progress'
      : job.status === 'pending'
        ? lang === 'ar'
          ? 'قيد الانتظار'
          : 'Awaiting Bids'
        : job.status === 'completed'
          ? lang === 'ar'
            ? 'مكتمل'
            : 'Completed'
          : lang === 'ar'
            ? 'ملغى'
            : 'Cancelled';

  const handleRateSubmit = () => {
    setRatingSubmitted(true);
    setTimeout(() => setShowRateModal(false), 1500);
  };

  return (
    <>
      {/* ── Slide-in panel ── */}
      <div
        className="absolute inset-0 bg-slate-50 flex flex-col z-20 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
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

            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${svc.bg}`}
            >
              <span className={svc.icon}>{ico}</span>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-slate-900 truncate" style={{ fontSize: '15px', fontWeight: 800 }}>
                {displayService}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                #{lang === 'ar' ? 'JOB' : 'JOB'}-{job.id.toUpperCase()} · {job.postedAt}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-full border ${statusColor}`}
                style={{ fontSize: '10px', fontWeight: 700 }}
              >
                {statusLabel}
              </span>
              <button className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center active:scale-90">
                <MoreVertical size={15} className="text-slate-400" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
          style={{ scrollbarWidth: 'none' }}
        >
          {/* Status banner for active jobs */}
          {job.status === 'active' && (
            <div className="bg-blue-500 rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <p className="text-white flex-1" style={{ fontSize: '13px', fontWeight: 600 }}>
                {lang === 'ar'
                  ? 'المحترف في طريقه إليك — وقت الوصول ≈ 15 دقيقة'
                  : 'Pro is on the way — ETA ~15 minutes'}
              </p>
              <Navigation size={16} className="text-white flex-shrink-0" />
            </div>
          )}

          {/* Pro Card */}
          {job.proName && (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <p
                className="text-slate-500 mb-3"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {lang === 'ar' ? 'المحترف المعيّن' : 'Assigned Professional'}
              </p>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-700" style={{ fontSize: '16px', fontWeight: 800 }}>
                    {job.proInitials ?? job.proName.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
                    {job.proName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Stars rating={job.proRating ?? 4.8} />
                    <span className="text-slate-500" style={{ fontSize: '11px' }}>
                      {job.proRating ?? 4.8} · {job.proReviews ?? 156}{' '}
                      {lang === 'ar' ? 'تقييم' : 'reviews'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <Shield size={11} className="text-green-500" />
                    <span className="text-green-600" style={{ fontSize: '10px', fontWeight: 600 }}>
                      {lang === 'ar' ? 'موثّق ومرخّص' : 'Verified & Licensed'}
                    </span>
                  </div>
                </div>
                {showHourlyRate && job.price && (
                  <div className="text-end">
                    <p className="text-slate-900" style={{ fontSize: '20px', fontWeight: 800 }}>
                      ${job.price}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      /hr
                    </p>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {(job.proTags ?? ['Licensed', 'Insured', 'Top Rated']).map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() =>
                    onOpenChat({
                      name: job.proName!,
                      initials: job.proInitials ?? job.proName!.slice(0, 2).toUpperCase(),
                      bg: 'bg-amber-100',
                      textColor: 'text-amber-700',
                      status: 'Online',
                    })
                  }
                  className="flex flex-col items-center gap-1.5 py-3 bg-amber-50 border border-amber-100 rounded-2xl active:scale-95 transition-all"
                >
                  <MessageCircle size={18} className="text-amber-600" />
                  <span className="text-amber-700" style={{ fontSize: '11px', fontWeight: 700 }}>
                    {lang === 'ar' ? 'رسالة' : 'Message'}
                  </span>
                </button>
                <button className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 border border-blue-100 rounded-2xl active:scale-95 transition-all">
                  <Phone size={18} className="text-blue-600" />
                  <span className="text-blue-700" style={{ fontSize: '11px', fontWeight: 700 }}>
                    {lang === 'ar' ? 'اتصال' : 'Call'}
                  </span>
                </button>
                <button className="flex flex-col items-center gap-1.5 py-3 bg-green-50 border border-green-100 rounded-2xl active:scale-95 transition-all">
                  <Navigation size={18} className="text-green-600" />
                  <span className="text-green-700" style={{ fontSize: '11px', fontWeight: 700 }}>
                    {lang === 'ar' ? 'تتبع' : 'Track'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Status Timeline */}
          <StatusTimeline status={job.status} lang={lang} />

          {/* Job Details */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
            <p
              className="text-slate-500 mb-3"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {lang === 'ar' ? 'تفاصيل الطلب' : 'Job Details'}
            </p>
            {[
              { Icon: Wrench, label: lang === 'ar' ? 'الخدمة' : 'Service', val: displayService },
              { Icon: MapPin, label: lang === 'ar' ? 'الموقع' : 'Location', val: displayAddress },
              { Icon: Calendar, label: lang === 'ar' ? 'الموعد' : 'Schedule', val: displayDate },
              { Icon: Clock, label: lang === 'ar' ? 'نُشر منذ' : 'Posted', val: job.postedAt },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0"
              >
                <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <row.Icon size={13} className="text-slate-500" />
                </div>
                <span className="text-slate-400 w-20 flex-shrink-0" style={{ fontSize: '12px' }}>
                  {row.label}
                </span>
                <span
                  className="text-slate-900 flex-1"
                  style={{ fontSize: '12px', fontWeight: 600 }}
                >
                  {row.val}
                </span>
              </div>
            ))}
          </div>

          {/* Price Breakdown */}
          {showHourlyRate && job.price && (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
              <p
                className="text-slate-500 mb-3"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {lang === 'ar' ? 'تفاصيل السعر' : 'Price Breakdown'}
              </p>
              {[
                { label: lang === 'ar' ? 'سعر الساعة' : 'Hourly rate', val: `$${job.price}/hr` },
                {
                  label: lang === 'ar' ? 'المدة التقديرية' : 'Est. duration',
                  val: lang === 'ar' ? '2 ساعة' : '~2 hours',
                },
                {
                  label: lang === 'ar' ? 'رسوم الخدمة (5%)' : 'Service fee (5%)',
                  val: `$${Math.round(job.price * 0.1)}`,
                },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                >
                  <span className="text-slate-500" style={{ fontSize: '12px' }}>
                    {row.label}
                  </span>
                  <span className="text-slate-700" style={{ fontSize: '12px', fontWeight: 600 }}>
                    {row.val}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 mt-1 border-t-2 border-slate-100">
                <span className="text-slate-900" style={{ fontSize: '14px', fontWeight: 700 }}>
                  {lang === 'ar' ? 'الإجمالي التقديري' : 'Est. Total'}
                </span>
                <span className="text-amber-600" style={{ fontSize: '20px', fontWeight: 800 }}>
                  ~${job.price * 2 + Math.round(job.price * 0.1)}
                </span>
              </div>
            </div>
          )}

          {/* Rate & Review (for completed jobs) */}
          {job.status === 'completed' && !ratingSubmitted && (
            <button
              onClick={() => setShowRateModal(true)}
              className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-3xl p-4 flex items-center gap-3 active:scale-95 transition-all"
            >
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <ThumbsUp size={18} className="text-white" />
              </div>
              <div className="flex-1 text-start">
                <p className="text-white" style={{ fontSize: '14px', fontWeight: 800 }}>
                  {lang === 'ar' ? 'كيف كانت تجربتك؟' : 'How was your experience?'}
                </p>
                <p className="text-white/70" style={{ fontSize: '12px' }}>
                  {lang === 'ar'
                    ? 'اترك تقييماً لمساعدة المحترفين الآخرين'
                    : 'Leave a review to help other pros'}
                </p>
              </div>
              <ChevronRight size={18} className="text-white/60 rtl:rotate-180" />
            </button>
          )}

          {ratingSubmitted && (
            <div className="bg-green-50 border border-green-200 rounded-3xl p-4 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-500" />
              <p className="text-green-700" style={{ fontSize: '13px', fontWeight: 600 }}>
                {lang === 'ar' ? 'شكراً على تقييمك! 🌟' : 'Thanks for your review! 🌟'}
              </p>
            </div>
          )}

          {/* Cancel option (pending only) */}
          {job.status === 'pending' && (
            <button className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-200 text-red-500 active:bg-red-50 transition-all">
              <XCircle size={15} />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>
                {lang === 'ar' ? 'إلغاء الطلب' : 'Cancel Request'}
              </span>
            </button>
          )}

          <div className="h-2" />
        </div>
      </div>

      {/* ── Rate Modal ── */}
      {showRateModal && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowRateModal(false)}
          />
          <div className="relative bg-white rounded-t-3xl px-6 py-6">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" />
            <div className="flex flex-col items-center text-center gap-2 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-2">
                <span className="text-amber-700" style={{ fontSize: '20px', fontWeight: 800 }}>
                  {job.proInitials ?? 'OK'}
                </span>
              </div>
              <p className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
                {lang === 'ar'
                  ? `كيف كانت تجربتك مع ${job.proName}؟`
                  : `Rate your experience with ${job.proName}`}
              </p>
              <p className="text-slate-400" style={{ fontSize: '13px' }}>
                {lang === 'ar' ? 'اضغط على النجوم للتقييم' : 'Tap to rate'}
              </p>
            </div>

            {/* Stars */}
            <div className="flex justify-center gap-3 mb-6">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedRating(s)}
                  className="active:scale-90 transition-all"
                >
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill={s <= selectedRating ? '#F59E0B' : 'none'}
                    stroke={s <= selectedRating ? '#F59E0B' : '#CBD5E1'}
                    strokeWidth="1.5"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
              ))}
            </div>

            {selectedRating > 0 && (
              <div className="mb-4">
                <textarea
                  placeholder={
                    lang === 'ar' ? 'أضف تعليقاً (اختياري)…' : 'Add a comment (optional)…'
                  }
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 outline-none text-slate-700 placeholder-slate-400 resize-none"
                  style={{ fontSize: '13px' }}
                />
              </div>
            )}

            <button
              onClick={handleRateSubmit}
              disabled={selectedRating === 0}
              className={`w-full py-4 rounded-2xl transition-all active:scale-95 ${
                selectedRating > 0
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200'
                  : 'bg-slate-100 text-slate-400'
              }`}
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {lang === 'ar' ? 'إرسال التقييم' : 'Submit Review'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Converter: LeadCardProps → JobData ───────────────────────────────────────
export function leadToJobData(lead: LeadCardProps): JobData {
  return {
    id: lead.id,
    service: lead.service,
    status: lead.status,
    proName: lead.proName,
    proInitials: lead.proInitials,
    proRating: 4.8,
    proReviews: 156,
    proJobs: 220,
    proTags: ['Licensed', 'Insured', 'Top Rated'],
    postedAt: lead.postedAt,
    price: lead.price,
    bids: lead.bids,
  };
}
