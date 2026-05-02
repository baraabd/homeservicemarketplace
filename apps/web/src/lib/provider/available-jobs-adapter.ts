import type { AvailableJobSummary } from '@homeservicemarketplace/contracts';

import type { ServiceRequest } from '../../app/context/EcosystemContext';

// Adapter from the API's narrow AvailableJobSummary contract to the
// legacy ServiceRequest shape the ProviderApp screens render
// (mapX/mapY/serviceIcon/urgency/etc. were prototyped against an
// in-memory mock context). The mapper:
//
//   - hashes `id` deterministically into mapX/mapY so pins don't jump
//     around between renders. Without server-side coordinates this is
//     the cleanest substitute until Sprint 7.0 (realtime + locations).
//   - derives `urgency` from `scheduleType === 'ASAP'`.
//   - maps the category slug to a default emoji; `customServiceText`
//     requests fall back to a generic icon.
//   - leaves seekerName / seekerRating BLANK (the wire deliberately
//     does not expose seeker identity until a bid is accepted, per
//     the Sprint 5.2 security projection).
//
// Treat the legacy `bids: Bid[]` field as "an array sized to bidsCount
// for length-only UIs"; the screens that call .map over it are out of
// scope for this slice and will continue to render context bids until
// Sprint 5.3 ships the real bid surface.
export function mapAvailableJobToLegacy(job: AvailableJobSummary): ServiceRequest {
  const { mapX, mapY } = mapPinFromId(job.id);
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
    mapX,
    mapY,
  };
}

// Stable djb2-style hash → percentage-on-canvas. Keeps the same id
// pinned to the same coordinate across renders, which the existing
// JobPin animation (whileHover scale) relies on.
function mapPinFromId(id: string): { mapX: number; mapY: number } {
  let hashX = 5381;
  let hashY = 5381;
  for (let i = 0; i < id.length; i += 1) {
    const code = id.charCodeAt(i);
    hashX = (hashX * 33) ^ code;
    hashY = (hashY * 31) ^ (code + 17);
  }
  // Avoid the very edges (15..85 range) so pins stay inside the map.
  const mapX = 15 + (Math.abs(hashX) % 70);
  const mapY = 15 + (Math.abs(hashY) % 70);
  return { mapX, mapY };
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

function iconForCategorySlug(slug: string | null): string {
  if (!slug) return '🛠️';
  return ICON_BY_SLUG[slug] ?? '🛠️';
}
