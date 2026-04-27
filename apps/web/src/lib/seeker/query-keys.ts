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
} as const;
