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
} as const;
