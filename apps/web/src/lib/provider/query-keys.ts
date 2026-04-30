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
} as const;
