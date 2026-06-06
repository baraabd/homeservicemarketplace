import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  WifiOff,
  Sparkles,
  Mic,
  ChevronRight,
  Home,
  Briefcase,
  MessageCircle,
  User,
  Plus,
  Wrench,
  Zap,
  Wind,
  Hammer,
  Search,
  PaintBucket,
} from 'lucide-react';
import type {
  BookingListItem,
  BookingStatus,
  NotificationSummary as ContractNotificationSummary,
  NotificationType as ContractNotificationType,
} from '@homeservicemarketplace/contracts';
import { ServiceCategoryCard } from '../ds/ServiceCategoryCard';
import { LeadCard, LeadCardProps } from './LeadCard';
import { BidsScreen } from './BidsScreen';
import { JobDetailView, type JobDetailSource } from './JobDetailView';
import { AllLeadsView } from './AllLeadsView';
import { NotificationDrawer, AppNotification } from '../notifications/NotificationDrawer';
import { ChatScreen } from '../chat/ChatScreen';
import { Snackbar } from '../ds/Snackbar';
import { ProfileTab } from '../profile/ProfileTab';
import { TabSkeleton } from '../ui/SkeletonLoader';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { formatServiceAddressForDisplay } from '../../../lib/address-display';
import { formatPrivacyDisplayName } from '../../../lib/privacy-name';
import { useEcosystem } from '../../context/EcosystemContext';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { useServiceCategories } from '../../../lib/use-service-categories';
import { useRequests } from '../../hooks/seeker/useRequests';
import { useBookings } from '../../hooks/seeker/useBookings';
import { useConversations } from '../../hooks/seeker/useChat';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationsCount,
} from '../../hooks/seeker/useNotifications';
import {
  formatRelativeTime,
  mapServiceCategorySlug,
  mapLeadStatus,
} from '../../../lib/seeker/request-status-map';
import { resolveNotificationTarget } from '../../../lib/realtime/notification-target';

// ─── Tab routing ──────────────────────────────────────────────────────────────
const TAB_PATHS: Record<string, string> = {
  home: '/home',
  bookings: '/home/bookings',
  messages: '/home/messages',
  profile: '/home/profile',
};

function tabFromPath(pathname: string): string {
  if (pathname === '/home/bookings') return 'bookings';
  if (pathname === '/home/messages') return 'messages';
  if (pathname === '/home/profile') return 'profile';
  return 'home';
}

// ─── Booking render shape ─────────────────────────────────────────────────────
// The Bookings tab renders against this local shape. Slice 2.3 wires the
// production source to GET /v1/me/bookings; the previous BOOKING_DATA
// constant was the slice-2-era placeholder and has been removed. The
// local shape is preserved 1:1 so every existing visual (badge colour,
// avatar pill, pro line, price suffix) renders unchanged — only the
// data source moves.
interface BookingItem {
  id: string;
  // The "primary" service label and an Arabic mirror; both are sourced
  // from the API row's service.categoryLabel* / customServiceText
  // (Arabic fallback to the English label when the category doesn't
  // ship a localised one).
  serviceEn: string;
  serviceAr: string;
  // Pre-formatted human dates in the active language. ASAP bookings
  // (no scheduledAt on the request) render the localised "ASAP" label.
  dateEn: string;
  dateAr: string;
  // Maps the API BookingStatus onto the existing 3-state UI badge:
  //   SCHEDULED   → 'pending'   (amber "awaiting" pill)
  //   IN_PROGRESS → 'active'    (blue "in progress" pill)
  //   COMPLETED   → 'completed' (green "done" pill)
  //   CANCELLED   → 'completed' (green pill — slice 2.3 reuses it
  //                              rather than introducing a new design
  //                              token; a future slice can add a
  //                              dedicated cancelled-state visual)
  statusKey: 'active' | 'pending' | 'completed';
  // Provider display name. The API does not yet ship a localised
  // Arabic name, so both languages fall back to the API string —
  // future slice can add provider.displayNameAr.
  proEn: string;
  proAr: string;
  proInitials?: string;
  price: number;
  address?: string;
  addressAr?: string;
}

// API status → UI status. Centralised here so a future product change
// (e.g. a dedicated cancelled-state pill) only touches one site.
function statusKeyFor(s: BookingStatus): BookingItem['statusKey'] {
  if (s === 'IN_PROGRESS') return 'active';
  if (s === 'SCHEDULED') return 'pending';
  return 'completed'; // COMPLETED + CANCELLED both render with the closed-state pill in slice 2.3.
}

// Format the scheduledAt timestamp into the human strings the existing
// card renders. ASAP bookings (scheduledAt: null) render the localised
// "ASAP" label so the card never displays an empty date row.
function formatBookingDate(scheduledAt: string | null, lang: 'en' | 'ar'): string {
  if (!scheduledAt) return lang === 'ar' ? 'في أقرب وقت' : 'ASAP';
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return lang === 'ar' ? 'في أقرب وقت' : 'ASAP';
  // Use Intl with the active locale; mirror the slice-2 placeholder
  // shape ("Today, 3:00 PM" / "Mar 8, 2:00 PM") as closely as Intl
  // allows without re-implementing relative-day logic.
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  return `${d.toLocaleDateString(locale, dateOpts)}, ${d.toLocaleTimeString(locale, timeOpts)}`;
}

