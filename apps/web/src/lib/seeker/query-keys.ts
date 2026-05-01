// Centralised React Query key factory for the Seeker bounded context.
// Keeping the keys in one place makes invalidation deterministic — the
// auth-provider's purgeNonAuthQueries(), and any local invalidation
// site, can reference the same constants instead of stringly-typed
// arrays scattered across the codebase.
export const seekerQueryKeys = {
  addresses: {
    // Root for *all* address queries — pass to invalidateQueries() to
    // refetch the list after a mutation.
    root: ['seeker', 'addresses'] as const,
    list: () => ['seeker', 'addresses', 'list'] as const,
  },
  requests: {
    // Root for *all* request queries — pass to invalidateQueries() to
    // refetch list / detail / timeline after a mutation.
    root: ['seeker', 'requests'] as const,
    list: (filter?: { status?: string }) => ['seeker', 'requests', 'list', filter ?? {}] as const,
    detail: (id: string) => ['seeker', 'requests', 'detail', id] as const,
    timeline: (id: string) => ['seeker', 'requests', 'timeline', id] as const,
  },
  bids: {
    // Scoped under the request because every bid query is per-request
    // — invalidating the request's bids root after a future
    // accept-bid mutation will refresh both list and detail.
    root: (requestId: string) => ['seeker', 'requests', requestId, 'bids'] as const,
    list: (requestId: string, sort?: string) =>
      ['seeker', 'requests', requestId, 'bids', 'list', sort ?? 'recommended'] as const,
    detail: (requestId: string, bidId: string) =>
      ['seeker', 'requests', requestId, 'bids', 'detail', bidId] as const,
  },
  bookings: {
    // Root for all booking queries — pass to invalidateQueries after a
    // mutation (cancel-booking) to refresh list / detail / timeline in
    // one call. The accept-bid mutation also invalidates this root so
    // the new booking shows up in the Bookings tab without a manual
    // refresh.
    root: ['seeker', 'bookings'] as const,
    list: (filter?: { status?: string }) => ['seeker', 'bookings', 'list', filter ?? {}] as const,
    detail: (id: string) => ['seeker', 'bookings', 'detail', id] as const,
    timeline: (id: string) => ['seeker', 'bookings', 'timeline', id] as const,
  },
  conversations: {
    // Root for all chat queries. Send-message and mark-read mutations
    // invalidate the root so the conversations list re-orders / updates
    // unread counts and the messages list refetches.
    root: ['seeker', 'conversations'] as const,
    list: () => ['seeker', 'conversations', 'list'] as const,
    detail: (id: string) => ['seeker', 'conversations', 'detail', id] as const,
    messages: (id: string) => ['seeker', 'conversations', id, 'messages'] as const,
  },
  notifications: {
    // Root for all notification queries. mark-read / mark-all-read /
    // delete mutations invalidate the root so list + unread count
    // re-fetch in one call.
    root: ['seeker', 'notifications'] as const,
    list: (filter?: { unread?: boolean }) =>
      ['seeker', 'notifications', 'list', filter ?? {}] as const,
    unreadCount: () => ['seeker', 'notifications', 'unread-count'] as const,
  },
  profile: {
    // Root for the editable-profile query. Update-profile mutation
    // invalidates this root so the form re-reads the canonical
    // server state (post-trim, post-null-normalisation).
    root: ['seeker', 'profile'] as const,
    get: () => ['seeker', 'profile', 'get'] as const,
  },
} as const;
