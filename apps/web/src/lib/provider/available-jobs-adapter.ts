import type {
  AvailableJobSummary,
  ProviderAvailableRequestSummary,
} from '@homeservicemarketplace/contracts';

import type { ServiceRequest } from '../../app/context/EcosystemContext';

// Adapter from the API's narrow available-request shape (Sprint 5.2;
// Sprint 7.4 completed the privacy-safe summary projection) to the
// legacy ServiceRequest the ProviderApp screens render. The mapper:
//
//   - threads `location.lat` / `location.lng` straight through. Either
//     may be null when the seeker's address has no captured coords;
//     the LiveJobsScreen's Leaflet layer skips null-coord pins rather
//     than synthesising fake positions.
//   - threads `distanceKm` straight through. The legacy `distance`
//     primitive is left at 0 — call sites have migrated to gate on
//     `distanceKm !== null` since the field landed in the
//     EcosystemContext type.
//   - threads the privacy-safe seeker preview from the canonical wire:
//     `seekerName` ← `seeker.publicLabel` ("Layla M." or "Customer"),
//     `seekerRating` ← `seeker.rating ?? 0` (zero just means "no
//     reputation data yet" — the JobDetailOverlay already gates
//     visibility on a non-empty name and never on the rating).
//   - threads the budget label from `budget.label`. When the seeker
//     hasn't set a budget (today: always) the label is null and we
//     render an empty string; the JobDetailOverlay then hides the
//     budget tile entirely.
//   - derives `urgency` from `scheduleType === 'ASAP'`.
//   - maps the category slug to a default emoji; `customServiceText`
//     requests fall back to a generic icon.
//   - threads `media` → `mediaUrls` so the JobDetailOverlay can show
//     the seeker's photos before the provider commits to a bid (Sprint
//     7.x). The wire field is named `media` on the contract; the
//     legacy ServiceRequest type uses `mediaUrls`, so we rename here.
//
// Treat the legacy `bids: Bid[]` field as "an array sized to bidsCount
// for length-only UIs"; the screens that call .map over it have
// migrated to the real `useMyBids()` data in Sprint 5.3.
//
// The function accepts EITHER the older `AvailableJobSummary` (legacy
// /me/provider/jobs feed) OR the canonical
// `ProviderAvailableRequestSummary` (Sprint 5.2 `/v1/provider/available-requests`).
// The legacy feed does NOT carry distance / budget / seeker preview;
// when one of those rows comes through, the mapper falls back to the
// pre-7.4 empty-string / null defaults so the screens render but
// never display a fabricated value.
type AdaptableJob = AvailableJobSummary | ProviderAvailableRequestSummary;

export function mapAvailableJobToLegacy(job: AdaptableJob): ServiceRequest {
  const icon = iconForCategorySlug(job.category?.slug ?? null);
  const isUrgent = job.scheduleType === 'ASAP';
  const status = job.bidsCount > 0 ? 'bidding' : 'pending';
  const serviceLabelEn = job.category?.labelEn ?? job.customServiceText ?? 'Service request';
  const serviceLabelAr = job.category?.labelAr ?? job.customServiceText ?? 'طلب خدمة';
  const description = job.description ?? job.customServiceText ?? '';

  // Canonical-only fields: present on ProviderAvailableRequestSummary
  // (Sprint 7.4), absent on the legacy AvailableJobSummary. The `in`
  // narrowing keeps both branches type-safe.
  const isCanonical = 'seeker' in job;
  const seekerName = isCanonical ? job.seeker.publicLabel : '';
  const seekerRating = isCanonical ? (job.seeker.rating ?? 0) : 0;
  const budgetLabel = isCanonical ? (job.budget.label ?? '') : '';
  const distanceKm = isCanonical ? job.distanceKm : null;

  return {
    id: job.id,
    service: serviceLabelEn,
    serviceAr: serviceLabelAr,
    serviceIcon: icon,
    description,
    descriptionAr: description,
    budget: budgetLabel,
    location: job.location.city,
    locationAr: job.location.city,
    seekerName,
    seekerRating,
    distance: 0,
    urgency: isUrgent ? 'urgent' : 'normal',
    postedAt: job.createdAt,
    status,
    bids: Array.from({ length: job.bidsCount }, (_, idx) => ({
      id: `${job.id}-placeholder-${idx}`,
      requestId: job.id,
      providerName: '',
      providerAr: '',
      providerRating: 0,
      providerJobs: 0,
      price: 0,
      executionTime: '',
      note: '',
      status: 'pending' as const,
      submittedAt: '',
    })),
    lat: job.location.lat,
    lng: job.location.lng,
    // The canonical `ProviderAvailableRequestSummary` carries `media`;
    // the legacy `AvailableJobSummary` does not. The runtime `in`
    // narrowing keeps both branches type-safe without a cast — the
    // legacy feed simply renders no thumbnails until it migrates.
    // The trailing `|| []` is defensive: the contract types `media`
    // as `string[]`, but a malformed wire payload (e.g. a stale
    // backend that emitted `null`) would otherwise propagate
    // undefined/null to the UI's `.length` / `.map` call sites.
    mediaUrls: ('media' in job ? job.media : []) || [],
    distanceKm,
  };
}

const ICON_BY_SLUG: Record<string, string> = {
  plumbing: '🔧',
  electrical: '⚡',
  'ac-repair': '❄️',
  'air-conditioning': '❄️',
  cleaning: '✨',
  carpentry: '🔨',
  painting: '🎨',
  gardening: '🌿',
  moving: '📦',
  handyman: '🛠️',
};

// Exported because both LiveJobsScreen (via the legacy ServiceRequest
// adapter) and MyBidsScreen consume it. Keeping a single icon table
// keeps the two surfaces visually consistent.
export function iconForCategorySlug(slug: string | null): string {
  if (!slug) return '🛠️';
  return ICON_BY_SLUG[slug] ?? '🛠️';
}

// Minutes → human-readable label used on the My Bids cards.
// The backend stores responseTimeMinutes as an Int; the bidding form
// only offers six fixed chip values, so we round-trip them faithfully
// (anything outside the chip set falls back to a "X min" label).
export function formatResponseTime(minutes: number | null, lang: 'en' | 'ar'): string {
  if (minutes == null) return '';
  if (minutes <= 30) return lang === 'ar' ? '30 دقيقة' : '30 min';
  if (minutes <= 60) return lang === 'ar' ? 'ساعة' : '1 hour';
  if (minutes <= 120) return lang === 'ar' ? 'ساعة–ساعتين' : '1–2 hours';
  if (minutes <= 240) return lang === 'ar' ? '2–4 ساعات' : '2–4 hours';
  if (minutes <= 480) return lang === 'ar' ? 'يوم كامل' : 'Full day';
  const hours = Math.round(minutes / 60);
  return lang === 'ar' ? `${hours} ساعات` : `${hours} hours`;
}

// ISO timestamp → "5m ago" / "منذ 5د". Pure local-time formatter so
// the screen renders without a date-fns dependency for a single use.
export function formatRelativeTime(iso: string, lang: 'en' | 'ar'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return lang === 'ar' ? 'الآن' : 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return lang === 'ar' ? `منذ ${minutes}د` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'ar' ? `منذ ${hours}س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return lang === 'ar' ? `منذ ${days}ي` : `${days}d ago`;
  return date.toLocaleDateString(lang === 'ar' ? 'ar' : 'en');
}