function apiBookingToItem(row: BookingListItem, lang: 'en' | 'ar'): BookingItem {
  const labelEn =
    row.service.categoryLabelEn ??
    row.service.customServiceText ??
    (lang === 'ar' ? 'خدمة' : 'Service');
  const labelAr = row.service.categoryLabelAr ?? row.service.customServiceText ?? labelEn;
  return {
    id: row.id,
    serviceEn: labelEn,
    serviceAr: labelAr,
    dateEn: formatBookingDate(row.scheduledAt, 'en'),
    dateAr: formatBookingDate(row.scheduledAt, 'ar'),
    statusKey: statusKeyFor(row.status),
    // Sprint 7.13 — privacy-safe provider name (initial + family name).
    proEn: formatPrivacyDisplayName(
      { displayName: row.provider.displayName },
      { roleFallback: 'Provider' },
    ),
    proAr: formatPrivacyDisplayName(
      { displayName: row.provider.displayName },
      { roleFallback: 'مزود الخدمة' },
    ),
    proInitials: row.provider.initials,
    price: row.priceAmount,
    // Sprint 7.13 — compact, display-only address (raw snapshot untouched).
    address: formatServiceAddressForDisplay(row.addressSnapshot) || undefined,
    addressAr: formatServiceAddressForDisplay(row.addressSnapshot) || undefined,
  };
}

// Slice 2.4 removed the local `bookingToJobData(b, lang)` synthesizer. It
// used to ship fake provider rating / review count / job count placeholders
// to the JobDetailView; the detail view now fetches the real BookingDetail
// (incl. provider summary) directly via useBookingDetail and renders only
// the fields the API actually supplies.

// ─── Leads ────────────────────────────────────────────────────────────────────
// The Seeker production source of truth for "my requests" is the live
// /v1/me/requests endpoint, surfaced via useRequests() inside the
// HomeScreen component below. The previous hard-coded INITIAL_LEADS
// array has been removed — it was the slice-2-era placeholder. Tests
// still mock the API to drive the same UI shape.

// Slice 3.1 stabilization removed the local INITIAL_NOTIFS seed. The
// drawer + ProfileTab notifications page now read from
// /v1/me/notifications via useNotifications(); unread state is
// persisted server-side, so refresh / logout / login all preserve the
// read flags. The previous seed produced the user-visible defect where
// the unread count snapped back to 3 on every refresh.

// API NotificationType (Prisma enum on the wire) → existing UI
// NotifType. Centralised here so the icon/colour palette in
// NotificationDrawer stays unchanged regardless of new server-side
// types.
function uiTypeForNotification(type: ContractNotificationType): AppNotification['type'] {
  switch (type) {
    case 'BID_RECEIVED':
      return 'bid';
    case 'BID_ACCEPTED':
    case 'BOOKING_CREATED':
    case 'BOOKING_COMPLETED':
      return 'confirmed';
    case 'BOOKING_CANCELLED':
      return 'tracking';
    case 'MESSAGE_RECEIVED':
    case 'REVIEW_REQUESTED':
      return 'message';
    case 'SYSTEM':
    default:
      return 'promo';
  }
}

