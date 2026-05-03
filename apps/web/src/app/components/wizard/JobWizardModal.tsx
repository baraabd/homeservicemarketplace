import { useEffect, useMemo, useState } from 'react';
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
  Navigation,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang } from '../../i18n/LanguageContext';
import { useAddresses } from '../../hooks/seeker/useAddresses';
import { useCreateServiceRequest } from '../../hooks/seeker/useRequests';
import { reverseGeocode } from '../../../lib/reverse-geocode';

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

// ─── Extracted Components (Moved outside to prevent re-creation during render) ─
const BackChevron = ({ dir }: { dir: string }) =>
  dir === 'rtl' ? (
    <ChevronRight size={20} className="text-slate-700" />
  ) : (
    <ChevronLeft size={20} className="text-slate-700" />
  );

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Build an ISO datetime string from the user's local-date + local-time
// inputs. The browser's HTML5 inputs return strings in local-time
// format (`YYYY-MM-DD` and `HH:MM`); we combine them and let the
// Date constructor interpret them as local time, then ship the UTC
// ISO string to the backend.
function combineLocalDateTimeToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  // Modern browsers parse "YYYY-MM-DDTHH:MM" as LOCAL time (not UTC),
  // which is what we want.
  const local = new Date(`${date}T${time}`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

// Today as YYYY-MM-DD in the browser's local timezone, used as the
// `min` attribute on the date input so past calendar days are
// disabled at the picker level.
function todayLocalDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Comma-split heuristic — same as SavedAddressesPage's. Used when the
// user typed/edited the address text and we cannot use the saved
// addressId path.
function splitFullAddress(full: string): {
  line1: string;
  city: string;
  country: string;
} {
  const parts = full
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length >= 3) {
    const country = parts.pop() as string;
    const city = parts.pop() as string;
    const line1 = parts.join(', ');
    return { line1, city, country };
  }
  if (parts.length === 2) {
    return { line1: parts[0], city: parts[1], country: parts[1] };
  }
  const single = parts[0] ?? full.trim();
  return {
    line1: single,
    city: single,
    country: single.length >= 2 ? single : `${single}.`,
  };
}

// ─── Geolocation state machine ────────────────────────────────────────────────
type GeoState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; lat: number; lng: number }
  | { status: 'error'; reason: 'denied' | 'unsupported' | 'failed' };

