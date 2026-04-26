import { useQuery } from '@tanstack/react-query';
import type { ServiceCategorySummary } from '@homeservicemarketplace/contracts';
import { listServiceCategories } from './services-api';

// React Query hook for the service-category catalog. Cached aggressively
// (the catalog is curated, not user-scoped) so navigating between tabs
// or pages doesn't re-hit the API. The auth-provider purges non-auth
// queries on logout / session-expired; that's fine here because the
// catalog endpoint is public and a fresh fetch on next mount is cheap.
export function useServiceCategories() {
  return useQuery<ServiceCategorySummary[]>({
    queryKey: ['services', 'categories'],
    queryFn: listServiceCategories,
    staleTime: 30 * 60 * 1000, // 30 min — catalog rarely changes
  });
}
