import { useMemo, useState } from 'react';
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
  Loader2,
} from 'lucide-react';
import type {
  BookingDetail,
  BookingTimelineEvent,
  ProviderBidSummary,
  ServiceRequestDetail,
  ServiceRequestStatus,
  BookingStatus,
} from '@homeservicemarketplace/contracts';
import type { LeadStatus } from './LeadCard';
import { useLang } from '../../i18n/LanguageContext';
import { useEcosystem } from '../../context/EcosystemContext';
import {
  useCancelServiceRequest,
  useRequestDetail,
  useRequestTimeline,
} from '../../hooks/seeker/useRequests';
import {
  useBookingDetail,
  useBookingTimeline,
  useCancelBooking,
} from '../../hooks/seeker/useBookings';
import { formatServiceAddressForDisplay } from '../../../lib/address-display';
import { RequestMediaGallery } from '../ds/RequestMediaGallery';
import { formatPrivacyDisplayName } from '../../../lib/privacy-name';

// ─── Source discriminator ────────────────────────────────────────────────────
// Slice 2.4: JobDetailView is opened with a request id (for OPEN_FOR_BIDS /
// CANCELLED service requests) or a booking id (for SCHEDULED / IN_PROGRESS /
// COMPLETED / CANCELLED bookings). Internally the component picks the right
// detail + timeline endpoints. Callers (HomeScreen, AllLeadsView) no longer
// pass a synthesized JobData blob — that path used to ship fake provider
// rating / review counts / tags, which violated the project rule against
// rendering mock data as real.
export type JobDetailSource = { kind: 'request'; id: string } | { kind: 'booking'; id: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SERVICE_ICON: Record<string, React.ReactNode> = {
  Plumbing: <Wrench size={20} />,
  Electrical: <Zap size={20} />,
  'AC Repair': <Wind size={20} />,
  Cleaning: <Sparkles size={20} />,
  Carpentry: <Hammer size={20} />,
  Painting: <PaintBucket size={20} />,
  General: <Wrench size={20} />,
};

const SERVICE_COLOR: Record<string, { bg: string; icon: string }> = {
  Plumbing: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  Electrical: { bg: 'bg-amber-100', icon: 'text-amber-600' },
  'AC Repair': { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
  Cleaning: { bg: 'bg-green-100', icon: 'text-green-600' },
  Carpentry: { bg: 'bg-orange-100', icon: 'text-orange-700' },
  Painting: { bg: 'bg-purple-100', icon: 'text-purple-600' },
  General: { bg: 'bg-slate-100', icon: 'text-slate-600' },
};

// Service-category slug → SERVICE_ICON / SERVICE_COLOR key. Centralised here
// so the icon mapping survives the rename of the slice-2 string-based service
// labels — the API sends slugs, not English labels.
function serviceKeyFromSlug(slug: string | null | undefined, fallbackLabel: string): string {
  switch (slug) {
    case 'plumbing':
      return 'Plumbing';
    case 'electrical':
      return 'Electrical';
    case 'ac-repair':
      return 'AC Repair';
    case 'cleaning':
      return 'Cleaning';
    case 'carpentry':
      return 'Carpentry';
    case 'painting':
      return 'Painting';
    default:
      // Last-resort heuristic: scan the English label for known keywords.
      // Wraps the slice-2 placeholder logic so unknown slugs still render a
      // colour rather than the slate-grey 'General' fallback when possible.
      if (fallbackLabel.includes('Plumbing')) return 'Plumbing';
      if (fallbackLabel.includes('AC')) return 'AC Repair';
      if (fallbackLabel.includes('Cleaning')) return 'Cleaning';
      if (fallbackLabel.includes('Cabinet') || fallbackLabel.includes('Carpentry'))
        return 'Carpentry';
      if (fallbackLabel.includes('Electrical')) return 'Electrical';
      if (fallbackLabel.includes('Paint')) return 'Painting';
      return 'General';
  }
}

// API status → existing 4-state UI status. The visual status pill / colour
// palette is preserved exactly; only the source moves.
function uiStatusFromRequest(s: ServiceRequestStatus): LeadStatus {
  switch (s) {
    case 'CANCELLED':
      return 'cancelled';
    case 'BID_ACCEPTED':
      // OPEN_FOR_BIDS → pending; BID_ACCEPTED → active (the request has a
      // booking attached but the booking flow is the active surface).
      return 'active';
    case 'OPEN_FOR_BIDS':
    default:
      return 'pending';
  }
}

function uiStatusFromBooking(s: BookingStatus): LeadStatus {
  switch (s) {
    case 'IN_PROGRESS':
      return 'active';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'SCHEDULED':
    default:
      return 'active';
  }
}

// HH:MM AM/PM in the active language. Returns null for missing / invalid input
// so the timeline can omit the timestamp gracefully — never ship "Invalid Date"
// to the DOM.
function formatTimeOfDay(iso: string | null | undefined, lang: 'en' | 'ar'): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return d.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', opts);
}

function formatScheduledDate(iso: string | null | undefined, lang: 'en' | 'ar'): string {
  if (!iso) return lang === 'ar' ? 'في أقرب وقت' : 'ASAP';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return lang === 'ar' ? 'في أقرب وقت' : 'ASAP';
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  return `${d.toLocaleDateString(locale, dateOpts)}, ${d.toLocaleTimeString(locale, timeOpts)}`;
}

// "2h ago" style — used as the small subtitle next to the JOB-id strip.
function formatRelative(iso: string | null | undefined, lang: 'en' | 'ar'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) {
    const m = Math.max(1, Math.floor(diff / minute));
    return lang === 'ar' ? `${m} د` : `${m}m ago`;
  }
  if (diff < day) {
    const h = Math.floor(diff / hour);
    return lang === 'ar' ? `${h} س` : `${h}h ago`;
  }
  const days = Math.floor(diff / day);
  return lang === 'ar' ? `${days} ي` : `${days}d ago`;
}

