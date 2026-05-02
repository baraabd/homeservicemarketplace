import type {
  ListAvailableJobsQuery,
  ProviderAvailableRequestsQuery,
} from '@homeservicemarketplace/contracts';

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
    // Legacy /me/provider/jobs feed (kept for backwards compatibility
    // with any caller still on the old path; the canonical feed is
    // `availableRequests` below).
    available: (filters: Pick<ListAvailableJobsQuery, 'categoryId' | 'city'> = {}) =>
      ['provider', 'jobs', 'available', filters] as const,
  },
  availableRequests: {
    // Sprint 5.2 (canonical) — /v1/provider/available-requests.
    // Mutations on bids / bookings should invalidate this root so
    // the feed reflects already-bid hides + scheduled-now-disappears
    // without a manual refetch.
    root: ['provider', 'available-requests'] as const,
    list: (filters: Pick<ProviderAvailableRequestsQuery, 'category' | 'near'> = {}) =>
      ['provider', 'available-requests', 'list', filters] as const,
    detail: (requestId: string) => ['provider', 'available-requests', 'detail', requestId] as const,
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
  notifications: {
    // Provider notifications drawer (Sprint 5.5). Mark-one /
    // mark-all mutations invalidate the root so list + count
    // refetch together.
    root: ['provider', 'notifications'] as const,
    list: (filters: { unread?: boolean } = {}) =>
      ['provider', 'notifications', 'list', filters] as const,
    unreadCount: () => ['provider', 'notifications', 'unread-count'] as const,
  },
  chat: {
    // Provider chat (Sprint 5.5). Send-message invalidates the
    // messages(id) slot AND the conversations list so the preview
    // line updates without a manual refetch.
    root: ['provider', 'chat'] as const,
    conversations: () => ['provider', 'chat', 'conversations'] as const,
    messages: (conversationId: string) => ['provider', 'chat', 'messages', conversationId] as const,
  },
} as const;
