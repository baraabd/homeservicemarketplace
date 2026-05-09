import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
// Leaflet powers the LiveJobsScreen's interactive map (Phase 6 —
// Provider). The CSS import is required at module scope so the zoom
// controls and attribution overlay render with the canonical Leaflet
// styling under Vite. The default-marker icon URL fix lives in
// LocationMap.tsx and is module-scoped there; we don't reuse the
// default icon here (markers render as custom divIcons), so we don't
// repeat the icon-URL patch in this file.
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Map,
  Briefcase,
  Wallet,
  User,
  ChevronRight,
  ChevronUp,
  X,
  DollarSign,
  Star,
  CheckCircle2,
  ArrowLeft,
  TrendingUp,
  Bell,
  WifiOff,
  MapPin,
  MessageCircle,
  Navigation,
  Send,
  Award,
  BarChart2,
  Clock,
  LogOut,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
// Sprint 5.3 retired the legacy `useEcosystem` mock from this file —
// LiveJobsScreen + MyBidsScreen read from the API. Sprint 5.6 (refined)
// migrated the wallet to the canonical /v1/provider/earnings/* surface:
// summary + transactions + a server-side daily chart. The static
// WALLET_TRANSACTIONS / EARNINGS_CHART_DATA mocks and the client-side
// buildWeeklyEarnings reducer are gone.
import type { ServiceRequest } from '../../context/EcosystemContext';
import {
  useProviderProfile,
  useUpdateProviderAvailability,
  useUpgradeToProvider,
} from '../../hooks/provider/useProviderProfile';
// Sprint 5.2 (canonical) — switched the LiveJobsScreen to the
// /v1/provider/available-requests feed. The legacy useAvailableJobs
// hook stays exported for any other call site but is no longer
// consumed here.
import { useAvailableRequests } from '../../hooks/provider/useAvailableRequests';
// useWithdrawBid is exported from the hook module for the My Bids
// follow-on UI work; the current ProviderApp only consumes useMyBids
// + useSubmitBid in this file. Listed here so the shape stays
// consistent when Sprint 5.4 adds withdraw buttons to the bid cards.
import { useMyBids, useSubmitBid } from '../../hooks/provider/useMyBids';
// Sprint 5.4 — provider booking lifecycle. The MyBidsScreen reads
// the bookings list to map accepted bids to their booking ids, then
// uses the canonical /v1/provider/bookings/:id/{start,complete,cancel}
// endpoints for transitions.
import {
  useCancelProviderBooking,
  useCompleteProviderBooking,
  useProviderBookings,
  useStartProviderBooking,
} from '../../hooks/provider/useProviderBookings';
// Sprint 5.5 — provider notifications + chat hooks (REST + polling,
// no realtime yet). Notification drawer reads /v1/me/notifications
// scoped by ?experience=provider; chat reads the canonical
// /v1/provider/conversations.
import {
  useMarkAllProviderNotificationsRead,
  useMarkProviderNotificationRead,
  useProviderNotifications,
  useProviderUnreadNotificationsCount,
} from '../../hooks/provider/useProviderNotifications';
import {
  useProviderConversations,
  useProviderMessages,
  useSendProviderMessage,
} from '../../hooks/provider/useProviderChat';
import {
  useProviderEarningsChart,
  useProviderEarningsSummary,
  useProviderEarningsTransactions,
} from '../../hooks/provider/useProviderEarnings';
import type { EarningsChartRange } from '@homeservicemarketplace/contracts';
import {
  formatRelativeTime,
  formatResponseTime,
  iconForCategorySlug,
  mapAvailableJobToLegacy,
} from '../../../lib/provider/available-jobs-adapter';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../lib/auth-provider';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { clearIntendedApp } from '../../../lib/intended-app';
import { EditProfilePage } from '../profile/EditProfilePage';
import type {
  ProviderAvailability,
  ProviderProfileSummary,
} from '@homeservicemarketplace/contracts';
import { ProviderStatusState } from './ProviderStatusState';

// ─── Map config ──────────────────────────────────────────────────────────────
// Riyadh fallback used when the provider profile carries no service-area
// coordinates AND there are no markers to fit bounds against. Same
// ordering convention as Leaflet (lat, lng).
const RIYADH_FALLBACK: [number, number] = [24.7136, 46.6753];
const DEFAULT_MAP_ZOOM = 12;
const FIT_BOUNDS_MAX_ZOOM = 14;
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ─── Bidding Modal ────────────────────────────────────────────────────────────
// Time chip → response-time-in-minutes lookup. Used by the real
// /v1/me/provider/bids submit path (Sprint 5.3) so the wire carries
// `responseTimeMinutes` rather than the human-readable chip label.
const TIME_CHIP_MINUTES: Record<string, number> = {
  '30 min': 30,
  '1 hour': 60,
  '1–2 hours': 120,
  '2–4 hours': 240,
  'Half day': 240,
  'Full day': 480,
};