// ─── Step derivation ──────────────────────────────────────────────────────────
// Maps real timeline events → the 5 abstract steps the visual already
// renders. Steps without an event are marked not-done; the existing visual
// (slate dot, slate label) handles that case. The 5 step labels are
// preserved exactly.
interface StepInfo {
  done: boolean;
  doneAt: string | null;
}

function stepsForRequest(
  status: ServiceRequestStatus,
  events: { type: string; createdAt: string }[],
  lang: 'en' | 'ar',
): StepInfo[] {
  const find = (type: string) => events.find((e) => e.type === type);
  const created = find('REQUEST_CREATED');
  const updated = find('REQUEST_UPDATED');
  const isPending = status === 'OPEN_FOR_BIDS';
  const isAccepted = status === 'BID_ACCEPTED';
  return [
    // Posted: emitted on every request the moment REQUEST_CREATED fires.
    { done: !!created, doneAt: formatTimeOfDay(created?.createdAt ?? null, lang) },
    // Bids Received: this slice does not emit a dedicated BIDS_RECEIVED event;
    // mark the step as not-done. A future Provider/bidding slice will fire a
    // matching event and we wire it here.
    { done: false, doneAt: null },
    // Pro Assigned: the REQUEST_UPDATED event with metadata.acceptedBidId is
    // emitted from inside accept-bid (slice 2.2). Done when the request is
    // already past OPEN_FOR_BIDS.
    {
      done: isAccepted || (!!updated && !isPending),
      doneAt: updated ? formatTimeOfDay(updated.createdAt, lang) : null,
    },
    // In Progress / Completed: only emitted from the booking-side timeline
    // (future slice). For a request-only view they stay not-done.
    { done: false, doneAt: null },
    { done: false, doneAt: null },
  ];
}

