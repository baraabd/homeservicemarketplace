// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// The live jobs map, its bidding modal, markers and job detail overlay.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useLang } from '../../../i18n/LanguageContext';
import type { ServiceRequest } from '../../../context/EcosystemContext';
import { useProviderProfile } from '../../../hooks/provider/useProviderProfile';
import { useAvailableRequests } from '../../../hooks/provider/useAvailableRequests';
import { useSubmitBid } from '../../../hooks/provider/useMyBids';
import { mapAvailableJobToLegacy } from '../../../../lib/provider/available-jobs-adapter';
import { RequestMediaGallery } from '../../ds/RequestMediaGallery';
import { resolveMediaUrl } from '../../../../lib/media-url';
import {
  ChevronUp,
  X,
  DollarSign,
  Star,
  CheckCircle2,
  MapPin,
  Navigation,
  Send,
} from 'lucide-react';
// Leaflet powers the map. Kept in THIS module and nowhere else: it is the
// single heaviest dependency in the provider bundle, and it only earns its
// weight on the jobs route. Importing it from the shell would pull it into
// every route again and undo the split.
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

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
          {/* Meta row — Distance / Budget / Seeker.
              Layout uses flex + flex-1 (instead of a fixed 3-col grid)
              so the visible tiles split the row evenly regardless of
              count: 1 tile fills the row, 2 split 50/50, 3 split 33/33/33.
              Budget and Seeker are permanently empty in the current
              wire shape (no schema column for budget; seeker identity
              stays masked per the Sprint 5.2 security projection), so
              both conditionally render — no dead `—` placeholder.
              Distance keeps the `labels.notSet` fallback while
              `distanceKm` is null; the fallback path retires once the
              backend Haversine slice lands. */}
          <div className="flex gap-2">
            <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
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
            {hasBudget && (
              <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                <p className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600 }}>
                  {labels.budget}
                </p>
                <p
                  className="text-slate-900 dark:text-white mt-0.5 truncate"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {req.budget}
                </p>
              </div>
            )}
            {hasSeeker && (
              <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-2xl px-3 py-2.5">
                <p className="text-slate-400" style={{ fontSize: '10px', fontWeight: 600 }}>
                  {labels.seeker}
                </p>
                <p
                  className="text-slate-900 dark:text-white mt-0.5 truncate"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {req.seekerName}
                </p>
              </div>
            )}
          </div>

          {/* Seeker-uploaded photos. RequestMediaGallery normalises the
              URLs (relative paths / bare keys), renders a bounded
              horizontal strip, and swaps any failed load for an inline
              placeholder instead of the browser's broken-image glyph.
              It renders nothing when there is no media. */}
          <RequestMediaGallery urls={req.mediaUrls} testId="job-detail-media" />

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
export function LiveJobsScreen() {
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

        {/* Drag handle — the floating pull-up affordance. It sits at
            z-[1000] (above Leaflet's popup panes), which is ABOVE the
            detail overlay / bidding modal (z-40); so we must hide it
            whenever a blocking surface is open, otherwise it floats over
            the request detail and covers the Place Bid CTA. Hidden when:
            the bottom sheet is open, the request-detail overlay is open,
            or the bidding modal is open. */}
        {!sheetOpen && !detailReq && !biddingReq && (
          <motion.button
            data-testid="pull-up-control"
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
                        {(req.mediaUrls?.length ?? 0) > 0 && (
                          <div
                            className="flex gap-1 mt-2 overflow-x-auto"
                            style={{ scrollbarWidth: 'none' }}
                            data-testid={`job-card-media-${req.id}`}
                          >
                            {(req.mediaUrls ?? []).slice(0, 3).map((url) => (
                              <img
                                key={url}
                                src={resolveMediaUrl(url)}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 object-cover rounded-md border border-slate-200 dark:border-slate-600 flex-shrink-0"
                              />
                            ))}
                            {(req.mediaUrls?.length ?? 0) > 3 && (
                              <div
                                className="w-10 h-10 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-600 flex items-center justify-center text-slate-500 flex-shrink-0"
                                style={{ fontSize: '10px', fontWeight: 700 }}
                                aria-label={`+${(req.mediaUrls?.length ?? 0) - 3}`}
                              >
                                +{(req.mediaUrls?.length ?? 0) - 3}
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
