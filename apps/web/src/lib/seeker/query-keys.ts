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
} as const;