function stepsForBooking(
  status: BookingStatus,
  events: { type: string; metadata?: Record<string, unknown> | null; createdAt: string }[],
  lang: 'en' | 'ar',
  // Sprint 7.12 — the parent ServiceRequest's createdAt timestamp,
  // surfaced on BookingDetail via the new `requestCreatedAt` field.
  // When present, drives the "Posted" step's wall-clock time so the
  // booking-side timeline matches the request-side timeline exactly.
  requestCreatedAtIso: string | null = null,
): StepInfo[] {
  const find = (type: string) => events.find((e) => e.type === type);
  const created = find('BOOKING_CREATED');
  // Sprint 7.x — BOOKING_STATUS_CHANGED events are emitted by the
  // provider lifecycle service (start / complete) with metadata.to
  // carrying the target status. There can be MORE THAN ONE — start
  // writes `to: 'IN_PROGRESS'`, complete writes `to: 'COMPLETED'` —
  // so the simple `find(type)` would return only the first. We
  // filter by metadata.to to pull the exact transition timestamp for
  // each step.
  const findStatusChange = (to: BookingStatus) =>
    events.find(
      (e) =>
        e.type === 'BOOKING_STATUS_CHANGED' &&
        e.metadata !== null &&
        typeof e.metadata === 'object' &&
        (e.metadata as { to?: unknown }).to === to,
    );
  const startedEvent = findStatusChange('IN_PROGRESS');
  const completedEvent = findStatusChange('COMPLETED');
  const isInProgress = status === 'IN_PROGRESS';
  const isCompleted = status === 'COMPLETED';
  return [
    // Sprint 7.12 — Posted: source priority is now
    // (1) requestCreatedAt from the BookingDetail DTO (new field),
    // (2) booking.createdAt as a last-resort upper bound. The
    // booking detail no longer ships an empty wall-clock for Posted
    // — the field is non-null on every response.
    {
      done: true,
      doneAt: formatTimeOfDay(requestCreatedAtIso ?? null, lang),
    },
    // Bids Received: same caveat as the request branch — no event yet.
    // Implicitly done because we have a booking (a bid was accepted).
    { done: true, doneAt: null },
    // Pro Assigned: the BOOKING_CREATED event marks the moment the bid
    // was accepted and the booking row was written.
    { done: !!created, doneAt: formatTimeOfDay(created?.createdAt ?? null, lang) },
    // In Progress: BOOKING_STATUS_CHANGED with metadata.to === 'IN_PROGRESS'.
    // Sprint 7.x — also surfaces the wall-clock timestamp (e.g. "1:09 PM")
    // beside the stage when the event row is present.
    {
      done: isInProgress || isCompleted || !!startedEvent,
      doneAt: formatTimeOfDay(startedEvent?.createdAt ?? null, lang),
    },
    // Completed: BOOKING_STATUS_CHANGED with metadata.to === 'COMPLETED'.
    {
      done: isCompleted || !!completedEvent,
      doneAt: formatTimeOfDay(completedEvent?.createdAt ?? null, lang),
    },
  ];
  // BOOKING_CANCELLED events are not surfaced through the 5-step timeline;
  // the top-of-screen status pill ("Cancelled") communicates that. The
  // visual structure of the 5-step timeline stays identical regardless.
}

