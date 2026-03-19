import { useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Camera,
  Upload,
  MapPin,
  Calendar,
  Clock,
  CheckCircle2,
  Wrench,
  Wind,
  Hammer,
  Sparkles,
  WifiOff,
  Image as ImageIcon,
  FileText,
  ArrowRight,
  Zap,
  ChevronDown,
  Maximize2,
  PaintBucket,
} from 'lucide-react';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang } from '../../i18n/LanguageContext';

// ─── Service config ───────────────────────────────────────────────────────────
const SERVICE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  // English keys
  Plumbing: { icon: <Wrench size={20} />, color: 'text-blue-600', bg: 'bg-blue-100' },
  'AC Repair': { icon: <Wind size={20} />, color: 'text-cyan-600', bg: 'bg-cyan-100' },
  Carpentry: { icon: <Hammer size={20} />, color: 'text-orange-700', bg: 'bg-orange-100' },
  Cleaning: { icon: <Sparkles size={20} />, color: 'text-green-600', bg: 'bg-green-100' },
  Electrical: { icon: <Zap size={20} />, color: 'text-amber-600', bg: 'bg-amber-100' },
  Painting: { icon: <PaintBucket size={20} />, color: 'text-purple-600', bg: 'bg-purple-100' },
  General: { icon: <Wrench size={20} />, color: 'text-slate-600', bg: 'bg-slate-100' },
  // Arabic keys
  سباكة: { icon: <Wrench size={20} />, color: 'text-blue-600', bg: 'bg-blue-100' },
  تكييف: { icon: <Wind size={20} />, color: 'text-cyan-600', bg: 'bg-cyan-100' },
  نجارة: { icon: <Hammer size={20} />, color: 'text-orange-700', bg: 'bg-orange-100' },
  تنظيف: { icon: <Sparkles size={20} />, color: 'text-green-600', bg: 'bg-green-100' },
  كهرباء: { icon: <Zap size={20} />, color: 'text-amber-600', bg: 'bg-amber-100' },
  دهانات: { icon: <PaintBucket size={20} />, color: 'text-purple-600', bg: 'bg-purple-100' },
};

