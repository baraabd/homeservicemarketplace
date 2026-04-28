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
} as const;