// ─── Props ────────────────────────────────────────────────────────────────────
interface JobWizardModalProps {
  service: string;
  // Backend ServiceCategory.id for the selected service. Optional so
  // existing call sites that haven't been wired yet still compile —
  // when null/undefined the wizard posts a free-form request using
  // `service` as customServiceText.
  categoryId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  isOffline: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export function JobWizardModal({
  service,
  categoryId,
  isOpen,
  onClose,
  isOffline,
}: JobWizardModalProps) {
  const { t, dir, lang } = useLang();
  const langKey: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';

  const [step, setStep] = useState(1);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [schedule, setSchedule] = useState<'asap' | 'later'>('asap');
  // Slice 4.1 fix (defect: static "Mar 15, 2026" / "10:00 AM"): the
  // user now picks real date + time via HTML5 inputs. The two pieces
  // are stored separately so the inputs are controlled cleanly; we
  // combine them into an ISO string at submit time.
  const [scheduleDate, setScheduleDate] = useState<string>(''); // YYYY-MM-DD
  const [scheduleTime, setScheduleTime] = useState<string>(''); // HH:MM
  // Slice 4.1 fix (defect: synthetic "GPS detected" with no real
  // navigator.geolocation call): real lat/lng is captured only when
  // the user clicks the "Use my current location" button.
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [uploads, setUploads] = useState<string[]>([]);
  const [postError, setPostError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const addressesQuery = useAddresses();
  const createMut = useCreateServiceRequest();
  const isPosting = createMut.isPending;

  // Default the address field to the user's saved default (or first
  // address) on open.
  const defaultAddress = useMemo(() => {
    const list = addressesQuery.data ?? [];
    return list.find((a) => a.isDefault) ?? list[0] ?? null;
  }, [addressesQuery.data]);

  useEffect(() => {
    if (!isOpen) return;
    if (address.trim().length > 0) return;
    if (defaultAddress) {
      const composed = [defaultAddress.line1, defaultAddress.city, defaultAddress.country]
        .filter((p) => p && p.trim().length > 0)
        .join(', ');
      if (composed.length > 0) setAddress(composed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultAddress]);

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
    // NB: attachments are NOT uploaded yet. The placeholder colour
    // swatches stay so the visual flow is unchanged, but nothing is
    // sent to the backend.
    const colors = ['bg-blue-200', 'bg-amber-200', 'bg-green-200', 'bg-purple-200'];
    if (uploads.length < 4) setUploads((prev) => [...prev, colors[prev.length % colors.length]]);
  };

  // Slice 4.1: real browser geolocation. Triggered by user click on
  // "Use my current location" — never auto-fires because browsers
  // reject silent geolocation prompts and we don't want to ask for
  // permission on modal open.
  //
  // Phase 2 Bug 3: after capturing coords we now reverse-geocode them
  // through the Google Maps Geocoding API and auto-fill the address
  // input. Reverse-geocoding never throws — `reverseGeocode` returns a
  // typed result so a missing API key, network failure, or "no match"
  // simply produces a `partial` outcome (formatted lat/lng) and a
  // toast asking the user to verify.
  const handleRequestLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo({ status: 'error', reason: 'unsupported' });
      return;
    }
    setGeo({ status: 'pending' });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGeo({ status: 'success', lat, lng });
        const result = await reverseGeocode(lat, lng);
        if (result.status === 'ok') {
          setAddress(result.formattedAddress);
        } else {
          // Best-effort: fill the field with formatted coords + toast
          // so the user knows to verify.
          setAddress(result.formattedAddress);
          toast.warning(
            lang === 'ar'
              ? 'تعذّر العثور على عنوان مطابق. تم إدخال الإحداثيات — يرجى التحقق منها.'
              : "Couldn't resolve a street address. Coordinates were filled in — please verify.",
          );
        }
      },
      (err) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
        // We collapse 2/3 into "failed" because they're indistinguishable
        // to the user and the recovery path is the same: type the
        // address.
        if (err.code === 1) setGeo({ status: 'error', reason: 'denied' });
        else setGeo({ status: 'error', reason: 'failed' });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const handlePost = () => {
    setPostError(null);
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setPostError(
        lang === 'ar'
          ? 'الرجاء إدخال العنوان أو إضافته من العناوين المحفوظة.'
          : 'Please enter an address (or add one from Saved Addresses).',
      );
      return;
    }

    // Slice 4.1 fix: build a real ISO scheduledAt for LATER. ASAP
    // sends null so the backend accepts the request. The previous
    // build sent neither, and the LATER path silently dropped the
    // user's selection because there wasn't a real one.
    let scheduledAt: string | null = null;
    if (schedule === 'later') {
      if (!scheduleDate || !scheduleTime) {
        setPostError(t('scheduleLaterRequiresDateTime'));
        return;
      }
      const iso = combineLocalDateTimeToIso(scheduleDate, scheduleTime);
      if (!iso) {
        setPostError(t('scheduleLaterRequiresDateTime'));
        return;
      }
      // Reject past selections client-side — the backend rejects them
      // too, but a friendly inline error is faster than a round-trip.
      if (new Date(iso).getTime() <= Date.now()) {
        setPostError(t('scheduleInPast'));
        return;
      }
      scheduledAt = iso;
    }

    // If the typed address still matches the default address line
    // exactly, forward addressId so the backend snapshots from the
    // authoritative DB row (which already has lat/lng if present).
    // Otherwise the user typed/edited it, so forward manualAddress —
    // attaching the captured lat/lng when geolocation succeeded.
    const composedDefault = defaultAddress
      ? [defaultAddress.line1, defaultAddress.city, defaultAddress.country]
          .filter((p) => p && p.trim().length > 0)
          .join(', ')
      : '';
    const useDefaultId = defaultAddress !== null && composedDefault === trimmedAddress;
    const split = splitFullAddress(trimmedAddress);
    const lat = geo.status === 'success' ? geo.lat : null;
    const lng = geo.status === 'success' ? geo.lng : null;

    createMut.mutate(
      {
        categoryId: categoryId ?? null,
        customServiceText: categoryId ? null : service,
        description: notes.trim().length > 0 ? notes.trim() : null,
        scheduleType: schedule === 'asap' ? 'ASAP' : 'LATER',
        scheduledAt,
        addressId: useDefaultId ? defaultAddress!.id : null,
        manualAddress: useDefaultId
          ? null
          : {
              line1: split.line1,
              city: split.city,
              country: split.country,
              ...(lat !== null ? { lat } : {}),
              ...(lng !== null ? { lng } : {}),
            },
      },
      {
        onSuccess: () => {
          setStep(3);
        },
        onError: (err) => {
          const status =
            (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
          if (status === 400) setPostError(t('requestPostFailedValidation'));
          else if (status === 401) setPostError(t('requestPostFailedAuth'));
          else setPostError(t('requestPostFailedGeneric'));
        },
      },
    );
  };

  const handleClose = () => {
    setStep(1);
    setNotes('');
    setUploads([]);
    setSchedule('asap');
    setScheduleDate('');
    setScheduleTime('');
    setGeo({ status: 'idle' });
    setAddress('');
    setPostError(null);
    onClose();
  };

  const stepLabels = [t('mediaAndBrief'), t('locationAndTime'), t('confirm')];

  // Format the user-selected date+time for the success summary so it
  // reflects what they actually picked, not the legacy hardcoded
  // strings.
  const successScheduleLabel = (() => {
    if (schedule === 'asap') return t('asapFull');
    if (!scheduleDate || !scheduleTime) return '';
    const iso = combineLocalDateTimeToIso(scheduleDate, scheduleTime);
    if (!iso) return '';
    const d = new Date(iso);
    const dateStr = d.toLocaleDateString(langKey === 'ar' ? 'ar-SA' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const timeStr = d.toLocaleTimeString(langKey === 'ar' ? 'ar-SA' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${dateStr} · ${timeStr}`;
  })();

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
                  // Phase 1 Bug 2 — autosizing textarea so the seeker
                  // can describe the issue without being constrained
                  // to a single line. Starts at 3 visible rows and
                  // grows up to 10 before the field internally scrolls.
                  multiline
                  minRows={3}
                  maxRows={10}
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
                <BackChevron dir={dir} />
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
              <MapPlaceholder
                label={geo.status === 'success' ? t('locationCaptured') : t('gpsDetected')}
              />

              {/* Slice 4.1: real geolocation. Button is the only entry
                  point — the browser's permission prompt fires on
                  click, not on modal open. Visual idiom matches the
                  existing amber action treatment used elsewhere in the
                  wizard. */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleRequestLocation}
                  disabled={geo.status === 'pending'}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 active:bg-amber-100 transition-all disabled:opacity-60"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {geo.status === 'pending' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : geo.status === 'success' ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Navigation size={14} />
                  )}
                  <span>
                    {geo.status === 'pending'
                      ? t('detectingLocation')
                      : geo.status === 'success'
                        ? t('locationCaptured')
                        : t('useMyCurrentLocation')}
                  </span>
                </button>
                {geo.status === 'error' && (
                  <p
                    className="mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700"
                    style={{ fontSize: '12px', fontWeight: 600 }}
                    role="alert"
                  >
                    {geo.reason === 'denied'
                      ? t('locationDenied')
                      : geo.reason === 'unsupported'
                        ? t('locationUnsupported')
                        : t('locationFailed')}
                  </p>
                )}
              </div>

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
                      <label className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
                        <Calendar size={14} className="text-amber-500 flex-shrink-0" />
                        {/* Native HTML5 date picker. The visual frame is
                            unchanged from the slice-2 placeholder card. */}
                        <input
                          type="date"
                          value={scheduleDate}
                          min={todayLocalDateString()}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          className="bg-transparent outline-none text-slate-700 w-full"
                          style={{ fontSize: '13px', fontWeight: 500 }}
                          aria-label={t('date')}
                        />
                      </label>
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
                      <label className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
                        <Clock size={14} className="text-amber-500 flex-shrink-0" />
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="bg-transparent outline-none text-slate-700 w-full"
                          style={{ fontSize: '13px', fontWeight: 500 }}
                          aria-label={t('time')}
                        />
                      </label>
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
              {postError && (
                <p
                  className="mb-3 text-red-600"
                  style={{ fontSize: '12px', fontWeight: 600 }}
                  role="alert"
                >
                  {postError}
                </p>
              )}
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
                  // Slice 4.1: success summary now uses the user's
                  // actual schedule selection, not the legacy hardcoded
                  // strings.
                  { label: t('scheduleLabel'), val: successScheduleLabel },
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