// ─── Status Timeline ──────────────────────────────────────────────────────────
function StatusTimeline({
  status,
  steps,
  lang,
}: {
  status: LeadStatus;
  steps: StepInfo[];
  lang: 'en' | 'ar';
}) {
  const labels = [
    { en: 'Posted', ar: 'تم النشر' },
    { en: 'Bids Received', ar: 'وصلت عروض' },
    { en: 'Pro Assigned', ar: 'تعيين محترف' },
    { en: 'In Progress', ar: 'جارٍ التنفيذ' },
    { en: 'Completed', ar: 'مكتمل' },
  ];

  // The "current" step is the first not-done step (or the last when
  // everything is done). For cancelled jobs the timeline shows whatever
  // ran before the cancel; no step is marked current.
  const activeIndex = steps.findIndex((s) => !s.done);
  const currentIdx =
    status === 'cancelled' ? -1 : activeIndex === -1 ? steps.length - 1 : activeIndex;

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

        {labels.map((step, i) => {
          const info = steps[i];
          const isDone = info?.done ?? false;
          const isCurrent = i === currentIdx;

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
                  {isDone && info?.doneAt && (
                    <span className="text-slate-400" style={{ fontSize: '10px' }}>
                      {info.doneAt}
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
  source: JobDetailSource;
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

// Unified shape the render uses regardless of which API surface populated it.
// Drives the visual exactly the same as the slice-2 hard-coded JobData did,
// minus the synthesized provider fields that do not yet exist on either
// detail endpoint.
interface RenderState {
  jobId: string;
  service: string; // SERVICE_ICON key (Plumbing / Electrical / …)
  serviceLabel: string;
  serviceLabelAr: string;
  status: LeadStatus;
  postedAt: string;
  scheduledAtIso: string | null;
  address: string | null;
  // Seeker-uploaded media (fileUrls) — surfaced so the seeker sees their
  // own photos after a hard refresh, not just in the wizard preview.
  media: string[];
  // Booking-side only
  provider: ProviderBidSummary | null;
  priceAmount: number | null;
  pricingType: 'HOURLY' | 'FIXED' | null;
  description: string | null;
  // Timeline payload
  steps: StepInfo[];
}

// ─────────────────────────────────────────────────────────────────────────────
export function JobDetailView({ source, isVisible, onBack, onOpenChat }: JobDetailViewProps) {
  const { lang, dir } = useLang();
  const langKey: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const { showHourlyRate } = useEcosystem();
  const [showRateModal, setShowRateModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Source-driven fetches. Each hook short-circuits when its `id` arg is
  // null/undefined (we pass the matching id only when source.kind matches),
  // so only one detail + one timeline query is in flight at a time.
  const requestId = source.kind === 'request' ? source.id : null;
  const bookingId = source.kind === 'booking' ? source.id : null;

  const requestDetail = useRequestDetail(requestId);
  const requestTimeline = useRequestTimeline(requestId);
  const bookingDetail = useBookingDetail(bookingId);
  const bookingTimeline = useBookingTimeline(bookingId);

  const cancelRequestMut = useCancelServiceRequest();
  const cancelBookingMut = useCancelBooking();

  const detailQuery = source.kind === 'request' ? requestDetail : bookingDetail;
  // The matching timeline query is read through requestTimeline.data /
  // bookingTimeline.data inside the memo below; we don't need a hoisted
  // alias for it here.

  const isInitialLoading = detailQuery.isLoading && !detailQuery.data;
  const isError = detailQuery.isError && !detailQuery.data;

  const render: RenderState | null = useMemo(() => {
    if (source.kind === 'request') {
      const r = requestDetail.data as ServiceRequestDetail | undefined;
      if (!r) return null;
      const labelEn =
        r.category?.labelEn ?? r.customServiceText ?? (langKey === 'ar' ? 'خدمة' : 'Service');
      const labelAr = r.category?.labelAr ?? r.customServiceText ?? labelEn;
      const events = (requestTimeline.data?.items ?? []) as
        | BookingTimelineEvent[]
        | { type: string; createdAt: string }[];
      const steps = stepsForRequest(
        r.status,
        (events as { type: string; createdAt: string }[]).map((e) => ({
          type: e.type,
          createdAt: e.createdAt,
        })),
        langKey,
      );
      return {
        jobId: r.id,
        service: serviceKeyFromSlug(r.category?.slug ?? null, labelEn),
        serviceLabel: labelEn,
        serviceLabelAr: labelAr,
        status: uiStatusFromRequest(r.status),
        postedAt: formatRelative(r.createdAt, langKey),
        scheduledAtIso: r.scheduledAt,
        // Compact, display-only address. The raw snapshot (line1, city,
        // cityKey, lat/lng) stays untouched for provider matching.
        address: formatServiceAddressForDisplay(r.addressSnapshot) || null,
        media: r.mediaUrls ?? [],
        provider: null,
        priceAmount: null,
        pricingType: null,
        description: r.description,
        steps,
      };
    }
    const b = bookingDetail.data as BookingDetail | undefined;
    if (!b) return null;
    const labelEn =
      b.service.categoryLabelEn ??
      b.service.customServiceText ??
      (langKey === 'ar' ? 'خدمة' : 'Service');
    const labelAr = b.service.categoryLabelAr ?? b.service.customServiceText ?? labelEn;
    const events = (bookingTimeline.data?.items ?? []) as { type: string; createdAt: string }[];
    // Sprint 7.12 — pass the new `requestCreatedAt` field through so
    // the booking-side "Posted" step shows the original post time
    // (not the booking createdAt, which is much later).
    const steps = stepsForBooking(
      b.status,
      events,
      langKey,
      (b as BookingDetail & { requestCreatedAt?: string }).requestCreatedAt ?? null,
    );
    return {
      jobId: b.id,
      service: serviceKeyFromSlug(b.service.categorySlug, labelEn),
      serviceLabel: labelEn,
      serviceLabelAr: labelAr,
      status: uiStatusFromBooking(b.status),
      postedAt: formatRelative(b.createdAt, langKey),
      scheduledAtIso: b.scheduledAt,
      // Compact, display-only address (see request branch above).
      address: formatServiceAddressForDisplay(b.addressSnapshot) || null,
      media: (b as BookingDetail & { requestMediaUrls?: string[] }).requestMediaUrls ?? [],
      provider: b.provider,
      priceAmount: b.priceAmount,
      pricingType: b.pricingType,
      description: b.description,
      steps,
    };
  }, [
    source.kind,
    requestDetail.data,
    requestTimeline.data,
    bookingDetail.data,
    bookingTimeline.data,
    langKey,
  ]);

  const svc = SERVICE_COLOR[render?.service ?? 'General'] ?? SERVICE_COLOR.General;
  const ico = SERVICE_ICON[render?.service ?? 'General'] ?? SERVICE_ICON.General;

  const displayService = render
    ? langKey === 'ar'
      ? render.serviceLabelAr
      : render.serviceLabel
    : '';
  const displayAddress = render?.address ?? (langKey === 'ar' ? '—' : '—');
  // Sprint 7.13 — privacy-safe provider name (initial + family name).
  const providerLabel = langKey === 'ar' ? 'مزود الخدمة' : 'Provider';
  const providerNamePrivacy = render?.provider
    ? formatPrivacyDisplayName(
        { displayName: render.provider.displayName },
        { roleFallback: providerLabel },
      )
    : providerLabel;
  const displayDate = formatScheduledDate(render?.scheduledAtIso ?? null, langKey);

  const status: LeadStatus = render?.status ?? 'pending';

  const statusColor =
    status === 'active'
      ? 'bg-blue-50 border-blue-200 text-blue-700'
      : status === 'pending'
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : status === 'completed'
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-red-50 border-red-200 text-red-700';

  const statusLabel =
    status === 'active'
      ? langKey === 'ar'
        ? 'جارٍ التنفيذ'
        : 'In Progress'
      : status === 'pending'
        ? langKey === 'ar'
          ? 'قيد الانتظار'
          : 'Awaiting Bids'
        : status === 'completed'
          ? langKey === 'ar'
            ? 'مكتمل'
            : 'Completed'
          : langKey === 'ar'
            ? 'ملغى'
            : 'Cancelled';

  const handleRateSubmit = () => {
    setRatingSubmitted(true);
    setTimeout(() => setShowRateModal(false), 1500);
  };

  // Cancel handlers — wired to real API. Errors map to safe friendly copy
  // keyed by HTTP status; raw backend payload is never rendered.
  const handleCancelRequest = () => {
    if (!requestId || cancelRequestMut.isPending) return;
    setActionError(null);
    cancelRequestMut.mutate(requestId, {
      onError: (err) => setActionError(safeErrorCopy(err, langKey)),
    });
  };
  const handleCancelBooking = () => {
    if (!bookingId || cancelBookingMut.isPending) return;
    setActionError(null);
    cancelBookingMut.mutate(bookingId, {
      onError: (err) => setActionError(safeErrorCopy(err, langKey)),
    });
  };

  // Chat / Call / Track are out-of-scope for slice 2.4. They stay visible
  // (preserve visual) but become disabled with a small "coming soon" hint
  // — clicking them does NOT open the existing ChatScreen against fake
  // contact data.
  const isPlaceholderAction = true;

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
                {displayService || (langKey === 'ar' ? 'تحميل…' : 'Loading…')}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                #{langKey === 'ar' ? 'JOB' : 'JOB'}-{(render?.jobId ?? source.id).toUpperCase()}
                {render?.postedAt ? ` · ${render.postedAt}` : ''}
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
          {/* Loading / error states. Both preserve the slate copy idiom used
              elsewhere in the Seeker app — never expose raw backend errors. */}
          {isInitialLoading && (
            <div
              className="flex flex-col items-center justify-center py-20 gap-3"
              role="status"
              aria-live="polite"
            >
              <Loader2 size={28} className="text-slate-400 animate-spin" />
              <p className="text-slate-500" style={{ fontSize: '13px' }}>
                {langKey === 'ar' ? 'جاري تحميل التفاصيل...' : 'Loading details...'}
              </p>
            </div>
          )}
          {isError && !isInitialLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3" role="alert">
              <p
                className="text-slate-700 text-center"
                style={{ fontSize: '14px', fontWeight: 600 }}
              >
                {langKey === 'ar'
                  ? 'تعذر تحميل التفاصيل. حاول مرة أخرى.'
                  : "We couldn't load the details. Please try again."}
              </p>
              <button
                onClick={() => detailQuery.refetch()}
                className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
                style={{ fontSize: '13px', fontWeight: 700 }}
              >
                {langKey === 'ar' ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}

          {render && !isError && (
            <>
              {/* Action error banner — set by the cancel mutations on failure;
                  the raw backend payload is never rendered. */}
              {actionError && (
                <div
                  className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
                  style={{ fontSize: '13px', fontWeight: 600 }}
                  role="alert"
                >
                  {actionError}
                </div>
              )}

              {/* Pro Card — booking-side only; never rendered for request-side
                  detail because no provider has been assigned yet. */}
              {render.provider && (
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
                    {langKey === 'ar' ? 'المحترف المعيّن' : 'Assigned Professional'}
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <span
                        className="text-amber-700"
                        style={{ fontSize: '16px', fontWeight: 800 }}
                      >
                        {render.provider.initials}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="text-slate-900" style={{ fontSize: '16px', fontWeight: 800 }}>
                        {providerNamePrivacy}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Stars rating={render.provider.ratingAvg} />
                        <span className="text-slate-500" style={{ fontSize: '11px' }}>
                          {render.provider.ratingAvg.toFixed(1)} · {render.provider.reviewCount}{' '}
                          {langKey === 'ar' ? 'تقييم' : 'reviews'}
                        </span>
                      </div>
                      {render.provider.verified && (
                        <div className="flex items-center gap-1 mt-1">
                          <Shield size={11} className="text-green-500" />
                          <span
                            className="text-green-600"
                            style={{ fontSize: '10px', fontWeight: 600 }}
                          >
                            {langKey === 'ar' ? 'موثّق ومرخّص' : 'Verified & Licensed'}
                          </span>
                        </div>
                      )}
                    </div>
                    {showHourlyRate && render.priceAmount !== null && (
                      <div className="text-end">
                        <p className="text-slate-900" style={{ fontSize: '20px', fontWeight: 800 }}>
                          ${render.priceAmount}
                        </p>
                        <p className="text-slate-400" style={{ fontSize: '10px' }}>
                          {render.pricingType === 'HOURLY' ? '/hr' : '/job'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Verified / Top Pro pills — only render when API confirms,
                      and only those two pills (no fake Licensed / Insured / Top
                      Rated fallback). */}
                  {(render.provider.verified || render.provider.topPro) && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {render.provider.verified && (
                        <span
                          className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600"
                          style={{ fontSize: '11px', fontWeight: 600 }}
                        >
                          {langKey === 'ar' ? 'موثّق' : 'Verified'}
                        </span>
                      )}
                      {render.provider.topPro && (
                        <span
                          className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600"
                          style={{ fontSize: '11px', fontWeight: 600 }}
                        >
                          {langKey === 'ar' ? 'محترف مميّز' : 'Top Pro'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Action buttons — kept visually intact but disabled in
                      slice 2.4. Chat / Call / Track ship in later slices;
                      we deliberately do NOT route Chat to a fabricated
                      contact. */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={isPlaceholderAction}
                      aria-disabled={isPlaceholderAction}
                      title={langKey === 'ar' ? 'قريباً' : 'Coming soon'}
                      className="flex flex-col items-center gap-1.5 py-3 bg-amber-50 border border-amber-100 rounded-2xl opacity-60 cursor-not-allowed"
                      onClick={() => {
                        // No-op: do not open ChatScreen against fabricated
                        // contact data. Kept callable so the prop shape
                        // stays stable for later wiring.
                        void onOpenChat;
                      }}
                    >
                      <MessageCircle size={18} className="text-amber-600" />
                      <span
                        className="text-amber-700"
                        style={{ fontSize: '11px', fontWeight: 700 }}
                      >
                        {langKey === 'ar' ? 'رسالة' : 'Message'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isPlaceholderAction}
                      aria-disabled={isPlaceholderAction}
                      title={langKey === 'ar' ? 'قريباً' : 'Coming soon'}
                      className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 border border-blue-100 rounded-2xl opacity-60 cursor-not-allowed"
                    >
                      <Phone size={18} className="text-blue-600" />
                      <span className="text-blue-700" style={{ fontSize: '11px', fontWeight: 700 }}>
                        {langKey === 'ar' ? 'اتصال' : 'Call'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isPlaceholderAction}
                      aria-disabled={isPlaceholderAction}
                      title={langKey === 'ar' ? 'قريباً' : 'Coming soon'}
                      className="flex flex-col items-center gap-1.5 py-3 bg-green-50 border border-green-100 rounded-2xl opacity-60 cursor-not-allowed"
                    >
                      <Navigation size={18} className="text-green-600" />
                      <span
                        className="text-green-700"
                        style={{ fontSize: '11px', fontWeight: 700 }}
                      >
                        {langKey === 'ar' ? 'تتبع' : 'Track'}
                      </span>
                    </button>
                  </div>
                  <p className="text-slate-400 mt-2 text-center" style={{ fontSize: '10px' }}>
                    {langKey === 'ar'
                      ? 'قريباً: المراسلة، الاتصال، والتتبع'
                      : 'Messaging, calls, and tracking are coming soon'}
                  </p>
                </div>
              )}

              {/* Status Timeline */}
              <StatusTimeline status={status} steps={render.steps} lang={langKey} />

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
                  {langKey === 'ar' ? 'تفاصيل الطلب' : 'Job Details'}
                </p>
                {[
                  {
                    Icon: Wrench,
                    label: langKey === 'ar' ? 'الخدمة' : 'Service',
                    val: displayService,
                  },
                  {
                    Icon: MapPin,
                    label: langKey === 'ar' ? 'الموقع' : 'Location',
                    val: displayAddress,
                  },
                  {
                    Icon: Calendar,
                    label: langKey === 'ar' ? 'الموعد' : 'Schedule',
                    val: displayDate,
                  },
                  {
                    Icon: Clock,
                    label: langKey === 'ar' ? 'نُشر منذ' : 'Posted',
                    val: render.postedAt || '—',
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0"
                  >
                    <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <row.Icon size={13} className="text-slate-500" />
                    </div>
                    <span
                      className="text-slate-400 w-20 flex-shrink-0"
                      style={{ fontSize: '12px' }}
                    >
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

              {/* Description card — only rendered when the seeker actually
                  supplied free-form text on the request. */}
              {render.description && (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
                  <p
                    className="text-slate-500 mb-2"
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {langKey === 'ar' ? 'ملاحظات' : 'Notes'}
                  </p>
                  <p
                    className="text-slate-700"
                    style={{ fontSize: '13px', fontWeight: 500, lineHeight: 1.5 }}
                  >
                    {render.description}
                  </p>
                </div>
              )}

              {/* Photos card — seeker's own uploaded media. Only rendered
                  when the request actually carries media (the gallery
                  itself returns null otherwise). Survives hard refresh:
                  sourced from the persisted mediaUrls on the wire, not a
                  cache patch. */}
              {render.media.length > 0 && (
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
                    {langKey === 'ar' ? 'الصور' : 'Photos'}
                  </p>
                  <RequestMediaGallery urls={render.media} testId="job-detail-photos" />
                </div>
              )}

              {/* Price Breakdown — booking-side only (priceAmount comes from
                  the snapshotted bid amount). */}
              {showHourlyRate && render.priceAmount !== null && (
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
                    {langKey === 'ar' ? 'تفاصيل السعر' : 'Price Breakdown'}
                  </p>
                  {[
                    {
                      label: langKey === 'ar' ? 'السعر' : 'Rate',
                      val:
                        render.pricingType === 'HOURLY'
                          ? `$${render.priceAmount}/hr`
                          : `$${render.priceAmount}`,
                    },
                    {
                      label: langKey === 'ar' ? 'العملة' : 'Currency',
                      val: 'USD',
                    },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                    >
                      <span className="text-slate-500" style={{ fontSize: '12px' }}>
                        {row.label}
                      </span>
                      <span
                        className="text-slate-700"
                        style={{ fontSize: '12px', fontWeight: 600 }}
                      >
                        {row.val}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Rate & Review (for completed jobs). Slice 2.4 keeps the
                  visual but the submit is still UI-only — reviews ship in a
                  later slice. */}
              {status === 'completed' && !ratingSubmitted && (
                <button
                  onClick={() => setShowRateModal(true)}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-3xl p-4 flex items-center gap-3 active:scale-95 transition-all"
                >
                  <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
                    <ThumbsUp size={18} className="text-white" />
                  </div>
                  <div className="flex-1 text-start">
                    <p className="text-white" style={{ fontSize: '14px', fontWeight: 800 }}>
                      {langKey === 'ar' ? 'كيف كانت تجربتك؟' : 'How was your experience?'}
                    </p>
                    <p className="text-white/70" style={{ fontSize: '12px' }}>
                      {langKey === 'ar'
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
                    {langKey === 'ar' ? 'شكراً على تقييمك! 🌟' : 'Thanks for your review! 🌟'}
                  </p>
                </div>
              )}

              {/* Cancel option — request branch shows it for OPEN_FOR_BIDS,
                  booking branch shows it for SCHEDULED. Both wired to real
                  backend mutations. The visual is the same red-border copy
                  used in slice 2. */}
              {source.kind === 'request' && status === 'pending' && (
                <button
                  type="button"
                  disabled={cancelRequestMut.isPending}
                  onClick={handleCancelRequest}
                  className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-200 text-red-500 active:bg-red-50 transition-all disabled:opacity-50"
                >
                  <XCircle size={15} />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    {cancelRequestMut.isPending
                      ? langKey === 'ar'
                        ? 'جاري الإلغاء…'
                        : 'Cancelling…'
                      : langKey === 'ar'
                        ? 'إلغاء الطلب'
                        : 'Cancel Request'}
                  </span>
                </button>
              )}

              {source.kind === 'booking' && status === 'active' && (
                <button
                  type="button"
                  disabled={cancelBookingMut.isPending}
                  onClick={handleCancelBooking}
                  className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-200 text-red-500 active:bg-red-50 transition-all disabled:opacity-50"
                >
                  <XCircle size={15} />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    {cancelBookingMut.isPending
                      ? langKey === 'ar'
                        ? 'جاري الإلغاء…'
                        : 'Cancelling…'
                      : langKey === 'ar'
                        ? 'إلغاء الحجز'
                        : 'Cancel Booking'}
                  </span>
                </button>
              )}

              <div className="h-2" />
            </>
          )}
        </div>
      </div>

      {/* ── Rate Modal ── */}
      {showRateModal && render && (
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
                  {render.provider?.initials ?? '—'}
                </span>
              </div>
              <p className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
                {langKey === 'ar'
                  ? `كيف كانت تجربتك مع ${providerNamePrivacy}؟`
                  : `Rate your experience with ${providerNamePrivacy}`}
              </p>
              <p className="text-slate-400" style={{ fontSize: '13px' }}>
                {langKey === 'ar' ? 'اضغط على النجوم للتقييم' : 'Tap to rate'}
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
                    langKey === 'ar' ? 'أضف تعليقاً (اختياري)…' : 'Add a comment (optional)…'
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
              {langKey === 'ar' ? 'إرسال التقييم' : 'Submit Review'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Maps an axios-shaped error to a safe, localized friendly copy. The raw
// backend payload (status / code / message) is intentionally NEVER rendered
// — only the canonical translated strings.
function safeErrorCopy(err: unknown, lang: 'en' | 'ar'): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status ?? null;
  if (status === 409) {
    return lang === 'ar'
      ? 'لم يعد بالإمكان إلغاء هذا الطلب. حدّث الصفحة وحاول مرة أخرى.'
      : 'This action can no longer be performed. Refresh and try again.';
  }
  if (status === 404) {
    return lang === 'ar' ? 'لم يتم العثور على هذا العنصر.' : 'This item was not found.';
  }
  return lang === 'ar'
    ? 'تعذر تنفيذ العملية. حاول مرة أخرى.'
    : "We couldn't complete the action. Please try again.";
}
