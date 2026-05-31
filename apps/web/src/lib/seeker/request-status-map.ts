import type { BookingStatus, ServiceRequestStatus } from '@homeservicemarketplace/contracts';

// Map the backend ServiceRequestStatus enum to the existing
// LeadCardProps.status string set the UI components key colour /
// label / icon / behaviour off. Defined in one place so future status
// additions stay consistent across HomeScreen, AllLeadsView,
// LeadCard and JobDetailView.
//
// Mapping rules (per slice 3 spec):
//   OPEN_FOR_BIDS                                → pending
//   BID_ACCEPTED / BOOKED / IN_PROGRESS          → active
//   COMPLETED                                    → completed
//   CANCELLED                                    → cancelled
export type LeadStatus = 'pending' | 'active' | 'completed' | 'cancelled';

export function mapServiceRequestStatus(status: ServiceRequestStatus): LeadStatus {
  switch (status) {
    case 'OPEN_FOR_BIDS':
      return 'pending';
    case 'BID_ACCEPTED':
    case 'BOOKED':
    case 'IN_PROGRESS':
      return 'active';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    default: {
      // Exhaustiveness check: if a future enum value is added without
      // updating this map, TypeScript flags it here. We still need a
      // safe runtime fallback so an unknown status doesn't crash the UI.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'pending';
    }
  }
}

// Sprint 7.x — booking-aware lead status. The parent ServiceRequest
// intentionally stays at BID_ACCEPTED across booking lifecycle
// (cancel/complete do NOT auto-revert the request — documented in
// useBookings.ts). Without this overlay, an Active Leads card would
// visually stay at "active" even after the provider completed or
// cancelled the booking — the bug the user reported.
//
// `activeBookingStatus` ships on ServiceRequestSummary (Sprint 7.x
// backend) and reflects the latest non-deleted booking's status.
// When present, the booking lifecycle wins:
//   SCHEDULED        → keep request status (active when BID_ACCEPTED)
//   IN_PROGRESS      → active (same pill, but the card / detail
//                              surfaces the lifecycle)
//   COMPLETED        → completed
//   CANCELLED        → cancelled
//
// When `activeBookingStatus` is null (no booking yet — request is
// still OPEN_FOR_BIDS), fall through to the request status mapping.
export function mapLeadStatus(
  requestStatus: ServiceRequestStatus,
  activeBookingStatus: BookingStatus | null | undefined,
): LeadStatus {
  if (activeBookingStatus === 'COMPLETED') return 'completed';
  if (activeBookingStatus === 'CANCELLED') return 'cancelled';
  // SCHEDULED + IN_PROGRESS both map to "active" — same pill. The
  // detail surface (JobDetailView) renders the finer-grained stage.
  return mapServiceRequestStatus(requestStatus);
}

// Convert the backend category labels (English/Arabic on the wire) to
// the visual "service" key the existing service-icon maps already
// understand (Plumbing / Electrical / AC Repair / Cleaning / Carpentry
// / Painting / General). Falls back to General so unknown slugs render
// safely.
export function mapServiceCategorySlug(slug: string | null | undefined): string {
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
      return 'General';
  }
}

// "5 minutes ago" / "2 hours ago" / "3 days ago" — a tiny relative-time
// formatter for LeadCard.postedAt. Keeps the existing string shape (no
// design change) without pulling in date-fns at this call site.
export function formatRelativeTime(iso: string, lang: 'en' | 'ar' = 'en'): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = Math.max(0, now - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return lang === 'ar' ? 'الآن' : 'just now';
  if (minutes < 60) return lang === 'ar' ? `قبل ${minutes} د` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'ar' ? `قبل ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'ar' ? `قبل ${days} ي` : `${days}d ago`;
}
