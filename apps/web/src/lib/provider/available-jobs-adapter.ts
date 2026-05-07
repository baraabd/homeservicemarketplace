import type {
  AvailableJobSummary,
  ProviderAvailableRequestSummary,
} from '@homeservicemarketplace/contracts';

import type { ServiceRequest } from '../../app/context/EcosystemContext';

// Adapter from the API's narrow available-request shape (Sprint 5.2)
// to the legacy ServiceRequest the ProviderApp screens render. The
// mapper:
//
//   - threads `location.lat` / `location.lng` straight through. Either
//     may be null when the seeker's address has no captured coords;
//     the LiveJobsScreen's Leaflet layer skips null-coord pins rather
//     than synthesising fake positions.
//   - derives `urgency` from `scheduleType === 'ASAP'`.
//   - maps the category slug to a default emoji; `customServiceText`
//     requests fall back to a generic icon.
//   - leaves seekerName / seekerRating BLANK (the wire deliberately
//     does not expose seeker identity until a bid is accepted, per
//     the Sprint 5.2 security projection).
//
// Treat the legacy `bids: Bid[]` field as "an array sized to bidsCount
// for length-only UIs"; the screens that call .map over it have
// migrated to the real `useMyBids()` data in Sprint 5.3.
//
// The function accepts EITHER the older `AvailableJobSummary` (legacy
// /me/provider/jobs feed) OR the canonical
// `ProviderAvailableRequestSummary` (Sprint 5.2 `/v1/provider/available-requests`).
// They differ only in whether the wire emits a `hasOwnBid` flag —
// the canonical feed hides those rows server-side, so the flag is
// gone, and the adapter treats both shapes identically.
type AdaptableJob = AvailableJobSummary | ProviderAvailableRequestSummary;

export function mapAvailableJobToLegacy(job: AdaptableJob): ServiceRequest {
  const icon = iconForCategorySlug(job.category?.slug ?? null);
  const isUrgent = job.scheduleType === 'ASAP';
  const status = job.bidsCount > 0 ? 'bidding' : 'pending';
  const serviceLabelEn = job.category?.labelEn ?? job.customServiceText ?? 'Service request';
  const serviceLabelAr = job.category?.labelAr ?? job.customServiceText ?? 'طلب خدمة';
  const description = job.description ?? job.customServiceText ?? '';

  return {
    id: job.id,
    service: serviceLabelEn,
    serviceAr: serviceLabelAr,
    serviceIcon: icon,
    description,
    descriptionAr: description,
    budget: '',
    location: job.location.city,
    locationAr: job.location.city,
    seekerName: '',
    seekerRating: 0,
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
