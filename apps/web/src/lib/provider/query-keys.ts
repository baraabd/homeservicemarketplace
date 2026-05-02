import type { ListAvailableJobsQuery } from '@homeservicemarketplace/contracts';

// Centralised React Query key factory for the Provider bounded
// context. Mirrors the seekerQueryKeys layout so invalidation patterns
// stay consistent across the codebase.
export const providerQueryKeys = {
  profile: {
    // Root for all provider-profile queries. Upgrade / update / update-
    // availability mutations invalidate the root so the cache picks up
    // the canonical server state in one call.
    root: ['provider', 'profile'] as const,
    get: () => ['provider', 'profile', 'get'] as const,
  },
  jobs: {
    root: ['provider', 'jobs'] as const,
    // Available-jobs feed (Sprint 5.2). Filters are part of the cache
    // key so different filter combos do not collide. `cursor` is
    // intentionally NOT in the key — the hook uses
    // `keepPreviousData` semantics rather than a separate cache slot
    // per page.
    available: (filters: Pick<ListAvailableJobsQuery, 'categoryId' | 'city'> = {}) =>
      ['provider', 'jobs', 'available', filters] as const,
  },
  bids: {
    // Provider-side own bids (Sprint 5.3). Submit / withdraw mutations
    // invalidate the root so list views refetch in one call. The
    // available-jobs feed also gets invalidated on submit so the
    // hasOwnBid flag flips correctly without a manual refetch.
    root: ['provider', 'bids'] as const,
    list: (filters: { status?: string } = {}) => ['provider', 'bids', 'list', filters] as const,
  },
  bookings: {
    // Provider-side bookings (Sprint 5.4). Start / complete / cancel
    // mutations invalidate the root so list + detail refetch in one
    // call. Bids invalidate too so the My Bids 'Start Job' button
    // (rendered on ACCEPTED bids) reflects the new booking state.
    root: ['provider', 'bookings'] as const,
    list: (filters: { status?: string } = {}) => ['provider', 'bookings', 'list', filters] as const,
    detail: (bookingId: string) => ['provider', 'bookings', 'detail', bookingId] as const,
    timeline: (bookingId: string) => ['provider', 'bookings', 'timeline', bookingId] as const,
  },
  wallet: {
    // Provider earnings / wallet read model (Sprint 5.6). Booking
    // lifecycle mutations (start / complete / cancel) should also
    // invalidate this root so the summary aggregates update without
    // a manual refetch — handled in useProviderBookings.
    root: ['provider', 'wallet'] as const,
    summary: () => ['provider', 'wallet', 'summary'] as const,
    transactions: (filters: { status?: string } = {}) =>
      ['provider', 'wallet', 'transactions', filters] as const,
  },
} as const;