// ─── Mock Map ─────────────────────────────────────────────────────────────────
function MapPlaceholder({ label }: { label: string }) {
  return (
    <div
      className="w-full rounded-2xl overflow-hidden relative"
      style={{
        height: '180px',
        background: '#e8edf0',
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
      }}
    >
      {/* Roads */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute bg-white/80"
          style={{ top: '35%', left: 0, right: 0, height: '14px' }}
        />
        <div
          className="absolute bg-white/60"
          style={{ top: '68%', left: 0, right: 0, height: '8px' }}
        />
        <div
          className="absolute bg-white/80"
          style={{ left: '28%', top: 0, bottom: 0, width: '14px' }}
        />
        <div
          className="absolute bg-white/60"
          style={{ left: '65%', top: 0, bottom: 0, width: '8px' }}
        />
        {[
          { top: '6%', left: '4%', w: '22%', h: '26%' },
          { top: '6%', left: '44%', w: '18%', h: '26%' },
          { top: '6%', left: '72%', w: '24%', h: '26%' },
          { top: '50%', left: '4%', w: '20%', h: '20%' },
          { top: '50%', left: '44%', w: '18%', h: '18%' },
          { top: '50%', left: '72%', w: '24%', h: '22%' },
        ].map((b, i) => (
          <div
            key={i}
            className="absolute rounded"
            style={{
              top: b.top,
              left: b.left,
              width: b.w,
              height: b.h,
              background: `rgba(${190 + i * 3}, ${200 + i * 2}, 210, 0.6)`,
            }}
          />
        ))}
      </div>
      {/* Pin */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex flex-col items-center">
          <div className="absolute w-16 h-16 rounded-full bg-amber-500/20 animate-ping" />
          <div className="relative w-12 h-12 rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center z-10">
            <MapPin size={20} className="text-amber-600" />
          </div>
          <div className="w-1.5 h-3 bg-amber-500 rounded-b-full -mt-0.5 z-10" />
        </div>
      </div>
      {/* GPS label */}
      <div className="absolute top-3 inset-x-0 flex justify-center">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-xl px-3 py-1.5 shadow-sm">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-slate-600" style={{ fontSize: '11px', fontWeight: 600 }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Step Progress ────────────────────────────────────────────────────────────
function StepProgress({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: string[];
}) {
  return (
    <div className="px-5 py-4">
      <div className="h-1.5 bg-slate-100 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        {labels.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                i + 1 < current
                  ? 'bg-amber-500'
                  : i + 1 === current
                    ? 'bg-amber-500 ring-2 ring-amber-200'
                    : 'bg-slate-200'
              }`}
            >
              {i + 1 < current ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <span
                  className={i + 1 === current ? 'text-white' : 'text-slate-400'}
                  style={{ fontSize: '9px', fontWeight: 800 }}
                >
                  {i + 1}
                </span>
              )}
            </div>
            <span
              style={{
                fontSize: '10px',
                fontWeight: i + 1 === current ? 700 : 500,
                color: i + 1 <= current ? '#F59E0B' : '#94a3b8',
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface JobWizardModalProps {
  service: string;
  isOpen: boolean;
  onClose: () => void;
  isOffline: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export function JobWizardModal({ service, isOpen, onClose, isOffline }: JobWizardModalProps) {
  const { t, dir } = useLang();

  const [step, setStep] = useState(1);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState(
    t('address') === 'Address' ? 'Al Olaya District, Riyadh' : 'حي العليا، الرياض',
  );
  const [schedule, setSchedule] = useState<'asap' | 'later'>('asap');
  const [uploads, setUploads] = useState<string[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    dragY,
  } = useSwipe({
    onSwipeUp: () => setExpanded(true),
    onSwipeDown: () => setExpanded(false),
    threshold: 60,
  });

  const cfg = SERVICE_CONFIG[service] ?? SERVICE_CONFIG.General;

  const simulateUpload = () => {
    const colors = ['bg-blue-200', 'bg-amber-200', 'bg-green-200', 'bg-purple-200'];
    if (uploads.length < 4) setUploads((prev) => [...prev, colors[prev.length % colors.length]]);
  };

  const handlePost = () => {
    setIsPosting(true);
    setTimeout(() => {
      setIsPosting(false);
      setStep(3);
    }, 2000);
  };

  const handleClose = () => {
    setStep(1);
    setNotes('');
    setUploads([]);
    setSchedule('asap');
    onClose();
  };

  const stepLabels = [t('mediaAndBrief'), t('locationAndTime'), t('confirm')];

  const BackChevron = () =>
    dir === 'rtl' ? (
      <ChevronRight size={20} className="text-slate-700" />
    ) : (
      <ChevronLeft size={20} className="text-slate-700" />
    );

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col justify-end transition-all duration-300 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* Backdrop */}
      {step < 3 && (
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={expanded ? undefined : handleClose}
        />
      )}

      {/* Sheet */}
      <div
        className={`relative bg-white flex flex-col transition-all duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          step === 3 ? 'rounded-none h-full' : expanded ? 'rounded-none h-full' : 'rounded-t-3xl'
        } ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          maxHeight: step === 3 || expanded ? '100%' : '90vh',
          transform: isOpen ? `translateY(${Math.min(dragY * 0.15, 0)}px)` : 'translateY(100%)',
        }}
      >
        {step < 3 && (
          <div
            className="flex flex-col items-center pt-3 pb-0 flex-shrink-0 cursor-grab active:cursor-grabbing"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-12 h-1.5 rounded-full bg-slate-200 mb-1" />
            <div className="flex items-center gap-1 text-slate-400 pb-1">
              {expanded ? (
                <>
                  <ChevronDown size={12} />
                  <span style={{ fontSize: '10px' }}>{t('swipeDown')}</span>
                  <ChevronDown size={12} />
                </>
              ) : (
                <>
                  <Maximize2 size={10} />
                  <span style={{ fontSize: '10px' }}>{t('swipeUp')}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 1: MEDIA & BRIEF ────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cfg.bg}`}>
                  <span className={cfg.color}>{cfg.icon}</span>
                </div>
                <div>
                  <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
                    {t('postJob')}
                  </p>
                  <p className="text-slate-400" style={{ fontSize: '12px' }}>
                    {service}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center active:scale-90"
              >
                <X size={16} className="text-slate-600" />
              </button>
            </div>

            <StepProgress current={1} total={3} labels={stepLabels} />

            <div className="flex-1 overflow-y-auto px-5" style={{ scrollbarWidth: 'none' }}>
              {/* Upload zone */}
              <p className="text-slate-700 mb-2.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                {t('uploadPhotos')}
              </p>
              <button
                onClick={simulateUpload}
                className="w-full rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-6 flex flex-col items-center gap-3 text-center active:bg-amber-50 transition-all mb-3"
              >
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center">
                  <Camera size={24} className="text-amber-500" />
                </div>
                <div>
                  <p className="text-slate-700" style={{ fontSize: '13px', fontWeight: 600 }}>
                    {t('tapToUpload')}
                  </p>
                  <p className="text-slate-400 mt-0.5" style={{ fontSize: '11px' }}>
                    {t('uploadTypes')}
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500 text-white">
                  <Upload size={13} />
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>{t('browseFiles')}</span>
                </div>
              </button>

              {uploads.length > 0 && (
                <div className="flex gap-2 mb-4 flex-wrap">
                  {uploads.map((color, i) => (
                    <div
                      key={i}
                      className={`w-16 h-16 rounded-xl ${color} flex items-center justify-center relative`}
                    >
                      <ImageIcon size={20} className="text-white opacity-70" />
                      <button
                        onClick={() => setUploads((p) => p.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                  {uploads.length < 4 && (
                    <button
                      onClick={simulateUpload}
                      className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center active:bg-slate-50"
                    >
                      <span className="text-slate-400" style={{ fontSize: '22px', lineHeight: 1 }}>
                        +
                      </span>
                    </button>
                  )}
                </div>
              )}

              <div className="mb-4">
                <p className="text-slate-700 mb-2.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                  {t('describeTheProblem')}
                </p>
                <TextField
                  label={t('additionalNotes')}
                  value={notes}
                  onChange={setNotes}
                  leadingIcon={<FileText size={16} />}
                  hint={t('notesHint')}
                />
              </div>
              <div className="h-2" />
            </div>

            <div className="flex-shrink-0 border-t border-slate-100 px-5 py-4 bg-white">
              <Button
                variant="primary"
                fullWidth
                onClick={() => setStep(2)}
                leadingIcon={<ArrowRight size={16} />}
              >
                {t('nextStep')}
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 2: LOCATION & TIME ──────────────────────────────────────── */}
        {step === 2 && (
          <>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
              <button
                onClick={() => setStep(1)}
                className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center active:scale-90"
              >
                <BackChevron />
              </button>
              <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
                {t('locationAndTime')}
              </p>
              <button
                onClick={handleClose}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center active:scale-90"
              >
                <X size={16} className="text-slate-600" />
              </button>
            </div>

            <StepProgress current={2} total={3} labels={stepLabels} />

            <div className="flex-1 overflow-y-auto px-5" style={{ scrollbarWidth: 'none' }}>
              <p className="text-slate-700 mb-2.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                {t('serviceLocation')}
              </p>
              <MapPlaceholder label={t('gpsDetected')} />
              <div className="mt-3 mb-4">
                <TextField
                  label={t('address')}
                  value={address}
                  onChange={setAddress}
                  leadingIcon={<MapPin size={16} />}
                  hint={t('addressHint')}
                />
              </div>

              <p className="text-slate-700 mb-2.5" style={{ fontSize: '13px', fontWeight: 600 }}>
                {t('whenDoYouNeed')}
              </p>
              <div className="flex gap-2 mb-4">
                {(['asap', 'later'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSchedule(opt)}
                    className={`flex-1 py-3 rounded-2xl border-2 flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      schedule === opt
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${schedule === opt ? 'border-amber-500' : 'border-slate-300'}`}
                    >
                      {schedule === opt && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                    </div>
                    {opt === 'asap' ? (
                      <Clock
                        size={14}
                        className={schedule === opt ? 'text-amber-600' : 'text-slate-400'}
                      />
                    ) : (
                      <Calendar
                        size={14}
                        className={schedule === opt ? 'text-amber-600' : 'text-slate-400'}
                      />
                    )}
                    <span
                      style={{ fontSize: '13px', fontWeight: 700 }}
                      className={schedule === opt ? 'text-amber-700' : 'text-slate-500'}
                    >
                      {opt === 'asap' ? t('asap') : t('scheduleLater')}
                    </span>
                  </button>
                ))}
              </div>

              {schedule === 'later' && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 mb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p
                        className="text-slate-500 mb-2"
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {t('date')}
                      </p>
                      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                        <Calendar size={14} className="text-amber-500" />
                        <span
                          className="text-slate-700"
                          style={{ fontSize: '13px', fontWeight: 500 }}
                        >
                          {t('dateValue')}
                        </span>
                      </div>
                    </div>
                    <div>
                      <p
                        className="text-slate-500 mb-2"
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {t('time')}
                      </p>
                      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2.5">
                        <Clock size={14} className="text-amber-500" />
                        <span
                          className="text-slate-700"
                          style={{ fontSize: '13px', fontWeight: 500 }}
                        >
                          {t('timeValue')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {schedule === 'asap' && (
                <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0 animate-pulse" />
                  <p className="text-green-700" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                    {t('asapContext')}
                  </p>
                </div>
              )}
              <div className="h-2" />
            </div>

            <div className="flex-shrink-0 border-t border-slate-100 px-5 py-4 bg-white">
              <Button
                variant="primary"
                state={isPosting ? 'loading' : 'default'}
                fullWidth
                onClick={handlePost}
              >
                {t('confirmJob')}
              </Button>
            </div>
          </>
        )}

        {/* ── STEP 3: SUCCESS ───────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="flex-1 flex flex-col bg-white" style={{ minHeight: '100svh' }}>
            {isOffline && (
              <div className="flex items-center gap-3 bg-slate-900 px-5 py-3.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <WifiOff size={14} className="text-amber-400" />
                </div>
                <p
                  className="flex-1 text-white"
                  style={{ fontSize: '12px', fontWeight: 500, lineHeight: '1.4' }}
                >
                  {t('savedLocally')}
                </p>
                <button
                  onClick={handleClose}
                  className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center"
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            )}

            <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
              {/* Success icon */}
              <div className="relative mb-6">
                <div className="w-28 h-28 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 size={56} className="text-green-500" />
                </div>
                {[
                  { top: '0%', left: '15%', color: 'bg-amber-500', size: 'w-3 h-3' },
                  { top: '10%', left: '80%', color: 'bg-blue-500', size: 'w-2 h-2' },
                  { top: '75%', left: '5%', color: 'bg-green-400', size: 'w-2 h-2' },
                  { top: '85%', left: '78%', color: 'bg-orange-500', size: 'w-3 h-3' },
                  { top: '50%', left: '96%', color: 'bg-purple-500', size: 'w-2 h-2' },
                  { top: '20%', left: '95%', color: 'bg-amber-400', size: 'w-1.5 h-1.5' },
                ].map((dot, i) => (
                  <div
                    key={i}
                    className={`absolute rounded-full ${dot.color} ${dot.size}`}
                    style={{ top: dot.top, left: dot.left }}
                  />
                ))}
              </div>

              <h1 className="text-slate-900 mb-2" style={{ fontSize: '26px', fontWeight: 800 }}>
                {t('jobPosted')}
              </h1>
              <p
                className="text-slate-400 mb-8 max-w-[260px]"
                style={{ fontSize: '14px', lineHeight: '1.7' }}
              >
                {t('jobPosted').replace('! 🎉', '')} · {service}
              </p>

              {/* Summary */}
              <div className="w-full bg-slate-50 rounded-3xl border border-slate-200 p-4 mb-8 text-start">
                <p
                  className="text-slate-500 mb-3"
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('jobSummary')}
                </p>
                {[
                  { label: t('serviceLabel'), val: service },
                  { label: t('locationLabel'), val: address },
                  {
                    label: t('scheduleLabel'),
                    val:
                      schedule === 'asap' ? t('asapFull') : `${t('dateValue')} ${t('timeValue')}`,
                  },
                  {
                    label: t('statusLabel'),
                    val: isOffline ? t('savedLocally') : t('postedAndLive'),
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between py-2 border-b border-slate-100 last:border-0"
                  >
                    <span className="text-slate-400" style={{ fontSize: '12px' }}>
                      {row.label}
                    </span>
                    <span className="text-slate-900" style={{ fontSize: '12px', fontWeight: 600 }}>
                      {row.val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="w-full flex flex-col gap-3">
                <Button variant="primary" fullWidth onClick={handleClose}>
                  {t('backToHome')}
                </Button>
                <Button variant="secondary" fullWidth onClick={handleClose}>
                  {t('viewMyJobs')}
                </Button>
              </div>

              <div className="flex items-center gap-2 mt-6 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                <Clock size={14} className="text-amber-600 flex-shrink-0" />
                <p className="text-amber-700" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                  {t('bidsEta')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