function BiddingModal({
  request,
  onClose,
  onSubmit,
}: {
  request: ServiceRequest;
  onClose: () => void;
  // Returns a promise that resolves on success, rejects on failure.
  // The modal drives its own sending / done / error state from the
  // promise — no setTimeout placeholders.
  onSubmit: (input: {
    price: number;
    timeLabel: string;
    responseTimeMinutes: number;
    note: string;
  }) => Promise<void>;
}) {
  const { lang } = useLang();
  const [price, setPrice] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const TIME_CHIPS = ['30 min', '1 hour', '1–2 hours', '2–4 hours', 'Half day', 'Full day'];
  const TIME_CHIPS_AR = ['30 دقيقة', 'ساعة', 'ساعة–ساعتين', '2–4 ساعات', 'نصف يوم', 'يوم كامل'];

  const L = {
    title: lang === 'ar' ? 'تقديم عرض' : 'Submit Offer',
    requestFor: lang === 'ar' ? 'طلب:' : 'For:',
    priceLabel: lang === 'ar' ? 'سعرك ($/ساعة)' : 'Your Price ($/hr)',
    pricePlh: lang === 'ar' ? 'مثال: 35' : 'e.g. 35',
    timeLabel: lang === 'ar' ? 'وقت التنفيذ' : 'Execution Time',
    noteLabel: lang === 'ar' ? 'ملاحظة للعميل' : 'Note to Client',
    notePlh: lang === 'ar' ? 'أخبر العميل عن خبرتك…' : 'Tell the client about your experience…',
    submit: lang === 'ar' ? 'إرسال العرض' : 'Send Offer',
    sending: lang === 'ar' ? 'جارٍ الإرسال…' : 'Sending…',
    sent: lang === 'ar' ? 'تم إرسال عرضك! 🎉' : 'Offer sent! 🎉',
    budget: lang === 'ar' ? 'ميزانية الطلب:' : 'Budget:',
    failed:
      lang === 'ar'
        ? 'تعذّر إرسال العرض. الرجاء المحاولة مرة أخرى.'
        : 'Could not send your offer. Please try again.',
  };

  const handleSubmit = async () => {
    if (!price || !time || sending) return;
    const amount = Math.round(parseFloat(price));
    if (!Number.isFinite(amount) || amount < 1) return;
    setSending(true);
    setSubmitError(null);
    try {
      await onSubmit({
        price: amount,
        timeLabel: time,
        responseTimeMinutes: TIME_CHIP_MINUTES[time] ?? 60,
        note,
      });
      setSending(false);
      setDone(true);
      // Auto-dismiss after a beat so the success cue is readable.
      setTimeout(() => {
        onClose();
        setDone(false);
      }, 1600);
    } catch {
      // Error message comes from the mutation; the wire body never
      // contains internal stack traces — the API maps everything to
      // safe envelopes.
      setSending(false);
      setSubmitError(L.failed);
    }
  };

  return (
    <>
      <motion.div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm z-30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl z-40 overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto mt-3 mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 mb-4">
          <div>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '18px', fontWeight: 800 }}
            >
              {L.title}
            </p>
            <p className="text-slate-400" style={{ fontSize: '12px' }}>
              {L.requestFor}{' '}
              <span className="text-blue-600 font-semibold">
                {lang === 'ar' ? request.serviceAr : request.service}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90"
          >
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* Budget note */}
        <div className="mx-5 mb-4 flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 rounded-2xl px-4 py-2.5">
          <DollarSign size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <p className="text-blue-700 dark:text-blue-300" style={{ fontSize: '12px' }}>
            {L.budget} <span style={{ fontWeight: 700 }}>{request.budget}</span>
          </p>
        </div>

        {done ? (
          <motion.div
            className="flex flex-col items-center justify-center py-10 gap-3"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-green-500" />
            </div>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '16px', fontWeight: 700 }}
            >
              {L.sent}
            </p>
          </motion.div>
        ) : (
          <div className="px-5 pb-6 flex flex-col gap-4">
            {/* Price */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.priceLabel}
              </p>
              <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3">
                <DollarSign size={16} className="text-slate-400" />
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={L.pricePlh}
                  min={1}
                  max={999}
                  className="flex-1 bg-transparent outline-none text-slate-900 dark:text-white placeholder-slate-400"
                  style={{ fontSize: '18px', fontWeight: 700 }}
                />
                <span className="text-slate-400" style={{ fontSize: '12px' }}>
                  USD/hr
                </span>
              </div>
            </div>

            {/* Time chips */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.timeLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {TIME_CHIPS.map((chip, i) => {
                  const label = lang === 'ar' ? TIME_CHIPS_AR[i] : chip;
                  return (
                    <button
                      key={chip}
                      onClick={() => setTime(chip)}
                      className={`px-3 py-2 rounded-xl border-2 transition-all active:scale-95 ${
                        time === chip
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                      }`}
                      style={{ fontSize: '12px', fontWeight: 600 }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div>
              <p
                className="text-slate-600 dark:text-slate-300 mb-2"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {L.noteLabel}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={L.notePlh}
                rows={2}
                className="w-full bg-slate-100 dark:bg-slate-700 rounded-2xl px-4 py-3 text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                style={{ fontSize: '13px' }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!price || !time || sending}
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl transition-all active:scale-95 ${
                !price || !time
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white shadow-lg shadow-blue-300/40'
              }`}
              style={{ fontSize: '15px', fontWeight: 800 }}
            >
              {sending ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {L.sending}
                </>
              ) : (
                <>
                  <Send size={16} />
                  {L.submit}
                </>
              )}
            </button>

            {submitError && (
              <p
                role="alert"
                className="text-red-600 dark:text-red-400 text-center"
                style={{ fontSize: '12px', fontWeight: 600 }}
              >
                {submitError}
              </p>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}

// ─── Job pin (Leaflet divIcon) ────────────────────────────────────────────────
// Status / urgency → pin colour. Pure helper so the colour is computed
// the same way for the Leaflet divIcon HTML and the popup status row.
function pinColorFor(req: ServiceRequest): string {
  const urgentColor = req.urgency === 'urgent' ? '#ef4444' : '#3b82f6';
  if (req.status === 'pending') return urgentColor;
  if (req.status === 'bidding') return '#f59e0b';
  return '#10b981';
}

// Build the Leaflet divIcon HTML for one job pin. The string is fed to
// L.divIcon, which mounts it inside a Leaflet-managed wrapper element
// at the marker's lat/lng. Two notes for future readers:
//   • Tailwind classes used here (`animate-ping`, `rounded-2xl` etc.)
//     must already exist in JIT-scanned source elsewhere in the file —
//     Tailwind's content scanner doesn't follow string literals through
//     L.divIcon. The classes used below are all live in the popup JSX
//     below or in nearby surfaces.
//   • The serviceIcon is a single emoji from the curated category map
//     (apps/web/src/lib/provider/available-jobs-adapter.ts:iconForCategorySlug)
//     so HTML escaping isn't required. If the icon source ever widens
//     to seeker-supplied content this needs an escape pass.
function buildPinHtml(req: ServiceRequest): string {
  const color = pinColorFor(req);
  const ripple =
    req.status === 'pending'
      ? `<span class="absolute inset-0 rounded-full animate-ping opacity-40" style="background:${color};transform:scale(2);"></span>`
      : '';
  return `
    <div class="relative" style="width:40px;height:40px;">
      ${ripple}
      <div class="relative w-10 h-10 rounded-2xl flex items-center justify-center shadow-xl border-2 border-white" style="background:${color};">
        <span style="font-size:18px;line-height:1;">${req.serviceIcon}</span>
      </div>
    </div>
  `;
}

function JobMarker({
  req,
  lang,
  bidLabel,
  onPlaceBid,
}: {
  req: ServiceRequest;
  lang: 'en' | 'ar';
  bidLabel: string;
  onPlaceBid: (req: ServiceRequest) => void;
}) {
  // L.divIcon must be stable per (status, urgency, serviceIcon) — Leaflet
  // detaches/re-attaches the marker DOM whenever the icon reference
  // changes. Recreating it on every parent re-render would thrash the
  // marker layer and cancel hover state.
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'job-pin-icon',
        html: buildPinHtml(req),
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20],
      }),
    [req],
  );

  // Null-coord pins are filtered upstream — this is a defensive
  // narrow so TypeScript treats lat/lng as numbers below.
  if (req.lat == null || req.lng == null) return null;

  const color = pinColorFor(req);
  const statusLabel =
    req.status === 'pending'
      ? lang === 'ar'
        ? 'بانتظار العروض'
        : 'Awaiting bids'
      : req.status === 'bidding'
        ? lang === 'ar'
          ? `${req.bids.length} عرض`
          : `${req.bids.length} bids`
        : lang === 'ar'
          ? 'مُسند'
          : 'Assigned';

  return (
    <Marker position={[req.lat, req.lng]} icon={icon}>
      <Popup>
        <div className="w-44">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '13px', fontWeight: 700, margin: 0 }}
          >
            {lang === 'ar' ? req.serviceAr : req.service}
          </p>
          <p className="text-slate-400" style={{ fontSize: '11px', margin: '2px 0 0' }}>
            {req.distance}km · {req.budget}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: color, display: 'inline-block' }}
            />
            <span style={{ fontSize: '10px', color, fontWeight: 600 }}>{statusLabel}</span>
          </div>
          {req.status !== 'assigned' && req.status !== 'completed' && (
            <button
              type="button"
              onClick={() => onPlaceBid(req)}
              className="w-full mt-2 py-1.5 rounded-xl bg-blue-600 text-white"
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              {bidLabel}
            </button>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// ─── Map auto-fit helper ──────────────────────────────────────────────────────
// Mounted as a child of MapContainer so it can call useMap(). Whenever
// the (memoised) list of marker coordinates changes, we fitBounds the
// map to include them all. With 0 coords it leaves the map at the
// default center (Riyadh / provider service-area), with 1 coord the
// maxZoom cap prevents the single-point zoom-to-the-moon behaviour.
function MapAutoFit({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  // Stable stringified key so the effect doesn't refire on identity
  // changes when the underlying lat/lng list is unchanged.
  const key = points.map((p) => `${p[0]},${p[1]}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: FIT_BOUNDS_MAX_ZOOM,
      animate: false,
    });
    // points is a fresh array on every render — depend on the stable
    // key above; map is stable from useMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// ─── Job detail overlay ──────────────────────────────────────────────────────
// Phase 6 — Job Details UX. Renders an opt-in detail surface between
// the LiveJobsScreen feed and the BiddingModal. The provider taps a
// pin popup or a bottom-sheet card → this overlay slides up with the
// full request context → the overlay's "Place Bid" CTA is what
// actually opens the BiddingModal.
//
// Data caveat (intentional, not a TODO): three legacy ServiceRequest
// fields — `distance`, `seekerName`, `budget` — are NOT on the
// Sprint 5.2 ProviderAvailableRequestSummary wire. The adapter
// blanks them (0 / '' / ''); we surface those rows with a `—` so the
// operator sees the layout but never a fabricated value. Whenever the
// wire grows the matching fields, the rendering here will start
// showing real values without further frontend work.
function JobDetailOverlay({
  req,
  lang,
  onClose,
  onPlaceBid,
  labels,
}: {
  req: ServiceRequest;
  lang: 'en' | 'ar';
  onClose: () => void;
  onPlaceBid: (req: ServiceRequest) => void;
  labels: {
    title: string;
    placeBid: string;
    distance: string;
    seeker: string;
    budget: string;
    urgency: string;
    description: string;
    urgent: string;
    standard: string;
    notSet: string;
  };
}) {
  const color =
    req.urgency === 'urgent' ? '#ef4444' : req.status === 'bidding' ? '#f59e0b' : '#3b82f6';
  // The legacy ServiceRequest type carries these as primitives that
  // the adapter blanks for missing wire fields. Treat 0 / '' as "no
  // value yet" so the overlay never renders a fabricated zero.
  // Distance moved to a nullable `distanceKm` field — `!== null`
  // because 0 km is a real value (provider standing on top of the
  // request); the legacy `req.distance` is no longer the source of
  // truth and stays 0 from the adapter.
  const hasDistance = req.distanceKm !== null;
  const hasBudget = Boolean(req.budget && req.budget.trim());
  const hasSeeker = Boolean(req.seekerName && req.seekerName.trim());
  const hasMedia = req.mediaUrls.length > 0;

  return (
    <>
      <motion.div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm z-30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        data-testid="job-detail-overlay"
        className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl z-40 overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto mt-3 mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border-2 border-white shadow-md"
              style={{ background: color }}
            >
              <span style={{ fontSize: '22px', lineHeight: 1 }}>{req.serviceIcon}</span>
            </div>
            <div className="min-w-0">
              <p
                className="text-slate-900 dark:text-white truncate"
                style={{ fontSize: '17px', fontWeight: 800 }}
              >
                {lang === 'ar' ? req.serviceAr : req.service}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`px-1.5 py-0.5 rounded-md ${
                    req.urgency === 'urgent'
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                  }`}
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {req.urgency === 'urgent' ? labels.urgent : labels.standard}
                </span>
                <span className="text-slate-400" style={{ fontSize: '11px' }}>
                  {lang === 'ar' ? req.locationAr : req.location}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}
            data-testid="job-detail-close"
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 flex-shrink-0"
          >
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-4">
          {/* Meta row — Distance · Budget · Seeker */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
              <p className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600 }}>
                {labels.distance}
              </p>
              <p
                className="text-slate-900 dark:text-white mt-0.5"
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {hasDistance ? `${req.distanceKm!.toFixed(1)} km` : labels.notSet}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
              <p className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600 }}>
                {labels.budget}
              </p>
              <p
                className="text-slate-900 dark:text-white mt-0.5 truncate"
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {hasBudget ? req.budget : labels.notSet}
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
              <p className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600 }}>
                {labels.seeker}
              </p>
              <p
                className="text-slate-900 dark:text-white mt-0.5 truncate"
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {hasSeeker ? req.seekerName : labels.notSet}
              </p>
            </div>
          </div>

          {/* Seeker-uploaded photos. Only rendered when the request
              actually carries media so the layout doesn't reserve dead
              space. The horizontal scroll keeps the overlay height
              bounded for galleries with many shots. */}
          {hasMedia && (
            <div
              className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1"
              style={{ scrollbarWidth: 'none' }}
              data-testid="job-detail-media"
            >
              {req.mediaUrls.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  loading="lazy"
                  className="w-16 h-16 object-cover rounded-md border border-slate-200 dark:border-slate-600 flex-shrink-0"
                />
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <p
              className="text-slate-600 dark:text-slate-300 mb-1.5"
              style={{ fontSize: '12px', fontWeight: 600 }}
            >
              {labels.description}
            </p>
            <p
              className="text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5"
              style={{ fontSize: '13px', lineHeight: 1.5 }}
            >
              {(lang === 'ar' ? req.descriptionAr : req.description) || labels.notSet}
            </p>
          </div>

          {/* Place Bid CTA */}
          {req.status !== 'assigned' && req.status !== 'completed' && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => onPlaceBid(req)}
              data-testid="job-detail-place-bid"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none"
              style={{ fontSize: '14px', fontWeight: 700 }}
            >
              <Send size={14} />
              {labels.placeBid}
            </motion.button>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ─── Live Jobs Screen (Map) ───────────────────────────────────────────────────
function LiveJobsScreen() {
  const { lang } = useLang();
  const profileQuery = useProviderProfile();
  // Sprint 5.2 (canonical): live feed of OPEN_FOR_BIDS service
  // requests against /v1/provider/available-requests, polled every
  // 20s with refetchOnWindowFocus. The hook scopes to the provider's
  // configured categories server-side (or to all categories if none
  // configured) and hides every request the provider already has an
  // active bid on.
  const availableRequestsQuery = useAvailableRequests();
  const apiRequests = useMemo(
    () => (availableRequestsQuery.data?.items ?? []).map(mapAvailableJobToLegacy),
    [availableRequestsQuery.data],
  );
  // Server-side ProviderActiveGuard returns 403 when the provider's
  // status is not ACTIVE (DRAFT / PENDING_REVIEW / SUSPENDED /
  // REJECTED). Surface a "blocked" copy instead of an empty list so
  // the operator understands why the feed is empty.
  const isBlockedByStatus =
    availableRequestsQuery.isError &&
    /** axios error with response.status === 403 */
    Boolean(
      (availableRequestsQuery.error as { response?: { status?: number } } | null)?.response
        ?.status === 403,
    );
  // Sprint 5.3: real submit-bid mutation. Replaces the
  // `useEcosystem().submitBid` mock; the modal awaits the mutation
  // and React Query invalidates `provider/jobs` and `provider/bids`
  // on success so the feed and My Bids reflect the new state.
  const submitBidMutation = useSubmitBid();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Phase 6 — JobDetailOverlay sits between the feed and the bidding
  // modal. Tapping a marker popup or a bottom-sheet card sets
  // `detailReq`; the overlay's "Place Bid" CTA clears it and sets
  // `biddingReq`, which mounts the BiddingModal as before.
  const [detailReq, setDetailReq] = useState<ServiceRequest | null>(null);
  const [biddingReq, setBiddingReq] = useState<ServiceRequest | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'bidding'>('all');

  // Sprint 7.0 — "new job nearby" toast.
  //
  // The realtime socket invalidates the available-requests cache on
  // `request.available` events (see dispatchInvalidations); polling at
  // 20 s also surfaces new rows. Either way, the next refetch lands
  // a fresh items list. We compare it against the previous render's
  // ids to detect FRESH rows (not just refetch noise) and toast once
  // per arrival batch.
  //
  // Two correctness rules:
  //   1. The first successful fetch is NOT a "new job" — it's the
  //      initial state. We seed the seen-ids set on the first non-null
  //      data and skip the toast.
  //   2. On screen unmount the ref naturally GCs with the component;
  //      there is no global toast spam if the operator switches tabs
  //      mid-poll (the effect cleanup + remount re-establishes the
  //      baseline cleanly).
  const seenRequestIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!availableRequestsQuery.data) return;
    const ids = availableRequestsQuery.data.items.map((it) => it.id);
    const seen = seenRequestIdsRef.current;
    if (seen === null) {
      seenRequestIdsRef.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.has(id));
    if (fresh.length > 0) {
      toast.success(lang === 'ar' ? 'طلب خدمة جديد بالقرب منك!' : 'New job nearby!');
    }
    seenRequestIdsRef.current = new Set(ids);
  }, [availableRequestsQuery.data, lang]);

  // Map status pill: prefer the provider's configured service area; fall
  // back to a neutral "Online" label when none is set, never hardcoded
  // city text.
  const serviceAreaLabel = (() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return lang === 'ar' ? 'متصل' : 'Online';
    const city = profile.serviceAreaCity?.trim();
    const country = profile.serviceAreaCountry?.trim();
    if (city && country) return `${city}, ${country}`;
    if (city) return city;
    if (country) return country;
    return lang === 'ar' ? 'متصل' : 'Online';
  })();

  // The feed only ships OPEN_FOR_BIDS rows (status maps to 'pending'
  // when bidsCount === 0 and 'bidding' otherwise). Sprint 5.4 will add
  // SCHEDULED bookings into a separate view; until then 'assigned' /
  // 'completed' do not appear here.
  const activeReqs = apiRequests;
  const filteredReqs =
    filterStatus === 'all' ? activeReqs : activeReqs.filter((r) => r.status === filterStatus);

  // Only requests with real coordinates render as map pins. Rows with
  // null lat/lng still appear in the bottom-sheet list — they're valid
  // jobs the provider can bid on, the wire just hasn't captured precise
  // coords for them. Synthesising fake locations would be worse than a
  // missing pin.
  const geolocatedReqs = useMemo(
    () =>
      activeReqs.filter(
        (r): r is ServiceRequest & { lat: number; lng: number } => r.lat != null && r.lng != null,
      ),
    [activeReqs],
  );
  const markerPoints = useMemo<Array<[number, number]>>(
    () => geolocatedReqs.map((r) => [r.lat, r.lng]),
    [geolocatedReqs],
  );

  // Default center precedence:
  //   1. Provider profile's configured service area (when both lat/lng
  //      are set on /v1/me/provider/profile).
  //   2. Forward-geocode `serviceAreaCity` via OpenStreetMap Nominatim
  //      so seeded providers (Aleppo, Damascus, …) whose lat/lng are
  //      still null get a city-relevant default instead of Riyadh.
  //   3. Riyadh — the product's primary market today.
  // The MapAutoFit child overrides this with fitBounds when there is at
  // least one geolocated marker; the center matters mainly for the
  // empty-feed and provider-not-yet-onboarded cases.
  //
  // `null` while we wait for the profile query / Nominatim — Leaflet's
  // MapContainer throws if it mounts against a missing center, so the
  // gate below the JSX defers the mount until we have a real value.
  const [dynamicCenter, setDynamicCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    const profile = profileQuery.data?.profile;
    // Wait for the profile to load before deciding. We don't render the
    // map either, so the user just sees the loading placeholder for a
    // beat — strictly better than mounting against a wrong default and
    // then jumping.
    if (!profile) return;

    // 1. Explicit coords — use immediately.
    if (profile.serviceAreaLat != null && profile.serviceAreaLng != null) {
      setDynamicCenter([profile.serviceAreaLat, profile.serviceAreaLng]);
      return;
    }

    // 2. Forward-geocode the city. Nominatim's usage policy
    // (https://operations.osmfoundation.org/policies/nominatim/)
    // accepts ≤1 req/sec/server; one request per profile is well
    // within budget. We send `Accept-Language: ar,en` so Syrian/Saudi
    // city names resolve in their native scripts. Production at scale
    // should switch to a paid geocoder or self-host.
    const city = profile.serviceAreaCity?.trim() ?? '';
    if (city.length > 0) {
      const controller = new AbortController();
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
            { signal: controller.signal, headers: { 'Accept-Language': 'ar,en' } },
          );
          if (cancelled) return;
          if (!res.ok) {
            setDynamicCenter(RIYADH_FALLBACK);
            return;
          }
          const body = (await res.json()) as Array<{ lat?: string; lon?: string }>;
          if (cancelled) return;
          const top = body[0];
          if (top?.lat && top?.lon) {
            const lat = Number.parseFloat(top.lat);
            const lon = Number.parseFloat(top.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              setDynamicCenter([lat, lon]);
              return;
            }
          }
          // Empty result OR malformed coords → Riyadh.
          setDynamicCenter(RIYADH_FALLBACK);
        } catch {
          // AbortError (cleanup) lands here too; the cancelled guard
          // above already prevented a setState on unmount, so a
          // blanket Riyadh fallback for "anything went wrong" is
          // safe for the remaining (network / parse) failures.
          if (!cancelled) setDynamicCenter(RIYADH_FALLBACK);
        }
      })();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    // 3. No coords AND no city — Riyadh.
    setDynamicCenter(RIYADH_FALLBACK);
  }, [profileQuery.data?.profile]);

  const L = {
    title: lang === 'ar' ? 'الوظائف النشطة' : 'Live Jobs',
    online: lang === 'ar' ? 'متصل · جاهز' : 'Online · Ready',
    all: lang === 'ar' ? 'الكل' : 'All',
    pending: lang === 'ar' ? 'جديد' : 'New',
    bidding: lang === 'ar' ? 'عروض' : 'Bidding',
    bid: lang === 'ar' ? 'قدم عرض' : 'Place Bid',
    km: lang === 'ar' ? 'كم' : 'km',
    nearby: lang === 'ar' ? 'طلبات قريبة منك' : 'Nearby requests',
    noJobs: lang === 'ar' ? 'لا توجد وظائف حالياً' : 'No jobs right now',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading nearby jobs…',
    blocked:
      lang === 'ar'
        ? 'حسابك ليس نشطًا. يمكن للمسؤول تفعيله من لوحة الإدارة.'
        : 'Your provider account is not active. An admin can reactivate it.',
    failed:
      lang === 'ar'
        ? 'تعذّر تحميل الطلبات. حاول مرة أخرى لاحقاً.'
        : 'Could not load nearby jobs. Try again later.',
    drag: lang === 'ar' ? 'اسحب للأعلى لرؤية الطلبات' : 'Pull up to see requests',
    urgentTag: lang === 'ar' ? 'عاجل' : 'Urgent',
    detailTitle: lang === 'ar' ? 'تفاصيل الطلب' : 'Request details',
    distanceLabel: lang === 'ar' ? 'المسافة' : 'Distance',
    seekerLabel: lang === 'ar' ? 'صاحب الطلب' : 'Seeker',
    budgetLabel: lang === 'ar' ? 'الميزانية' : 'Budget',
    descriptionLabel: lang === 'ar' ? 'الوصف' : 'Description',
    standardTag: lang === 'ar' ? 'عادي' : 'Standard',
    notSet: '—',
  };

  // Real submit. The mutation wraps the /v1/provider/bids POST;
  // it throws on failure so the modal can surface the safe error
  // copy. We deliberately do NOT close the modal on UNKNOWN failures
  // — the user may correct the input and retry. On 409 (the
  // backend's "you already have an active bid on this request"
  // invariant from provider-bids.service.ts:78) we close the modal,
  // toast a friendly message, and refresh the bids list so the
  // caller's My Bids screen reflects the existing bid without
  // forcing a manual refetch.
  const handleBidSubmit = async (input: {
    price: number;
    timeLabel: string;
    responseTimeMinutes: number;
    note: string;
  }) => {
    if (!biddingReq) return;
    try {
      await submitBidMutation.mutateAsync({
        requestId: biddingReq.id,
        amount: input.price,
        pricingType: 'HOURLY',
        note: input.note ? input.note : null,
        responseTimeMinutes: input.responseTimeMinutes,
      });
      setBiddingReq(null);
    } catch (err) {
      const status = (err as AxiosError | undefined)?.response?.status;
      if (status === 409) {
        toast.error(
          lang === 'ar'
            ? 'لقد قدّمت عرضاً بالفعل على هذا الطلب.'
            : 'You have already placed a bid on this request.',
        );
        setBiddingReq(null);
      } else {
        // Re-throw so the modal can render its existing inline error
        // copy for genuine validation / network failures.
        throw err;
      }
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        {/*
          Leaflet's MapContainer renders its own DOM tree (panes for
          tiles / markers / popups) with internal z-indices up to ~700.
          Sibling overlays below use z-[1000]+ so the status pills and
          drag handle stay above popups; the AnimatePresence-wrapped
          BottomSheet is a SIBLING of this map div (one level up) and
          its z-20 already wins because its stacking context is at the
          parent flex level, not inside Leaflet's pane stack.
        */}
        {/*
          dynamicCenter is null until the profile query AND any
          Nominatim forward-geocode have resolved. Mounting Leaflet
          against a null center throws bounds errors; the gate keeps
          the map unmounted until we have a real coordinate. The
          loading copy below mirrors the empty-state visuals so the
          screen never shows raw Leaflet chrome with no tile.
        */}
        {dynamicCenter === null ? (
          <div
            className="absolute inset-0 flex items-center justify-center bg-slate-50"
            role="status"
            aria-live="polite"
          >
            <span className="text-slate-400" style={{ fontSize: '13px', fontWeight: 600 }}>
              {L.loading}
            </span>
          </div>
        ) : (
          <MapContainer
            center={dynamicCenter}
            zoom={DEFAULT_MAP_ZOOM}
            zoomControl={false}
            attributionControl
            scrollWheelZoom
            style={{ position: 'absolute', inset: 0, zIndex: 0 }}
            aria-label={lang === 'ar' ? 'خريطة الوظائف الحية' : 'Live jobs map'}
          >
            <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
            <MapAutoFit points={markerPoints} />
            {geolocatedReqs.map((req) => (
              <JobMarker
                key={req.id}
                req={req}
                lang={lang}
                bidLabel={L.bid}
                // The marker popup's CTA opens the detail overlay first;
                // the overlay's own "Place Bid" CTA is what actually
                // sets biddingReq and mounts the BiddingModal.
                onPlaceBid={(r) => {
                  setSheetOpen(false);
                  setDetailReq(r);
                }}
              />
            ))}
          </MapContainer>
        )}

        {/* Top status bar */}
        <div className="absolute top-4 start-4 end-4 flex items-center justify-between z-[1000]">
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/10">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white" style={{ fontSize: '12px', fontWeight: 600 }}>
              {L.online}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md rounded-2xl px-3 py-2 border border-white/10">
            <Navigation size={12} className="text-blue-400" />
            <span className="text-white" style={{ fontSize: '12px' }}>
              {serviceAreaLabel}
            </span>
          </div>
        </div>

        {/* Drag handle */}
        {!sheetOpen && (
          <motion.button
            className="absolute bottom-4 start-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-[1000]"
            onClick={() => setSheetOpen(true)}
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 1.8 }}
          >
            <div className="bg-white/90 backdrop-blur-md rounded-full px-4 py-2 shadow-lg border border-white/20 flex items-center gap-2">
              <ChevronUp size={14} className="text-slate-500" />
              <span className="text-slate-700" style={{ fontSize: '12px', fontWeight: 600 }}>
                {L.drag}
              </span>
              <span
                className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center"
                style={{ fontSize: '10px', fontWeight: 800 }}
                data-testid="job-count-badge"
              >
                {/*
                  Reflects the count of cards the operator will see when
                  they pull the bottom sheet up — i.e. activeReqs after
                  the all/pending/bidding filter is applied. The earlier
                  shape (pending count regardless of filter) drifted from
                  the sheet contents whenever the filter wasn't 'all'.
                */}
                {filteredReqs.length}
              </span>
            </div>
          </motion.button>
        )}
      </div>

      {/* Bottom Sheet */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            className="absolute bottom-0 start-0 end-0 bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl z-20 flex flex-col"
            style={{ maxHeight: '65%' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Handle */}
            <div className="flex-shrink-0 flex flex-col items-center pt-3 pb-2">
              <button
                onClick={() => setSheetOpen(false)}
                className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600 mb-2"
              />
              <div className="flex items-center justify-between w-full px-4 pb-2">
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '16px', fontWeight: 800 }}
                >
                  {L.nearby} · <span className="text-blue-600">{activeReqs.length}</span>
                </p>
                <div className="flex gap-1">
                  {(['all', 'pending', 'bidding'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilterStatus(f)}
                      className={`px-3 py-1.5 rounded-xl transition-all ${
                        filterStatus === f
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}
                      style={{ fontSize: '11px', fontWeight: 700 }}
                    >
                      {f === 'all' ? L.all : f === 'pending' ? L.pending : L.bidding}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Leads list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
              {filteredReqs.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <MapPin size={24} className="text-slate-300" />
                  </div>
                  <p
                    role="status"
                    className="text-slate-400 text-center px-4"
                    style={{ fontSize: '14px' }}
                  >
                    {isBlockedByStatus
                      ? L.blocked
                      : availableRequestsQuery.isPending
                        ? L.loading
                        : availableRequestsQuery.isError
                          ? L.failed
                          : L.noJobs}
                  </p>
                </div>
              ) : (
                filteredReqs.map((req) => (
                  <motion.div
                    key={req.id}
                    whileTap={{ scale: 0.98 }}
                    role="button"
                    tabIndex={0}
                    aria-label={lang === 'ar' ? req.serviceAr : req.service}
                    data-testid={`job-card-${req.id}`}
                    onClick={() => setDetailReq(req)}
                    onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailReq(req);
                      }
                    }}
                    className="bg-slate-50 dark:bg-slate-700 rounded-3xl p-4 mb-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-2xl">
                        {req.serviceIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p
                            className="text-slate-900 dark:text-white"
                            style={{ fontSize: '14px', fontWeight: 700 }}
                          >
                            {lang === 'ar' ? req.serviceAr : req.service}
                          </p>
                          {req.urgency === 'urgent' && (
                            <span
                              className="px-1.5 py-0.5 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
                              style={{ fontSize: '9px', fontWeight: 700 }}
                            >
                              {L.urgentTag}
                            </span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded-lg ${
                              req.status === 'pending'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                            style={{ fontSize: '9px', fontWeight: 700 }}
                          >
                            {req.status === 'pending' ? 'New' : `${req.bids.length} bids`}
                          </span>
                        </div>
                        <p
                          className="text-slate-400 dark:text-slate-400"
                          style={{ fontSize: '12px' }}
                        >
                          {lang === 'ar' ? req.locationAr : req.location}
                        </p>
                        {/* Meta row — Distance / Budget / Seeker icons.
                            Each chip only renders when the underlying
                            value is real, so the card never shows a
                            fabricated "0 km" / empty pill / empty
                            avatar gap when the wire deliberately
                            omits the field. Distance gates on
                            `distanceKm !== null` (0 km is a real
                            value); budget + seekerName gate on a
                            non-empty string. */}
                        {(req.distanceKm !== null ||
                          req.budget.trim().length > 0 ||
                          req.seekerName.trim().length > 0) && (
                          <div className="flex items-center gap-3 mt-1.5">
                            {req.distanceKm !== null && (
                              <div className="flex items-center gap-1">
                                <MapPin size={11} className="text-blue-500" />
                                <span
                                  className="text-blue-600 dark:text-blue-400"
                                  style={{ fontSize: '11px', fontWeight: 600 }}
                                >
                                  {req.distanceKm.toFixed(1)}
                                  {L.km}
                                </span>
                              </div>
                            )}
                            {req.budget.trim().length > 0 && (
                              <div className="flex items-center gap-1">
                                <DollarSign size={11} className="text-green-500" />
                                <span
                                  className="text-green-600 dark:text-green-400"
                                  style={{ fontSize: '11px', fontWeight: 600 }}
                                >
                                  {req.budget}
                                </span>
                              </div>
                            )}
                            {req.seekerName.trim().length > 0 && (
                              <div className="flex items-center gap-1">
                                <Star size={11} className="text-amber-500 fill-amber-500" />
                                <span className="text-slate-500" style={{ fontSize: '11px' }}>
                                  {req.seekerName}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        {req.mediaUrls.length > 0 && (
                          <div
                            className="flex gap-1 mt-2 overflow-x-auto"
                            style={{ scrollbarWidth: 'none' }}
                            data-testid={`job-card-media-${req.id}`}
                          >
                            {req.mediaUrls.slice(0, 3).map((url) => (
                              <img
                                key={url}
                                src={url}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 object-cover rounded-md border border-slate-200 dark:border-slate-600 flex-shrink-0"
                              />
                            ))}
                            {req.mediaUrls.length > 3 && (
                              <div
                                className="w-10 h-10 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-600 flex items-center justify-center text-slate-500 flex-shrink-0"
                                style={{ fontSize: '10px', fontWeight: 700 }}
                                aria-label={`+${req.mediaUrls.length - 3}`}
                              >
                                +{req.mediaUrls.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Job detail overlay (Phase 6) — sits between feed and bidding */}
      <AnimatePresence>
        {detailReq && (
          <JobDetailOverlay
            req={detailReq}
            lang={lang}
            onClose={() => setDetailReq(null)}
            onPlaceBid={(r) => {
              setDetailReq(null);
              setBiddingReq(r);
            }}
            labels={{
              title: L.detailTitle,
              placeBid: L.bid,
              distance: L.distanceLabel,
              seeker: L.seekerLabel,
              budget: L.budgetLabel,
              urgency: L.urgentTag,
              description: L.descriptionLabel,
              urgent: L.urgentTag,
              standard: L.standardTag,
              notSet: L.notSet,
            }}
          />
        )}
      </AnimatePresence>

      {/* Bidding modal */}
      <AnimatePresence>
        {biddingReq && (
          <BiddingModal
            request={biddingReq}
            onClose={() => setBiddingReq(null)}
            onSubmit={handleBidSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Booking transition panel (Sprint 5.4) ────────────────────────────────────
// Renders the right action button for the linked booking's current
// state. Pure presentation — the parent owns the mutations + their
// pending state.
//
//   SCHEDULED   → "Start Job" (primary) + "Cancel Booking" (link)
//   IN_PROGRESS → "Mark Complete" (primary)
//   COMPLETED   → "Completed" pill (no buttons)
//   CANCELLED   → "Cancelled" pill (no buttons)
//   null        → "Waiting for booking…" copy (race window between
//                 bid acceptance and the booking row landing in the
//                 list — harmless, resolves on the next 30s poll)
function BookingTransitionPanel({
  bookingId,
  bookingStatus,
  onStart,
  onComplete,
  onCancel,
  pending,
  labels,
}: {
  bookingId: string | null;
  bookingStatus: string | null;
  onStart: (bookingId: string) => void;
  onComplete: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
  pending: boolean;
  labels: {
    start: string;
    complete: string;
    cancel: string;
    inProgress: string;
    completed: string;
    cancelled: string;
    pendingBooking: string;
  };
}) {
  if (!bookingId || !bookingStatus) {
    return (
      <p role="status" className="text-slate-400 text-center py-2" style={{ fontSize: '12px' }}>
        {labels.pendingBooking}
      </p>
    );
  }
  if (bookingStatus === 'COMPLETED') {
    return (
      <div
        className="w-full py-3 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        <CheckCircle2 size={14} />
        {labels.completed}
      </div>
    );
  }
  if (bookingStatus === 'CANCELLED') {
    return (
      <div
        className="w-full py-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-500 flex items-center justify-center gap-2"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        <X size={14} />
        {labels.cancelled}
      </div>
    );
  }
  if (bookingStatus === 'IN_PROGRESS') {
    return (
      <button
        type="button"
        onClick={() => onComplete(bookingId)}
        disabled={pending}
        className="w-full py-3 rounded-2xl bg-blue-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-blue-200 dark:shadow-none disabled:opacity-60"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        <CheckCircle2 size={16} />
        {labels.complete}
      </button>
    );
  }
  // Default: SCHEDULED. Start + Cancel.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onStart(bookingId)}
        disabled={pending}
        className="w-full py-3 rounded-2xl bg-green-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-md shadow-green-200 dark:shadow-none disabled:opacity-60"
        style={{ fontSize: '14px', fontWeight: 700 }}
      >
        <CheckCircle2 size={16} />
        {labels.start}
      </button>
      <button
        type="button"
        onClick={() => onCancel(bookingId)}
        disabled={pending}
        className="w-full py-2 rounded-2xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
        style={{ fontSize: '12px', fontWeight: 600 }}
      >
        {labels.cancel}
      </button>
    </div>
  );
}

// ─── My Bids Screen ───────────────────────────────────────────────────────────
// Sprint 5.3 — live read from /v1/me/provider/bids. The screen filters
// out WITHDRAWN bids client-side because the existing UI only renders
// 'pending' / 'accepted' / 'rejected' tabs.
// Sprint 5.4 — when a bid is ACCEPTED the linked booking surfaces
// state-aware Start / Complete / Cancel transition buttons.
function MyBidsScreen() {
  const { lang } = useLang();
  const myBidsQuery = useMyBids();
  // Sprint 5.4: load bookings so the screen can map an ACCEPTED bid
  // to its booking id and surface the right transition button.
  const bookingsQuery = useProviderBookings();
  const startBooking = useStartProviderBooking();
  const completeBooking = useCompleteProviderBooking();
  const cancelBooking = useCancelProviderBooking();

  // bidId -> { bookingId, status } so we can:
  //   * render Start when SCHEDULED
  //   * render Complete when IN_PROGRESS
  //   * render Cancel when SCHEDULED (not after start)
  //   * hide buttons entirely when COMPLETED / CANCELLED
  const bookingByBidId = useMemo<Record<string, { bookingId: string; status: string }>>(() => {
    const map: Record<string, { bookingId: string; status: string }> = {};
    for (const b of bookingsQuery.data?.items ?? []) {
      map[b.bidId] = { bookingId: b.id, status: b.status };
    }
    return map;
  }, [bookingsQuery.data]);

  const myBids = useMemo(() => {
    const items = myBidsQuery.data?.items ?? [];
    return items
      .filter((b) => b.status !== 'WITHDRAWN')
      .map((b) => {
        const labelEn = b.request.category?.labelEn ?? b.request.customServiceText ?? '';
        const labelAr = b.request.category?.labelAr ?? b.request.customServiceText ?? '';
        const icon = iconForCategorySlug(b.request.category?.slug ?? null);
        const linkedBooking = bookingByBidId[b.id] ?? null;
        return {
          id: b.id,
          requestService: labelEn,
          requestServiceAr: labelAr,
          requestIcon: icon,
          // Wire deliberately omits seeker identity. Show city as the
          // anonymised "where" label until the bid is accepted, after
          // which the booking conversation surfaces the seeker name.
          seekerName: b.request.city,
          status: b.status.toLowerCase() as 'pending' | 'accepted' | 'rejected',
          bookingId: linkedBooking?.bookingId ?? null,
          bookingStatus: linkedBooking?.status ?? null,
          price: b.amount,
          executionTime: formatResponseTime(b.responseTimeMinutes, lang),
          note: b.note ?? '',
          submittedAt: formatRelativeTime(b.submittedAt, lang),
        };
      });
  }, [myBidsQuery.data, bookingByBidId, lang]);

  const L = {
    title: lang === 'ar' ? 'عروضي' : 'My Bids',
    pending: lang === 'ar' ? 'قيد الانتظار' : 'Pending',
    accepted: lang === 'ar' ? 'مقبول' : 'Accepted',
    rejected: lang === 'ar' ? 'مرفوض' : 'Rejected',
    price: lang === 'ar' ? 'السعر:' : 'Price:',
    time: lang === 'ar' ? 'الوقت:' : 'Time:',
    startJob: lang === 'ar' ? 'ابدأ العمل' : 'Start Job',
    completeJob: lang === 'ar' ? 'إنهاء العمل' : 'Mark Complete',
    cancelJob: lang === 'ar' ? 'إلغاء الحجز' : 'Cancel Booking',
    inProgress: lang === 'ar' ? 'قيد التنفيذ' : 'In Progress',
    completed: lang === 'ar' ? 'مكتمل' : 'Completed',
    cancelled: lang === 'ar' ? 'ملغى' : 'Cancelled',
    bookingPending: lang === 'ar' ? 'بانتظار التأكيد…' : 'Waiting for booking…',
    noBids: lang === 'ar' ? 'لم تقدم أي عروض بعد' : 'No bids submitted yet',
    noBidsSub:
      lang === 'ar'
        ? 'ابدأ بتقديم عروض على الطلبات القريبة'
        : 'Start placing bids on nearby requests',
    for: lang === 'ar' ? 'من' : 'for',
  };

  const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    pending: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-400',
      label: L.pending,
    },
    accepted: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-400',
      label: L.accepted,
    },
    rejected: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-600 dark:text-red-400',
      label: L.rejected,
    },
  };

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-5 pb-4">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex gap-2 mt-3">
          {(['pending', 'accepted', 'rejected'] as const).map((s) => {
            const cnt = myBids.filter((b) => b.status === s).length;
            return (
              <div
                key={s}
                className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 ${STATUS_STYLE[s].bg}`}
              >
                <span
                  className={STATUS_STYLE[s].text}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {STATUS_STYLE[s].label}
                </span>
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center ${STATUS_STYLE[s].text}`}
                  style={{ fontSize: '9px', fontWeight: 800, background: 'rgba(0,0,0,0.08)' }}
                >
                  {cnt}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-4">
        {myBids.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Briefcase size={32} className="text-slate-300" />
            </div>
            <div className="text-center">
              <p
                className="text-slate-700 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {L.noBids}
              </p>
              <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
                {L.noBidsSub}
              </p>
            </div>
          </div>
        ) : (
          myBids.map((bid) => {
            const ss = STATUS_STYLE[bid.status];
            return (
              <motion.div
                key={bid.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                    {bid.requestIcon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '14px', fontWeight: 700 }}
                      >
                        {lang === 'ar' ? bid.requestServiceAr : bid.requestService}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-lg ${ss.bg} ${ss.text}`}
                        style={{ fontSize: '10px', fontWeight: 700 }}
                      >
                        {ss.label}
                      </span>
                    </div>
                    <p className="text-slate-400" style={{ fontSize: '12px' }}>
                      {L.for} {bid.seekerName} · {bid.submittedAt}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 mb-3">
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.price}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '16px', fontWeight: 800 }}
                    >
                      ${bid.price}/hr
                    </p>
                  </div>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {L.time}
                    </p>
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 700 }}
                    >
                      {bid.executionTime}
                    </p>
                  </div>
                </div>

                {bid.note && (
                  <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2 mb-3">
                    <p
                      className="text-slate-500 dark:text-slate-400"
                      style={{ fontSize: '12px', lineHeight: '1.4' }}
                    >
                      "{bid.note}"
                    </p>
                  </div>
                )}

                {bid.status === 'accepted' && (
                  <BookingTransitionPanel
                    bookingId={bid.bookingId}
                    bookingStatus={bid.bookingStatus}
                    onStart={(id) => startBooking.mutate(id)}
                    onComplete={(id) => completeBooking.mutate(id)}
                    onCancel={(id) => cancelBooking.mutate(id)}
                    pending={
                      startBooking.isPending || completeBooking.isPending || cancelBooking.isPending
                    }
                    labels={{
                      start: L.startJob,
                      complete: L.completeJob,
                      cancel: L.cancelJob,
                      inProgress: L.inProgress,
                      completed: L.completed,
                      cancelled: L.cancelled,
                      pendingBooking: L.bookingPending,
                    }}
                  />
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Wallet Screen ────────────────────────────────────────────────────────────
// Bucket COMPLETED transactions into the last 7 days for the wallet
// weekly chart. Pure: takes the raw transaction list, returns one
// Wallet screen day-label localiser. The server returns ISO 'YYYY-MM-DD'
// strings; the Recharts X-axis just needs a short human-readable tick.
const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

function WalletScreen() {
  const { lang } = useLang();

  // Sprint 5.6 (refined): canonical /v1/provider/earnings/* read model.
  // Withdrawals are intentionally out of scope; the CTA stays disabled
  // until the payouts module ships.
  const summaryQuery = useProviderEarningsSummary();
  const txQuery = useProviderEarningsTransactions({});
  const [chartRange, setChartRange] = useState<EarningsChartRange>('30d');
  const chartQuery = useProviderEarningsChart(chartRange);

  const summary = summaryQuery.data;
  const currency = summary?.currency ?? 'USD';
  const transactions = txQuery.data?.items ?? [];

  // Build the AreaChart data from the canonical /chart buckets. Every
  // bucket has a stable ISO date and a gross amount; no client-side
  // bucketing math is needed beyond mapping ISO → weekday/short-date.
  const chartData = useMemo(() => {
    const buckets = chartQuery.data?.buckets ?? [];
    return buckets.map((b) => {
      const d = new Date(`${b.date}T00:00:00Z`);
      const wkLabels = lang === 'ar' ? WEEKDAY_LABELS_AR : WEEKDAY_LABELS_EN;
      // For 7d ranges show weekday labels; for longer windows show
      // 'MM-DD' so the axis stays legible at 30/90 ticks.
      const tick =
        chartRange === '7d' ? (wkLabels[d.getUTCDay()] ?? b.date.slice(5)) : b.date.slice(5);
      return { tick, gross: b.grossEarnings / 100, net: b.netEarnings / 100 };
    });
  }, [chartQuery.data, chartRange, lang]);

  const L = {
    title: lang === 'ar' ? 'المحفظة والأرباح' : 'Wallet & Earnings',
    available: lang === 'ar' ? 'الرصيد المتاح' : 'Available Balance',
    gross: lang === 'ar' ? 'إجمالي' : 'Gross',
    fees: lang === 'ar' ? 'العمولة' : 'Platform Fees',
    pending: lang === 'ar' ? 'معلق' : 'Pending',
    completed: lang === 'ar' ? 'مهام منجزة' : 'Jobs Done',
    payoutCta: lang === 'ar' ? 'السحب البنكي قريباً' : 'Bank withdrawals — coming soon',
    history: lang === 'ar' ? 'سجل المعاملات' : 'Transaction History',
    historyEmpty:
      lang === 'ar'
        ? 'لا توجد معاملات بعد. أكمل أول حجز لتظهر هنا.'
        : 'No transactions yet. Complete your first booking to see them here.',
    rangeTitle: lang === 'ar' ? 'الأرباح اليومية' : 'Daily earnings',
    range7d: lang === 'ar' ? '٧ أيام' : '7d',
    range30d: lang === 'ar' ? '٣٠ يوم' : '30d',
    range90d: lang === 'ar' ? '٩٠ يوم' : '90d',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…',
    failed:
      lang === 'ar'
        ? 'تعذّر تحميل الأرباح. حاول مرة أخرى لاحقاً.'
        : 'Could not load earnings. Try again later.',
    feeFootnote: (bps: number) =>
      lang === 'ar'
        ? `بعد عمولة المنصة ${(bps / 100).toFixed(0)}٪`
        : `After ${(bps / 100).toFixed(0)}% platform fee`,
  };

  // Format an integer marketplace currency unit (cents-equivalent in
  // the schema) into a human-readable string. `currency` comes from
  // the server and reflects the dominant booking currency.
  const formatAmount = (amount: number) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount / 100);

  const summaryError = summaryQuery.isError;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Header card — Available Balance is the headline value. Gross,
         platform fees, and pending sit underneath as supporting tiles. */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 mx-4 mt-4 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute -top-8 -end-8 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 start-0 w-24 h-24 rounded-full bg-purple-500/20" />
        <div className="relative">
          <p className="text-white/70 mb-1" style={{ fontSize: '12px' }}>
            {L.available}
          </p>
          <p
            className="text-white"
            style={{ fontSize: '38px', fontWeight: 900, letterSpacing: '-0.02em' }}
          >
            {summary ? formatAmount(summary.availableBalance) : summaryError ? '—' : '…'}
          </p>
          {summary ? (
            <p className="text-white/60 mt-1" style={{ fontSize: '11px' }}>
              {L.feeFootnote(summary.platformFeeRateBps)}
            </p>
          ) : null}
          <div className="flex gap-3 mt-4 flex-wrap">
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.gross}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? formatAmount(summary.grossEarnings) : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.fees}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? `−${formatAmount(summary.platformFees)}` : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.pending}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? formatAmount(summary.pendingBalance) : '…'}
              </p>
            </div>
            <div className="bg-white/15 rounded-2xl px-3 py-2 flex-1 min-w-[80px]">
              <p className="text-white/60" style={{ fontSize: '10px' }}>
                {L.completed}
              </p>
              <p className="text-white" style={{ fontSize: '14px', fontWeight: 700 }}>
                {summary ? summary.completedBookingsCount : '…'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {summaryError ? (
        <div className="mx-4 mt-3 text-rose-600 text-center" style={{ fontSize: '12px' }}>
          {L.failed}
        </div>
      ) : null}

      {/* Payout placeholder — withdrawals are out of scope until the
         payouts module ships. Disabled to make the affordance honest;
         no fake setTimeout success. */}
      <div className="px-4 mt-3">
        <button
          disabled
          className="w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 bg-slate-200 dark:bg-slate-700 text-slate-500 cursor-not-allowed"
          style={{ fontSize: '15px', fontWeight: 800 }}
          aria-disabled="true"
        >
          <TrendingUp size={18} />
          {L.payoutCta}
        </button>
      </div>

      {/* Daily-earnings chart — server-side buckets from /v1/provider/
         earnings/chart. Range toggle: 7d / 30d / 90d. */}
      <div className="mx-4 mt-4 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {L.rangeTitle}
          </p>
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-full p-0.5">
            {(['7d', '30d', '90d'] as const).map((r) => {
              const active = chartRange === r;
              const label = r === '7d' ? L.range7d : r === '30d' ? L.range30d : L.range90d;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setChartRange(r)}
                  className={`px-3 py-1 rounded-full transition-colors ${
                    active ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm' : 'text-slate-500'
                  }`}
                  style={{ fontSize: '11px', fontWeight: 700 }}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {chartQuery.isPending ? (
          <p className="text-slate-400 py-8 text-center" style={{ fontSize: '12px' }}>
            {L.loading}
          </p>
        ) : chartQuery.isError ? (
          <p className="text-rose-600 py-8 text-center" style={{ fontSize: '12px' }}>
            {L.failed}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -25 }}>
              <defs>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="tick"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={chartRange === '7d' ? 0 : 24}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                  fontSize: '12px',
                }}
                formatter={(v: number) => [formatAmount(v * 100), L.gross]}
              />
              <Area
                type="monotone"
                dataKey="gross"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#blueGrad)"
                dot={chartRange === '7d' ? { fill: '#3b82f6', r: 3 } : false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Transaction history — COMPLETED-only canonical rows. */}
      <div className="mx-4 mt-4 mb-4">
        <p
          className="text-slate-900 dark:text-white mb-3"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {L.history}
        </p>
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          {transactions.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10 px-4 gap-3 text-center"
              role="status"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Wallet size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-400" style={{ fontSize: '13px' }}>
                {txQuery.isError ? L.failed : txQuery.isPending ? L.loading : L.historyEmpty}
              </p>
            </div>
          ) : (
            transactions.map((tx, i) => {
              const label =
                (lang === 'ar' ? tx.service.categoryLabelAr : tx.service.categoryLabelEn) ??
                tx.service.customServiceText ??
                tx.bookingId;
              return (
                <div
                  key={tx.id}
                  className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
                >
                  <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-900/30">
                    <TrendingUp size={14} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-slate-800 dark:text-slate-100"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {label}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {tx.city ? `${tx.city} · ` : ''}
                      {formatRelativeTime(tx.occurredAt, lang)}
                    </p>
                  </div>
                  <div className="text-end">
                    <p style={{ fontSize: '14px', fontWeight: 700, color: '#16a34a' }}>
                      +{formatAmount(tx.netAmount)}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '10px' }}>
                      {formatAmount(tx.amount)} − {formatAmount(tx.platformFee)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Provider Profile ─────────────────────────────────────────────────────────
// Tailwind palette for skill chips. Cycled by index so the chip colours
// stay distinct without the previous hardcoded mapping (which only
// covered the four English skill names that no longer drive the data).
const SKILL_CHIP_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
];

// "Member since Jan 2023" formatter. Localised to en-US / ar-SA so the
// month name flips with language. Falls back to an empty string when
// the wire timestamp is somehow missing — the surrounding paragraph
// hides cleanly.
function formatMemberSince(iso: string, lang: 'en' | 'ar'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function ProviderProfileScreen() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const auth = useAuth();
  const profileQuery = useProviderProfile();
  const upgradeMut = useUpgradeToProvider();
  const availabilityMut = useUpdateProviderAvailability();

  // Phase 5 Feature 5 — local view router so the menu can swap to
  // <EditProfilePage> in place (mirrors the seeker ProfileTab pattern
  // at apps/web/src/app/components/profile/ProfileTab.tsx:467). When
  // the user finishes editing they hit Back which sets view=null and
  // returns here.
  const [view, setView] = useState<'editProfile' | null>(null);
  // Phase 5 Bug 4 — debounce double-clicks on Sign Out so the user
  // can't fire two logout requests while the auth-provider is still
  // tearing down the session.
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Drop the "/provider" intent BEFORE logout flips auth/me — once
    // auth/me clears, RequireAuth fires its own redirect and this
    // component unmounts; sessionStorage writes from an unmounted
    // closure are racy. The intent is what would otherwise yank the
    // user back into /provider on the next login from /select.
    clearIntendedApp();
    // Navigate FIRST so a stale /provider URL never paints behind the
    // logout call — and so the redirect doesn't depend on
    // setQueryData → useAuth re-render → RequireAuth observation
    // landing in time. We use replace:true so the back button doesn't
    // bounce the user into a half-logged-out provider shell.
    navigate('/login', { replace: true });
    try {
      // useAuth().logout() POSTs /v1/auth/logout (best-effort) and
      // — succeed or fail — sets the cached /auth/me to null and
      // purges every non-auth React Query so no stale Provider data
      // bleeds into the next session.
      await auth.logout();
    } catch {
      // doLogout already swallows API errors; reaching the catch here
      // would be a programming error. Either way the navigate above
      // has already moved the user off the protected shell.
    } finally {
      setSigningOut(false);
    }
  };

  if (view === 'editProfile') {
    return <EditProfilePage onBack={() => setView(null)} appContext="provider" />;
  }

  const profile = profileQuery.data?.profile ?? null;
  // Onboarding: only when the cache has NO profile yet AND the last GET
  // came back 403/404. Once the upgrade mutation seeds the cache, `profile`
  // is non-null and we render the real surface even if React Query is
  // mid-refetch (the prior 403 error is still pinned to the query state
  // until the next fetch resolves).
  const upgradeNeeded = (() => {
    if (profile) return false;
    const status = profileQuery.error?.response?.status;
    return status === 403 || status === 404;
  })();

  const L = {
    title: lang === 'ar' ? 'ملف المحترف' : 'My Profile',
    online: lang === 'ar' ? 'متاح للعمل' : 'Available for work',
    offline: lang === 'ar' ? 'غير متاح' : 'Unavailable',
    paused: lang === 'ar' ? 'متوقف مؤقتاً' : 'Paused',
    skills: lang === 'ar' ? 'مهاراتي' : 'My Skills',
    skillsEmpty: lang === 'ar' ? 'لم تضف مهارات بعد' : 'No skills added yet',
    jobsDone: lang === 'ar' ? 'مهام منجزة' : 'Jobs Done',
    rating: lang === 'ar' ? 'التقييم' : 'Rating',
    reviews: lang === 'ar' ? 'مراجعات' : 'Reviews',
    editProfile: lang === 'ar' ? 'تعديل الملف' : 'Edit Profile',
    settings: lang === 'ar' ? 'الإعدادات' : 'Settings',
    support: lang === 'ar' ? 'الدعم الفني' : 'Support',
    signOut: lang === 'ar' ? 'تسجيل الخروج' : 'Sign Out',
    level: lang === 'ar' ? 'محترف Pro' : 'Pro Professional',
    levelStandard: lang === 'ar' ? 'محترف' : 'Professional',
    memberSince: lang === 'ar' ? 'عضو منذ' : 'Member since',
    receivingRequests: lang === 'ar' ? 'تستقبل الطلبات' : 'Receiving requests',
    hiddenFromMap: lang === 'ar' ? 'مخفي عن الخريطة' : 'Hidden from map',
    onboardingTitle: lang === 'ar' ? 'كن مزوّد خدمة على المنصة' : 'Become a service provider',
    onboardingBody:
      lang === 'ar'
        ? 'فعّل حسابك كمحترف لرؤية الطلبات القريبة وتقديم العروض.'
        : 'Activate your professional account to see nearby requests and submit bids.',
    onboardingCta: lang === 'ar' ? 'تفعيل حساب المحترف' : 'Activate Provider Account',
    onboardingPending: lang === 'ar' ? 'جارٍ التفعيل…' : 'Activating…',
    upgradeError:
      lang === 'ar'
        ? 'تعذر تفعيل الحساب. حاول مرة أخرى.'
        : "We couldn't activate your provider account. Please try again.",
    availabilityError:
      lang === 'ar'
        ? 'تعذر تحديث الحالة. حاول مرة أخرى.'
        : "We couldn't update your availability. Please try again.",
    profileError:
      lang === 'ar'
        ? 'تعذر تحميل ملف المحترف. حاول مرة أخرى.'
        : "We couldn't load your provider profile. Please try again.",
  };

  // ── Onboarding state — same gradient hero, no fake stats ────────────────
  if (upgradeNeeded) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <p className="text-white relative" style={{ fontSize: '20px', fontWeight: 800 }}>
            {L.onboardingTitle}
          </p>
          <p
            className="text-white/70 relative mt-1.5"
            style={{ fontSize: '13px', lineHeight: '1.5' }}
          >
            {L.onboardingBody}
          </p>
        </div>
        <div className="px-4 -mt-3 z-10 relative">
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 mb-4 flex flex-col items-stretch">
            <button
              onClick={() => upgradeMut.mutate()}
              disabled={upgradeMut.isPending}
              className="w-full flex items-center justify-center gap-2.5 py-4 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all disabled:opacity-60"
              style={{ fontSize: '15px', fontWeight: 800 }}
            >
              {upgradeMut.isPending ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {L.onboardingPending}
                </>
              ) : (
                <>
                  <Award size={18} />
                  {L.onboardingCta}
                </>
              )}
            </button>
            {upgradeMut.isError && (
              <p
                className="mt-3 text-red-600"
                style={{ fontSize: '12px', fontWeight: 600 }}
                role="alert"
              >
                {L.upgradeError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Loading skeleton — preserve hero shape so the layout doesn't jump ───
  if (!profile) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="flex items-center gap-4 relative">
            <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-white/30" />
              <div className="h-3 w-24 rounded bg-white/20" />
            </div>
          </div>
        </div>
        {profileQuery.isError && !upgradeNeeded && (
          <div className="px-4 mt-4">
            <p
              className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
              style={{ fontSize: '13px', fontWeight: 600 }}
              role="alert"
            >
              {L.profileError}
            </p>
          </div>
        )}
      </div>
    );
  }

  const isOnline = profile.availability === 'ONLINE';
  const isPaused = profile.availability === 'PAUSED';
  const availabilityLabel = isOnline ? L.online : isPaused ? L.paused : L.offline;
  const availabilityHint = isOnline ? L.receivingRequests : L.hiddenFromMap;

  const handleAvailabilityToggle = () => {
    if (availabilityMut.isPending) return;
    const next: ProviderAvailability = isOnline ? 'OFFLINE' : 'ONLINE';
    availabilityMut.mutate({ availability: next });
  };

  const memberSince = formatMemberSince(profile.createdAt, lang === 'ar' ? 'ar' : 'en');
  const ratingDisplay = profile.reviewCount > 0 ? `${profile.ratingAvg.toFixed(1)}★` : '—';
  const proLabel = profile.topPro ? L.level : L.levelStandard;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="flex items-center gap-4 relative">
          <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30 flex items-center justify-center">
            <span className="text-white" style={{ fontSize: '24px', fontWeight: 900 }}>
              {profile.initials}
            </span>
          </div>
          <div>
            <p className="text-white" style={{ fontSize: '20px', fontWeight: 800 }}>
              {profile.displayName}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Award size={12} className="text-amber-300" />
              <span className="text-white/70" style={{ fontSize: '12px' }}>
                {proLabel}
              </span>
            </div>
            {memberSince && (
              <p className="text-white/50 mt-0.5" style={{ fontSize: '11px' }}>
                {L.memberSince} {memberSince}
              </p>
            )}
          </div>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-5 relative">
          {[
            { val: String(profile.completedJobs), label: L.jobsDone },
            { val: ratingDisplay, label: L.rating },
            { val: String(profile.reviewCount), label: L.reviews },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 rounded-2xl py-3 flex flex-col items-center">
              <span className="text-white" style={{ fontSize: '15px', fontWeight: 800 }}>
                {s.val}
              </span>
              <span className="text-white/60" style={{ fontSize: '10px' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 -mt-3 z-10 relative">
        {/* Availability toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-green-100' : 'bg-slate-100'}`}
            >
              {isOnline ? (
                <CheckCircle2 size={16} className="text-green-600" />
              ) : (
                <WifiOff size={16} className="text-slate-500" />
              )}
            </div>
            <div>
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 700 }}
              >
                {availabilityLabel}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {availabilityHint}
              </p>
            </div>
          </div>
          <button
            onClick={handleAvailabilityToggle}
            disabled={availabilityMut.isPending}
            className={`w-12 h-7 rounded-full border-2 transition-all duration-300 flex items-center px-0.5 disabled:opacity-60 ${isOnline ? 'bg-green-500 border-green-500' : 'bg-slate-300 border-slate-300'}`}
            aria-label={availabilityLabel}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${isOnline ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
        {availabilityMut.isError && (
          <p
            className="-mt-3 mb-4 px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700"
            style={{ fontSize: '12px', fontWeight: 600 }}
            role="alert"
          >
            {L.availabilityError}
          </p>
        )}

        {/* Skills */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4">
          <p
            className="text-slate-900 dark:text-white mb-3"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.skills}
          </p>
          {(() => {
            const pending = profile.pendingCategories ?? [];
            const approved = profile.serviceCategories;
            if (approved.length === 0 && pending.length === 0) {
              return (
                <p className="text-slate-400" style={{ fontSize: '13px' }}>
                  {L.skillsEmpty}
                </p>
              );
            }
            // Approved + pending render in a single flex row so the chips
            // wrap together at the same `gap-2` rhythm. The dashed-border
            // affordance carries the visual distinction; we deliberately
            // do NOT split them across two rows because that would imply
            // the lists are separately scrollable.
            return (
              <div className="flex flex-wrap gap-2">
                {approved.map((cat, i) => (
                  <span
                    key={cat.id}
                    className={`px-3 py-1.5 rounded-xl ${SKILL_CHIP_COLORS[i % SKILL_CHIP_COLORS.length]} dark:bg-slate-700 dark:text-slate-200`}
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {lang === 'ar' ? cat.labelAr : cat.labelEn}
                  </span>
                ))}
                {pending.map((cat) => (
                  <span
                    key={cat.id}
                    aria-label={lang === 'ar' ? 'في انتظار موافقة الإدارة' : 'Pending approval'}
                    title={lang === 'ar' ? 'في انتظار موافقة الإدارة' : 'Pending Admin Approval'}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 border border-dashed border-slate-300 dark:bg-slate-700/40 dark:text-slate-400 dark:border-slate-600 inline-flex items-center gap-1.5 cursor-help"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    <Clock size={12} aria-hidden="true" />
                    {lang === 'ar' ? cat.labelAr : cat.labelEn}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Menu */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden mb-4">
          {[
            // Phase 5 Feature 5 — Edit Profile is now the only wired
            // menu row. The other rows are placeholders pending future
            // sprints; their non-interactivity is unchanged.
            {
              icon: <User size={16} />,
              label: L.editProfile,
              onClick: () => setView('editProfile'),
              testId: 'provider-menu-edit-profile',
            },
            {
              icon: <BarChart2 size={16} />,
              label: lang === 'ar' ? 'إحصائياتي' : 'My Analytics',
            },
            { icon: <Bell size={16} />, label: lang === 'ar' ? 'الإشعارات' : 'Notifications' },
            { icon: <Star size={16} />, label: lang === 'ar' ? 'تقييماتي' : 'My Reviews' },
          ].map(({ icon, label, onClick, testId }, i) => (
            <button
              key={i}
              type="button"
              onClick={onClick}
              data-testid={testId}
              className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-all text-start ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                {icon}
              </div>
              <span
                className="flex-1 text-slate-700 dark:text-slate-200"
                style={{ fontSize: '14px', fontWeight: 500 }}
              >
                {label}
              </span>
              <ChevronRight
                size={16}
                className="text-slate-300 dark:text-slate-600 rtl:rotate-180"
              />
            </button>
          ))}
        </div>

        {/* Phase 5 Bug 4 — Sign Out wired to useAuth().logout() (clears
            cookies + auth state + purges protected React Query) followed
            by an explicit navigate('/login') so the user lands on the
            auth screen immediately rather than briefly seeing the
            unauthenticated provider shell. */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          data-testid="provider-sign-out"
          className="w-full flex items-center justify-center gap-2.5 py-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-3xl mb-6 active:bg-red-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogOut size={18} className="text-red-500" />
          <span
            className="text-red-600 dark:text-red-400"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.signOut}
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
const PROVIDER_NAV = [
  { id: 'jobs', icon: Map, labelEn: 'Live Jobs', labelAr: 'الوظائف' },
  { id: 'bids', icon: Briefcase, labelEn: 'My Bids', labelAr: 'عروضي' },
  { id: 'chat', icon: MessageCircle, labelEn: 'Chat', labelAr: 'الدردشة' },
  { id: 'wallet', icon: Wallet, labelEn: 'Wallet', labelAr: 'المحفظة' },
  { id: 'profile', icon: User, labelEn: 'Profile', labelAr: 'ملفي' },
];

// ─── Notifications bell button (Sprint 5.5) ──────────────────────────────────
// Reads the unread count from /v1/me/notifications/unread-count?
// experience=provider with a 15 s poll. Renders a 99+ pill when the
// count is large enough that it would overflow the badge.
function ProviderNotificationsBellButton({ onOpen }: { onOpen: () => void }) {
  const countQuery = useProviderUnreadNotificationsCount();
  const count = countQuery.data?.count ?? 0;
  const display = count > 99 ? '99+' : String(count);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open notifications"
      className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
    >
      <Bell size={17} className="text-slate-600 dark:text-slate-300" />
      {count > 0 && (
        <span
          className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white"
          style={{ fontSize: '8px', fontWeight: 800 }}
        >
          {display}
        </span>
      )}
    </button>
  );
}

// ─── Notifications drawer (Sprint 5.5) ───────────────────────────────────────
// Slides in from the right. Lists provider notifications, lets the
// operator mark one read or mark-all-read. The mark-all-read mutation
// passes ?experience=provider so the seeker badge stays untouched.
function ProviderNotificationsDrawer({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const listQuery = useProviderNotifications();
  const markRead = useMarkProviderNotificationRead();
  const markAllRead = useMarkAllProviderNotificationsRead();

  const items = listQuery.data?.items ?? [];

  const L = {
    title: lang === 'ar' ? 'الإشعارات' : 'Notifications',
    markAll: lang === 'ar' ? 'تعليم الكل كمقروء' : 'Mark all read',
    empty: lang === 'ar' ? 'لا توجد إشعارات بعد.' : 'No notifications yet.',
    loading: lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…',
    failed: lang === 'ar' ? 'تعذّر تحميل الإشعارات.' : 'Could not load notifications.',
  };

  const empty = items.length === 0;
  const allRead = items.every((n) => n.readAt !== null);

  return (
    <>
      <motion.div
        className="fixed inset-0 bg-slate-900/40 z-30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed top-0 end-0 bottom-0 w-full sm:w-[400px] bg-white dark:bg-slate-800 z-40 flex flex-col shadow-2xl"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        role="dialog"
        aria-label={L.title}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <p
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '16px', fontWeight: 800 }}
          >
            {L.title}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={empty || allRead || markAllRead.isPending}
              className="text-blue-600 disabled:text-slate-400 disabled:cursor-not-allowed"
              style={{ fontSize: '12px', fontWeight: 600 }}
            >
              {L.markAll}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center"
            >
              <X size={14} className="text-slate-500" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {empty ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Bell size={20} className="text-slate-300" />
              </div>
              <p role="status" className="text-slate-400" style={{ fontSize: '13px' }}>
                {listQuery.isError ? L.failed : listQuery.isPending ? L.loading : L.empty}
              </p>
            </div>
          ) : (
            items.map((n) => {
              const isRead = n.readAt !== null;
              return (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => {
                    if (!isRead) markRead.mutate(n.id);
                  }}
                  className={`w-full text-start px-5 py-4 border-b border-slate-50 dark:border-slate-700/50 active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors ${
                    isRead ? '' : 'bg-blue-50/50 dark:bg-blue-900/10'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!isRead && (
                      <span className="mt-1 w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '13px', fontWeight: isRead ? 500 : 700 }}
                      >
                        {/* `body` and `title` come from the server,
                            already escaped on the JSON wire. React
                            renders them as text (never as HTML), so
                            no XSS surface here. */}
                        {n.title}
                      </p>
                      <p
                        className="text-slate-500 dark:text-slate-400 mt-0.5"
                        style={{ fontSize: '12px', lineHeight: 1.4 }}
                      >
                        {n.body}
                      </p>
                      <p className="text-slate-400 mt-1" style={{ fontSize: '10px' }}>
                        {formatRelativeTime(n.createdAt, lang)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </motion.div>
    </>
  );
}

// ─── Provider chat screen (Sprint 5.5) ───────────────────────────────────────
// Two-pane: left lists conversations, right shows the active thread
// + send-message form. On mobile width the right pane is full-screen
// once a conversation is selected (the back arrow returns to the list).
function ProviderChatScreen() {
  const { lang } = useLang();
  const conversationsQuery = useProviderConversations();
  const items = conversationsQuery.data?.items ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  // When the conversations list arrives the first time, auto-select
  // the most recent so the operator lands in the thread without an
  // extra tap. Subsequent list refreshes don't override the user's
  // explicit selection.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (items.length > 0) {
      setActiveId(items[0].id);
      autoSelectedRef.current = true;
    }
  }, [items]);

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
                  onClick={() => setActiveId(conv.id)}
                  className={`w-full text-start px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 active:bg-slate-50 transition-colors ${
                    isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">
                      {conv.otherParticipant.initials || '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white truncate"
                        style={{ fontSize: '13px', fontWeight: 700 }}
                      >
                        {conv.otherParticipant.displayName || (lang === 'ar' ? 'مستخدم' : 'User')}
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
          <ProviderChatThread conversationId={activeId} onBack={() => setActiveId(null)} />
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

// ─── Provider App Shell ───────────────────────────────────────────────────────
// Compute the identity strings used by the top bar. Prefer the Provider
// profile when it exists (server-derived displayName + initials, matches
// what the rest of the Provider surface shows). Otherwise fall back to
// the auth-side identity so a logged-in customer who hasn't yet
// activated their provider account still sees a real name in the bar
// instead of a hardcoded "Omar Al-Khalid".
function deriveShellIdentity(
  profile: ProviderProfileSummary | null,
  fallback: { displayName: string | null; initials: string | null },
): { displayName: string; initials: string } {
  if (profile) return { displayName: profile.displayName, initials: profile.initials };
  return {
    displayName: fallback.displayName ?? '',
    initials: fallback.initials ?? '',
  };
}

export function ProviderApp() {
  const { lang, dir, darkMode } = useLang();
  const [activeTab, setActiveTab] = useState('jobs');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  const profileQuery = useProviderProfile();
  const authIdentity = useAuthIdentity();
  const shellIdentity = useMemo(
    () => deriveShellIdentity(profileQuery.data?.profile ?? null, authIdentity),
    [profileQuery.data, authIdentity],
  );

  // Sprint 5.1.2 status gate: a provider whose profile is not ACTIVE
  // gets a focused status surface in place of the live shell — the live
  // map / bids / wallet are intentionally NOT mounted so the user
  // cannot bid before approval. The 'profile' tab still owns the
  // initial onboarding-when-no-profile flow (handled by
  // ProviderProfileScreen). The 'profile' route is exposed as a deep
  // link for DRAFT users via onContinueOnboarding so they can jump to
  // the upgrade button without losing the status surface as a back
  // stop.
  const profile = profileQuery.data?.profile ?? null;
  if (profile && profile.status !== 'ACTIVE') {
    return (
      <ProviderStatusState
        status={profile.status}
        onContinueOnboarding={() => setActiveTab('profile')}
      />
    );
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'jobs':
        return <LiveJobsScreen />;
      case 'bids':
        return <MyBidsScreen />;
      case 'chat':
        return <ProviderChatScreen />;
      case 'wallet':
        return <WalletScreen />;
      case 'profile':
        return <ProviderProfileScreen />;
      default:
        return <LiveJobsScreen />;
    }
  };

  return (
    <div
      className={`flex flex-col ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ height: '100svh', fontFamily, direction: dir }}
      dir={dir}
    >
      {/* Top bar (hidden on map tab) */}
      {activeTab !== 'jobs' && (
        <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm z-20">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
                <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
                  {shellIdentity.initials}
                </span>
              </div>
              <div>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>
                  {lang === 'ar' ? 'مرحباً 👋' : 'Welcome back 👋'}
                </p>
                <p
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {shellIdentity.displayName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LangToggle />
              <ProviderNotificationsBellButton onOpen={() => setNotificationsOpen(true)} />
            </div>
          </div>
        </div>
      )}

      {/* Sprint 5.5 — provider notifications drawer. Opens from the
          top-bar bell; reads /v1/me/notifications?experience=provider. */}
      <AnimatePresence>
        {notificationsOpen && (
          <ProviderNotificationsDrawer onClose={() => setNotificationsOpen(false)} />
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20">
        <div className="flex items-center justify-around px-2 pt-2 pb-3">
          {PROVIDER_NAV.map(({ id, icon: Icon, labelEn, labelAr }) => {
            const active = activeTab === id;
            return (
              <motion.button
                key={id}
                onClick={() => setActiveTab(id)}
                whileTap={{ scale: 0.88 }}
                className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all min-w-[60px]"
              >
                {active && (
                  <motion.div
                    layoutId="provider-nav-pill"
                    className="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 rounded-2xl"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <Icon
                  size={22}
                  className={`relative z-10 transition-colors ${active ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span
                  className="relative z-10"
                  style={{
                    fontSize: '10px',
                    fontWeight: active ? 700 : 500,
                    color: active ? '#2563eb' : '#94a3b8',
                  }}
                >
                  {lang === 'ar' ? labelAr : labelEn}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