// "2m ago" / "1h ago" — derived from createdAt so the drawer can show
// human-readable freshness without the server shipping a pre-formatted
// string.
function formatRelativeNotificationTime(iso: string, lang: 'en' | 'ar'): string {
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

// API row → existing AppNotification render shape. `jobId` (legacy
// alias) and the explicit `resourceType` / `metadata` are both carried
// so `handleNotifTap` can dispatch on backend truth rather than
// reverse-engineering from the icon palette.
function apiNotifToRender(row: ContractNotificationSummary, lang: 'en' | 'ar'): AppNotification {
  return {
    id: row.id,
    type: uiTypeForNotification(row.type),
    title: row.title,
    body: row.body,
    time: formatRelativeNotificationTime(row.createdAt, lang),
    read: row.readAt !== null,
    jobId: row.resourceId ?? undefined,
    resourceType: row.resourceType ?? null,
    metadata: row.metadata ?? null,
    // Sprint 7.12 — surface the backend type + deepLink so the
    // shared `resolveNotificationTarget` (used by both the drawer
    // tap and the toast View action) has the disambiguating fields
    // it needs. Without backendType, BID_RECEIVED vs. BID_ACCEPTED
    // collapse into one BID branch and route incorrectly.
    backendType: row.type as unknown as string,
    deepLink: row.deepLink ?? null,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface HomeScreenProps {
  isOffline: boolean;
  // categoryId is forwarded from a real catalog tile so the wizard can
  // post a curated-category request; null when triggered from the
  // free-form CTAs.
  onServiceSelect: (service: string, categoryId?: string | null) => void;
  onToggleOffline: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
export function HomeScreen({ isOffline, onServiceSelect, onToggleOffline }: HomeScreenProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const { showHourlyRate } = useEcosystem();

  // Sprint 7.13 — privacy-safe name for the seeker's chat counterpart
  // (the provider): given-name initial + full family name.
  const formatChatName = (displayName: string): string =>
    formatPrivacyDisplayName(
      { displayName },
      { roleFallback: lang === 'ar' ? 'مزود الخدمة' : 'Provider' },
    );
  // Read the authenticated identity from the existing auth source of truth.
  // Do not duplicate auth state here and do not fall back to hardcoded
  // placeholder copy — we'd rather render nothing than a fake identity.
  const identity = useAuthIdentity();
  const activeTab = tabFromPath(location.pathname);
  const prevTab = useRef(activeTab);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core state ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [micActive, setMicActive] = useState(false);

  // Slice 3.1 stabilization: notifications are loaded from the API
  // and read state is persisted server-side. The drawer receives a
  // mapped AppNotification[] derived from NotificationSummary so the
  // existing render shape (icon palette, badge, sections) stays
  // unchanged.
  const notificationsQuery = useNotifications();
  const unreadCountQuery = useUnreadNotificationsCount();
  const markReadMut = useMarkNotificationRead();
  const markAllReadMut = useMarkAllNotificationsRead();
  const notifications: AppNotification[] = useMemo(() => {
    const items = notificationsQuery.data?.items ?? [];
    return items.map((n) => apiNotifToRender(n, lang === 'ar' ? 'ar' : 'en'));
  }, [notificationsQuery.data, lang]);

  // Live "my requests" feed. Drives the Active Leads carousel on the
  // home tab and the All Requests overlay. Empty array on first load
  // / 401 / network error so the existing empty + error rendering
  // paths stay safe — we never throw raw errors at LeadCard.
  const requestsQuery = useRequests();
  const leads: LeadCardProps[] = useMemo(() => {
    const items = requestsQuery.data?.items ?? [];
    return items.map((r) => ({
      id: r.id,
      service: mapServiceCategorySlug(r.category?.slug ?? null),
      // Sprint 7.x — booking-aware status. activeBookingStatus is
      // null until the seeker accepts a bid; once a booking exists it
      // overrides the parent request status for "completed" /
      // "cancelled" so the card visibly converges with the booking
      // lifecycle (the request itself stays at BID_ACCEPTED).
      status: mapLeadStatus(r.status, r.activeBookingStatus),
      postedAt: formatRelativeTime(r.createdAt, lang === 'ar' ? 'ar' : 'en'),
      // Sprint 7.12 — bidsCount now populated by the API (Prisma
      // _count on the seeker request finders). Drives the dynamic
      // "Pending Bids" → "N Bids received" label in LeadCard and
      // survives a hard refresh.
      bids: r.bidsCount,
      price: undefined,
    }));
  }, [requestsQuery.data, lang]);

  // Live "my bookings" feed (slice 2.3). Drives the Bookings tab list
  // and the notification-tap fallback for tracking / confirmed / message
  // notifications. Empty array on first load / 401 / network error so
  // every render path below treats `bookings` as possibly empty — the
  // existing empty / loading / error UI is safe by construction.
  const bookingsQuery = useBookings();
  const bookings: BookingItem[] = useMemo(() => {
    const items = bookingsQuery.data?.items ?? [];
    return items.map((row) => apiBookingToItem(row, lang === 'ar' ? 'ar' : 'en'));
  }, [bookingsQuery.data, lang]);
  const [bookSnack, setBookSnack] = useState(false);
  const [bookSnackMsg, setBookSnackMsg] = useState('');
  // Sprint 7.5 — bookingId returned by the just-completed accept-bid
  // flow. Drives the snackbar's "View booking" action; null when no
  // accept-bid has fired in this session so the snackbar shows
  // without an action button.
  const [bookedBookingId, setBookedBookingId] = useState<string | null>(null);
  const [tabLoading, setTabLoading] = useState(false);

  // ── Overlay state ──────────────────────────────────────────────────────────
  const [notifOpen, setNotifOpen] = useState(false);
  const [bidsLead, setBidsLead] = useState<LeadCardProps | null>(null);
  // Slice 2.4: jobDetail now carries a discriminator (request vs booking)
  // + the corresponding id. The JobDetailView fetches detail + timeline via
  // React Query against the matching API surface, so we no longer pre-bake
  // a synthesized JobData blob here.
  const [jobDetail, setJobDetail] = useState<JobDetailSource | null>(null);
  const [showAllLeads, setShowAllLeads] = useState(false);
  // Slice 3.3: chatContact carries a conversationId so ChatScreen can
  // load the persisted message stream via React Query. The visual
  // contact fields (name / initials / colours) drive the existing
  // header render and are derived from the conversation's
  // otherParticipant or — when entering chat from a booking — from
  // the booking's provider summary.
  const [chatContact, setChatContact] = useState<null | {
    conversationId: string;
    name: string;
    initials: string;
    bg: string;
    textColor: string;
    status: string;
  }>(null);

  // Slice 3.3: live conversations feed. Drives the messages tab list
  // and the notification-tap fallback when a 'message' notification
  // is opened. Empty array on first load / 401 / network error so
  // every render path treats `conversations` as possibly empty.
  const conversationsQuery = useConversations();
  const conversations = useMemo(
    () => conversationsQuery.data?.items ?? [],
    [conversationsQuery.data],
  );

  // Unread count: prefer the API-served count (one query, faster
  // refresh path) but fall back to deriving from the loaded list when
  // the count query is still in flight or errored — never leaves the
  // bell badge stuck on a stale local value.
  const unreadCount = unreadCountQuery.data?.count ?? notifications.filter((n) => !n.read).length;

  // markAllRead / markRead now hit the backend. The mutations
  // invalidate the notifications root, which triggers list +
  // unread-count refetch. We do NOT optimistic-update local state
  // here because the previous local-only behaviour is exactly the
  // bug we're fixing — the unread count would snap back on refresh
  // because the server didn't know the user had marked anything
  // read.
  const markAllRead = () => {
    if (markAllReadMut.isPending) return;
    markAllReadMut.mutate();
  };
  const markRead = (id: string) => {
    if (markReadMut.isPending) return;
    markReadMut.mutate(id);
  };

  // ── Tab skeleton loader ────────────────────────────────────────────────────
  // تم تصحيح الخطأ هنا بإزالة التعبير غير المستخدم وتنظيم الـ effect
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      setTabLoading(true);
      const timer = setTimeout(() => setTabLoading(false), 380);
      prevTab.current = activeTab;
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // ── Mic auto-off ────────────────────────────────────────────────────────────
  const toggleMic = () => {
    if (micActive) {
      setMicActive(false);
      if (micTimerRef.current) clearTimeout(micTimerRef.current);
    } else {
      setMicActive(true);
      micTimerRef.current = setTimeout(() => setMicActive(false), 5000);
    }
  };

  // ── Notification tap ────────────────────────────────────────────────────────
  // Sprint 7.12 — delegates to the shared `resolveNotificationTarget`
  // so the seeker notification drawer tap, the toast "View" action,
  // the Profile notifications tap, and the Completed Posts item tap
  // all converge on the SAME routing logic. The shared resolver
  // honours metadata.requestId for BID notifications (the
  // resourceId is the bidId, never the requestId), prefers
  // backend-supplied deepLinks, and falls back to derived routes
  // for REQUEST / BOOKING / CONVERSATION.
  //
  // The resolver returns a typed `kind`; we map each kind onto the
  // in-app overlay state setter so we never have to parse the
  // deepLink string here. Unresolvable notifications (SYSTEM / null /
  // unknown) deliberately do NOTHING — no fallback to home or All
  // Leads (the original bug surfaced when the tap silently landed on
  // a wrong page; now we prefer "nothing happened" over "wrong page
  // opened").
  //
  // Mark-as-read is fired by NotificationDrawer's row click via
  // `onMarkRead` — we don't re-mark here.
  const handleNotifTap = (n: AppNotification) => {
    setNotifOpen(false);
    setTimeout(() => {
      const target = resolveNotificationTarget(
        {
          type: (n as { backendType?: string }).backendType ?? null,
          resourceType: n.resourceType ?? null,
          resourceId: n.jobId ?? null,
          deepLink: (n as { deepLink?: string | null }).deepLink ?? null,
          metadata: n.metadata ?? null,
        },
        'seeker',
      );
      if (!target) return;
      switch (target.kind) {
        case 'seeker-request-bids': {
          // Open the BidsScreen overlay against the matching lead when
          // we have it in cache — otherwise fall through to the
          // request detail surface so the tap is never a no-op.
          const lead = leads.find((l) => l.id === target.requestId);
          if (lead) {
            setBidsLead(lead);
          } else {
            setJobDetail({ kind: 'request', id: target.requestId });
          }
          return;
        }
        case 'seeker-request-detail':
          setJobDetail({ kind: 'request', id: target.requestId });
          return;
        case 'seeker-booking-detail':
          setJobDetail({ kind: 'booking', id: target.bookingId });
          return;
        case 'seeker-conversation': {
          const conv = conversations.find((c) => c.id === target.conversationId);
          if (conv) {
            setChatContact({
              conversationId: conv.id,
              name: formatChatName(conv.otherParticipant.displayName),
              initials: conv.otherParticipant.initials,
              bg: 'bg-amber-100',
              textColor: 'text-amber-700',
              status: 'Online',
            });
          }
          return;
        }
        // Provider-kind targets cannot fire here (we always ask the
        // resolver for the 'seeker' experience). Listed exhaustively
        // so a future kind addition becomes a TS error rather than a
        // silent no-op.
        case 'provider-bid-detail':
        case 'provider-booking-detail':
        case 'provider-request-detail':
        case 'provider-conversation':
          return;
      }
    }, 200);
  };

  // ── Lead tap ────────────────────────────────────────────────────────────────
  const handleLeadTap = (lead: LeadCardProps) => {
    if (lead.status === 'pending') {
      setBidsLead(lead);
    } else {
      setJobDetail({ kind: 'request', id: lead.id });
    }
  };

  // ── Booking tap ─────────────────────────────────────────────────────────────
  // Slice 2.4: hands the booking id to JobDetailView so it can fetch the
  // real BookingDetail (provider summary + price snapshot + timeline).
  const handleBookingTap = (b: BookingItem) => setJobDetail({ kind: 'booking', id: b.id });

  // ── Book bid ────────────────────────────────────────────────────────────────
  // Fires after BidsScreen successfully accepts a bid through the real
  // /v1/me/requests/:id/bids/:bidId/accept endpoint (Sprint 7.5
  // finished the integration). The snackbar's "View booking" action
  // navigates the seeker to the freshly created booking detail so the
  // post-acceptance flow lands them somewhere actionable instead of
  // just acknowledging the event. The BidsScreen overlay closes
  // immediately; React Query cache invalidation has already fired
  // inside useAcceptBid so the Bookings tab is fresh by the time the
  // user taps through.
  const handleBookBid = (bidderName: string, bookingId: string) => {
    const fn = bidderName.split(' ')[0];
    setBookSnackMsg(
      lang === 'ar' ? `تم الحجز مع ${fn}! 🎉` : `Booked ${fn}! 🎉 Job is now active.`,
    );
    setBookedBookingId(bookingId);
    setBookSnack(true);
    setBidsLead(null);
  };

  // ── Services ────────────────────────────────────────────────────────────────
  // Visual identity (icon + colour pair) for each known service slug.
  // The catalog itself comes from /v1/services (real backend, Sprint 1
  // slice 1) — see useServiceCategories below — but the icon mapping is
  // intentionally local because lucide icons aren't serializable as DB
  // rows and changing the visual mapping would otherwise require a
  // backend migration. Unknown slugs (e.g. an admin-added category that
  // ships before the FE icon map is updated) fall back to the slate
  // generic icon so the UI never breaks.
  const SERVICE_ICON_MAP: Record<
    string,
    { icon: React.ReactNode; iconBg: string; iconColor: string }
  > = {
    plumbing: { icon: <Wrench size={22} />, iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
    'ac-repair': { icon: <Wind size={22} />, iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600' },
    carpentry: {
      icon: <Hammer size={22} />,
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-700',
    },
    cleaning: {
      icon: <Sparkles size={22} />,
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
    },
    electrical: { icon: <Zap size={22} />, iconBg: 'bg-amber-100', iconColor: 'text-amber-600' },
    painting: {
      icon: <PaintBucket size={22} />,
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
  };
  const SERVICE_ICON_FALLBACK = {
    icon: <Wrench size={22} />,
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
  };
  const { data: serviceCategories } = useServiceCategories();

  // ── Nav tabs ────────────────────────────────────────────────────────────────
  const NAV_TABS = [
    { id: 'home', labelKey: 'home', Icon: Home, badge: 0 },
    { id: 'bookings', labelKey: 'bookings', Icon: Briefcase, badge: 0 },
    { id: 'messages', labelKey: 'chat', Icon: MessageCircle, badge: 3 },
    { id: 'profile', labelKey: 'profile', Icon: User, badge: 0 },
  ];

  // Slice 3.3 removed the local MESSAGES_LIST seed (Omar K. / Sara M.
  // / FixNow Support). The messages tab now reads from
  // /v1/me/conversations via useConversations(); see the rendering
  // below in the 'messages' tab branch.

  // ─── Tab content renderer ───────────────────────────────────────────────────
  const renderTab = () => {
    if (tabLoading) {
      return (
        <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <TabSkeleton tab={activeTab} />
        </div>
      );
    }

    switch (activeTab) {
      // ── HOME ──────────────────────────────────────────────────────────────
      case 'home':
        return (
          <motion.div
            key="home"
            className="absolute inset-0 overflow-y-auto"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            style={{ scrollbarWidth: 'none' }}
          >
            {/* AI Hero + Search */}
            <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-500 to-orange-600 mx-4 mt-4 rounded-3xl p-5">
              <div className="absolute -top-8 -end-8 w-36 h-36 rounded-full bg-white/10" />
              <div className="absolute -bottom-6 start-4 w-28 h-28 rounded-full bg-orange-600/30" />
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 border border-white/30 mb-3">
                  <Sparkles size={11} className="text-white" />
                  <span className="text-white" style={{ fontSize: '11px', fontWeight: 600 }}>
                    {t('aiPowered')}
                  </span>
                </div>
                <h2
                  className="text-white mb-1"
                  style={{ fontSize: '20px', fontWeight: 800, lineHeight: 1.25 }}
                >
                  {t('whatDoYouNeed')}
                </h2>
                <p className="text-white/70 mb-4" style={{ fontSize: '12px' }}>
                  {t('searchDesc')}
                </p>
                <div
                  className={`bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg transition-all ${micActive ? 'ring-2 ring-red-400' : ''}`}
                >
                  <Sparkles size={16} className="text-amber-500 flex-shrink-0" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="flex-1 bg-transparent text-slate-700 placeholder-slate-400 outline-none"
                    style={{ fontSize: '13px' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && search.trim()) onServiceSelect(search.trim());
                    }}
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center"
                    >
                      <span className="text-slate-400" style={{ fontSize: '10px' }}>
                        ✕
                      </span>
                    </button>
                  )}
                  <button
                    onClick={toggleMic}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 ${micActive ? 'bg-red-500 shadow-md shadow-red-300' : 'bg-amber-50'}`}
                  >
                    <Mic size={15} className={micActive ? 'text-white' : 'text-amber-600'} />
                  </button>
                </div>
                {micActive && (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-1 bg-white/80 rounded-full animate-bounce"
                        style={{
                          height: `${10 + Math.abs(Math.sin(i * 1.2)) * 12}px`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                    <span className="text-white/80 ms-2" style={{ fontSize: '12px' }}>
                      {lang === 'ar' ? 'جارٍ الاستماع…' : 'Listening…'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mx-4 mt-3">
              {[
                {
                  val: '4.9★',
                  labelKey: 'avgRating',
                  color: 'text-amber-600',
                  bg: 'bg-amber-50',
                  border: 'border-amber-100',
                },
                {
                  val: '500+',
                  labelKey: 'prosOnline',
                  color: 'text-blue-600',
                  bg: 'bg-blue-50',
                  border: 'border-blue-100',
                },
                {
                  val: '~1h',
                  labelKey: 'response',
                  color: 'text-green-600',
                  bg: 'bg-green-50',
                  border: 'border-green-100',
                },
              ].map((s) => (
                <div
                  key={s.labelKey}
                  className={`flex flex-col items-center py-3 rounded-2xl border ${s.bg} ${s.border}`}
                >
                  <span className={s.color} style={{ fontSize: '14px', fontWeight: 800 }}>
                    {s.val}
                  </span>
                  <span className="text-slate-400 mt-0.5" style={{ fontSize: '10px' }}>
                    {t(s.labelKey)}
                  </span>
                </div>
              ))}
            </div>

            {/* Services */}
            <div className="px-4 mt-5">
              <div className="flex items-center justify-between mb-3.5">
                <h3
                  className="text-slate-900 dark:text-white"
                  style={{ fontSize: '16px', fontWeight: 700 }}
                >
                  {t('services')}
                </h3>
                <button
                  className="flex items-center gap-1 text-amber-600 active:opacity-70"
                  style={{ fontSize: '13px', fontWeight: 600 }}
                >
                  {t('viewAll')} <ChevronRight size={14} className="rtl:rotate-180" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3" data-testid="service-categories-grid">
                {(serviceCategories ?? []).map((c) => {
                  const visual = SERVICE_ICON_MAP[c.slug] ?? SERVICE_ICON_FALLBACK;
                  const label = lang === 'ar' ? c.labelAr : c.labelEn;
                  return (
                    <ServiceCategoryCard
                      key={c.id}
                      icon={visual.icon}
                      label={label}
                      iconBg={visual.iconBg}
                      iconColor={visual.iconColor}
                      onClick={() => onServiceSelect(label, c.id)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Active Leads */}
            <div className="mt-5">
              <div className="flex items-center justify-between px-4 mb-3.5">
                <div className="flex items-center gap-2">
                  <h3
                    className="text-slate-900 dark:text-white"
                    style={{ fontSize: '16px', fontWeight: 700 }}
                  >
                    {t('activeLeads')}
                  </h3>
                  <span
                    className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center"
                    style={{ fontSize: '10px', fontWeight: 800 }}
                  >
                    {leads.filter((l) => l.status !== 'completed').length}
                  </span>
                </div>
                <button
                  onClick={() => setShowAllLeads(true)}
                  className="flex items-center gap-1 text-amber-600 active:opacity-70"
                  style={{ fontSize: '13px', fontWeight: 600 }}
                >
                  {t('viewAll')} <ChevronRight size={14} className="rtl:rotate-180" />
                </button>
              </div>
              <div className="mx-4 mb-3 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                <p className="text-blue-600" style={{ fontSize: '11px', fontWeight: 500 }}>
                  {t('pendingTip')}
                </p>
              </div>
              {/* Sprint 7.12 — `touch-action: pan-x` overrides the
                  parent's `overflow-y-auto` default of pan-y so a
                  horizontal swipe on mobile actually scrolls the
                  carousel (Bug #3: carousel was effectively locked
                  on touch devices because the parent intercepted the
                  gesture). `-webkit-overflow-scrolling: touch` keeps
                  iOS momentum scrolling intact. RTL is handled by
                  Tailwind's logical-property aware `px-4`. */}
              <div
                className="flex gap-3 overflow-x-auto px-4 pb-2"
                style={{
                  scrollbarWidth: 'none',
                  touchAction: 'pan-x',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehaviorX: 'contain',
                }}
                data-testid="active-leads-carousel"
              >
                {leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    {...lead}
                    showPrice={showHourlyRate}
                    onClick={() => handleLeadTap(lead)}
                  />
                ))}
                <button
                  onClick={() => onServiceSelect('General')}
                  className="flex-shrink-0 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/50 active:bg-amber-50 transition-all active:scale-95"
                  style={{ width: '120px', minHeight: '180px' }}
                >
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center">
                    <Plus size={20} className="text-amber-600" />
                  </div>
                  <span
                    className="text-amber-700 text-center"
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      lineHeight: 1.3,
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {t('postNewJob')}
                  </span>
                </button>
              </div>
            </div>

            {/* How it works */}
            <div className="mx-4 mt-5 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4">
              <p
                className="text-slate-900 dark:text-white mb-4"
                style={{ fontSize: '15px', fontWeight: 700 }}
              >
                {t('howItWorks')}
              </p>
              <div className="flex items-start gap-3">
                {[
                  { num: '1', titleKey: 'step1Title', subKey: 'step1Sub', color: 'bg-amber-500' },
                  { num: '2', titleKey: 'step2Title', subKey: 'step2Sub', color: 'bg-blue-500' },
                  { num: '3', titleKey: 'step3Title', subKey: 'step3Sub', color: 'bg-green-500' },
                ].map((s) => (
                  <div key={s.num} className="flex flex-col items-center flex-1 text-center gap-2">
                    <div
                      className={`w-9 h-9 rounded-2xl ${s.color} flex items-center justify-center shadow-sm`}
                    >
                      <span className="text-white" style={{ fontSize: '14px', fontWeight: 800 }}>
                        {s.num}
                      </span>
                    </div>
                    <div>
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '12px', fontWeight: 700 }}
                      >
                        {t(s.titleKey)}
                      </p>
                      <p className="text-slate-400" style={{ fontSize: '10px' }}>
                        {t(s.subKey)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-6" />
          </motion.div>
        );

      // ── BOOKINGS ──────────────────────────────────────────────────────────
      case 'bookings':
        return (
          <motion.div
            key="bookings"
            className="absolute inset-0 overflow-y-auto px-4 pt-4"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            style={{ scrollbarWidth: 'none' }}
          >
            <h2
              className="text-slate-900 dark:text-white mb-4"
              style={{ fontSize: '18px', fontWeight: 800 }}
            >
              {t('myBookings')}
            </h2>

            {/* Loading / error / empty / list — preserved visual idioms.
                Loading uses the same 20-pad icon block as the empty
                state with a neutral spinner inside; error keeps the
                slate copy block (no raw backend error). */}
            {bookingsQuery.isLoading && !bookingsQuery.data ? (
              <div
                className="flex flex-col items-center justify-center py-20 gap-4"
                role="status"
                aria-live="polite"
              >
                <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center animate-pulse">
                  <Briefcase size={32} className="text-slate-300" />
                </div>
                <p className="text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
                  {lang === 'ar' ? 'جاري تحميل الحجوزات...' : 'Loading bookings...'}
                </p>
              </div>
            ) : bookingsQuery.isError && !bookingsQuery.data ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3" role="alert">
                <p
                  className="text-slate-700 dark:text-slate-200 text-center"
                  style={{ fontSize: '14px', fontWeight: 600 }}
                >
                  {lang === 'ar'
                    ? 'تعذر تحميل الحجوزات. حاول مرة أخرى.'
                    : "We couldn't load bookings. Please try again."}
                </p>
                <button
                  onClick={() => bookingsQuery.refetch()}
                  className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              </div>
            ) : bookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Briefcase size={32} className="text-slate-300" />
                </div>
                <p
                  className="text-slate-700 dark:text-slate-200"
                  style={{ fontSize: '16px', fontWeight: 700 }}
                >
                  {lang === 'ar' ? 'لا توجد حجوزات بعد' : 'No bookings yet'}
                </p>
                <p className="text-slate-400 text-center" style={{ fontSize: '13px' }}>
                  {lang === 'ar' ? 'ابدأ بنشر طلبك الأول' : 'Post your first job to get started'}
                </p>
              </div>
            ) : (
              bookings.map((b) => (
                <motion.button
                  key={b.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleBookingTap(b)}
                  className="w-full bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-3 text-start cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '14px', fontWeight: 700 }}
                      >
                        {lang === 'ar' ? b.serviceAr : b.serviceEn}
                      </p>
                      <p className="text-slate-400 mt-0.5" style={{ fontSize: '12px' }}>
                        {lang === 'ar' ? b.dateAr : b.dateEn}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full border flex-shrink-0 ${
                        b.statusKey === 'active'
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : b.statusKey === 'pending'
                            ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : 'bg-green-50 border-green-200 text-green-700'
                      }`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {t(
                        b.statusKey === 'active'
                          ? 'inProgress'
                          : b.statusKey === 'pending'
                            ? 'awaiting'
                            : 'done',
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {b.proInitials && b.proEn !== '—' && (
                        <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                          <span
                            className="text-amber-700"
                            style={{ fontSize: '8px', fontWeight: 800 }}
                          >
                            {b.proInitials}
                          </span>
                        </div>
                      )}
                      <span
                        className="text-slate-500 dark:text-slate-400"
                        style={{ fontSize: '12px' }}
                      >
                        {t('pro')}: {lang === 'ar' ? b.proAr : b.proEn}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {showHourlyRate && b.price > 0 && (
                        <span
                          className="text-slate-900 dark:text-white"
                          style={{ fontSize: '15px', fontWeight: 800 }}
                        >
                          ${b.price}/hr
                        </span>
                      )}
                      <ChevronRight size={14} className="text-slate-300 rtl:rotate-180" />
                    </div>
                  </div>
                </motion.button>
              ))
            )}
          </motion.div>
        );

      // ── MESSAGES ─────────────────────────────────────────────────────────
      case 'messages':
        return (
          <motion.div
            key="messages"
            className="absolute inset-0 overflow-y-auto px-4 pt-4"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            style={{ scrollbarWidth: 'none' }}
          >
            <h2
              className="text-slate-900 dark:text-white mb-4"
              style={{ fontSize: '18px', fontWeight: 800 }}
            >
              {t('chat')}
            </h2>
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-200 dark:border-slate-700 mb-4">
              <Search size={15} className="text-slate-400" />
              <input
                placeholder={t('searchConversations')}
                className="flex-1 bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
                style={{ fontSize: '13px' }}
              />
            </div>
            {/* Slice 3.3: Conversations are loaded from /v1/me/conversations.
                The slice-2 MESSAGES_LIST seed (Omar K. / Sara M. / FixNow
                Support) was removed entirely from the production path.
                Loading / empty / error states use the existing slate
                copy idiom. */}
            {conversationsQuery.isLoading && !conversationsQuery.data ? (
              <div
                className="flex flex-col items-center justify-center py-16 gap-3"
                role="status"
                aria-live="polite"
              >
                <p className="text-slate-500" style={{ fontSize: '13px' }}>
                  {lang === 'ar' ? 'جاري تحميل المحادثات...' : 'Loading conversations...'}
                </p>
              </div>
            ) : conversationsQuery.isError && !conversationsQuery.data ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3" role="alert">
                <p
                  className="text-slate-700 dark:text-slate-200 text-center"
                  style={{ fontSize: '14px', fontWeight: 600 }}
                >
                  {lang === 'ar'
                    ? 'تعذر تحميل المحادثات. حاول مرة أخرى.'
                    : "We couldn't load conversations. Please try again."}
                </p>
                <button
                  onClick={() => conversationsQuery.refetch()}
                  className="px-5 py-2.5 rounded-2xl bg-amber-500 text-white active:scale-95 transition-all shadow-sm shadow-amber-200"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p
                  className="text-slate-700 dark:text-slate-200 text-center"
                  style={{ fontSize: '14px', fontWeight: 600 }}
                >
                  {lang === 'ar' ? 'لا توجد محادثات بعد' : 'No conversations yet'}
                </p>
                <p className="text-slate-400 text-center" style={{ fontSize: '12px' }}>
                  {lang === 'ar'
                    ? 'ستظهر محادثاتك هنا فور بدء حجوزات.'
                    : 'Your conversations will appear here once you have bookings.'}
                </p>
              </div>
            ) : (
              conversations.map((c) => {
                const lastAt = c.lastMessageAt ? new Date(c.lastMessageAt) : null;
                const timeStr = lastAt
                  ? lastAt.toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '';
                return (
                  <motion.button
                    key={c.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() =>
                      setChatContact({
                        conversationId: c.id,
                        name: formatChatName(c.otherParticipant.displayName),
                        initials: c.otherParticipant.initials,
                        bg: 'bg-amber-100',
                        textColor: 'text-amber-700',
                        status: 'Online',
                      })
                    }
                    className="w-full flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-2 cursor-pointer transition-all text-start"
                  >
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-amber-100">
                      <span
                        className="text-amber-700"
                        style={{ fontSize: '12px', fontWeight: 800 }}
                      >
                        {c.otherParticipant.initials}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-slate-900 dark:text-white"
                        style={{ fontSize: '14px', fontWeight: 700 }}
                      >
                        {formatChatName(c.otherParticipant.displayName)}
                      </p>
                      <p className="text-slate-400 truncate" style={{ fontSize: '12px' }}>
                        {c.lastMessageBody ??
                          (lang === 'ar' ? 'لا توجد رسائل بعد' : 'No messages yet')}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className="text-slate-400" style={{ fontSize: '10px' }}>
                        {timeStr}
                      </span>
                      {c.unreadCount > 0 && (
                        <span
                          className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center"
                          style={{ fontSize: '10px', fontWeight: 700 }}
                        >
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </motion.button>
                );
              })
            )}
          </motion.div>
        );

      // ── PROFILE ──────────────────────────────────────────────────────────
      case 'profile':
        return (
          <motion.div
            key="profile"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <ProfileTab
              isOffline={isOffline}
              onToggleOffline={onToggleOffline}
              notifications={notifications}
              onMarkAllRead={markAllRead}
              onMarkRead={markRead}
              unreadCount={unreadCount}
              // Sprint 7.12 — Completed Posts → JobDetailView. The
              // ProfileTab closes its CompletedPostsPage first then
              // calls this back so the booking-detail overlay slides
              // in over the Profile list (same flow as Bookings tab).
              onOpenBooking={(bookingId) => setJobDetail({ kind: 'booking', id: bookingId })}
            />
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col bg-slate-50 dark:bg-slate-900" style={{ height: '100svh' }}>
      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div className="flex-shrink-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-700 shadow-sm z-30 relative">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm shadow-amber-200"
                data-testid="home-header-avatar"
              >
                <span className="text-white" style={{ fontSize: '13px', fontWeight: 800 }}>
                  {identity.initials ?? ''}
                </span>
              </div>
              <div className="absolute -bottom-0.5 -end-0.5 w-3.5 h-3.5 rounded-full bg-green-400 border-2 border-white dark:border-slate-800" />
            </div>
            <div>
              <p className="text-slate-400" style={{ fontSize: '11px', fontWeight: 500 }}>
                {t('greeting')}
              </p>
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 700, minWidth: '1ch' }}
                data-testid="home-header-name"
              >
                {identity.displayName ?? ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LangToggle />
            {isOffline && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
                <WifiOff size={10} className="text-amber-600" />
                <span className="text-amber-700" style={{ fontSize: '10px', fontWeight: 700 }}>
                  {t('offline')}
                </span>
              </div>
            )}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 flex items-center justify-center active:scale-90 transition-all"
            >
              <Bell
                size={17}
                className={notifOpen ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300'}
              />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-slate-800"
                  style={{ fontSize: '8px', fontWeight: 800 }}
                >
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ══ CONTENT AREA — overlays live here so BottomNav stays visible ═══ */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {tabLoading ? (
            <motion.div
              key={`skeleton-${activeTab}`}
              className="absolute inset-0 overflow-y-auto bg-slate-50 dark:bg-slate-900"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{ scrollbarWidth: 'none' }}
            >
              <TabSkeleton tab={activeTab} />
            </motion.div>
          ) : (
            renderTab()
          )}
        </AnimatePresence>

        {/* ══ OVERLAYS inside content area — BottomNav stays visible ══════ */}

        {/* All Leads */}
        <AllLeadsView
          leads={leads}
          isVisible={showAllLeads}
          onBack={() => setShowAllLeads(false)}
          onOpenBids={(lead) => {
            setShowAllLeads(false);
            setBidsLead(lead);
          }}
          onOpenDetail={(lead) => {
            setShowAllLeads(false);
            setJobDetail({ kind: 'request', id: lead.id });
          }}
          onPostNew={() => {
            setShowAllLeads(false);
            onServiceSelect('General');
          }}
        />

        {/* Bids Screen */}
        <div
          className="absolute inset-0 z-20 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ transform: bidsLead ? 'translateX(0)' : 'translateX(100%)' }}
        >
          {bidsLead && (
            <BidsScreen
              lead={bidsLead}
              onBack={() => setBidsLead(null)}
              onBookBid={handleBookBid}
            />
          )}
        </div>

        {/* Job Detail */}
        {jobDetail && (
          <JobDetailView
            source={jobDetail}
            isVisible={!!jobDetail}
            onBack={() => setJobDetail(null)}
            onOpenChat={(_contact) => {
              // Slice 2.4 made JobDetailView's Message button a
              // disabled placeholder — onOpenChat is never invoked
              // from there. Slice 3.3 routes chat openings through
              // the messages tab + notification taps, both of which
              // resolve a real conversationId. If a future surface
              // calls this from a booking, it should call
              // useGetOrCreateConversation first and dispatch the
              // resulting conversationId here.
              void _contact;
            }}
          />
        )}

        {/* Chat Screen */}
        {chatContact && (
          <ChatScreen
            conversationId={chatContact.conversationId}
            contact={chatContact}
            onBack={() => setChatContact(null)}
            isVisible={!!chatContact}
          />
        )}

        {/* Notification Drawer */}
        <NotificationDrawer
          isOpen={notifOpen}
          notifications={notifications}
          onClose={() => setNotifOpen(false)}
          onMarkAllRead={markAllRead}
          onMarkRead={markRead}
          onTapNotif={handleNotifTap}
          onOpenSettings={() => navigate('/home/profile')}
        />
      </div>

      {/* ══ BOTTOM NAV (always visible — outside content area) ═════════════ */}
      <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20">
        <div className="flex items-center justify-around px-2 pt-2 pb-3">
          {NAV_TABS.map(({ id, labelKey, Icon, badge }) => {
            const active = activeTab === id;
            return (
              <motion.button
                key={id}
                onClick={() => navigate(TAB_PATHS[id])}
                whileTap={{ scale: 0.88 }}
                className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all duration-150 min-w-[60px]"
              >
                {active && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-amber-50 dark:bg-amber-900/20 rounded-2xl"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                {badge > 0 && !active && (
                  <span
                    className="absolute top-0 end-2 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center z-10"
                    style={{ fontSize: '8px', fontWeight: 700 }}
                  >
                    {badge}
                  </span>
                )}
                <Icon
                  size={22}
                  className={`relative transition-colors z-10 ${active ? 'text-amber-500' : 'text-slate-400'}`}
                />
                <span
                  className="relative z-10 transition-colors"
                  style={{
                    fontSize: '10px',
                    fontWeight: active ? 700 : 500,
                    color: active ? '#F59E0B' : '#94a3b8',
                  }}
                >
                  {t(labelKey)}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Success snackbar — Sprint 7.5 adds the "View booking" action
          when an accept-bid has just landed and surfaced a bookingId.
          Tapping the action opens the JobDetailView for the new
          booking so the seeker isn't left on the snackbar with no
          next step. The action is omitted when no bookingId is
          present (the snackbar is also used for other lifecycle
          notices in future slices). */}
      <Snackbar
        visible={bookSnack}
        variant="success"
        message={bookSnackMsg}
        onDismiss={() => {
          setBookSnack(false);
          setBookedBookingId(null);
        }}
        duration={4000}
        action={
          bookedBookingId
            ? {
                label: lang === 'ar' ? 'عرض الحجز' : 'View booking',
                onClick: () => {
                  const id = bookedBookingId;
                  setBookSnack(false);
                  setBookedBookingId(null);
                  if (id) setJobDetail({ kind: 'booking', id });
                },
              }
            : undefined
        }
      />
    </div>
  );
}
