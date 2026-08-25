import { useQuery } from '@tanstack/react-query';
import type { AdminVerificationCase } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { adminProvidersQueryKeys } from '../../../hooks/admin/useAdminProviders';

// Sprint 9B — reading a verification case.
//
// EXTENDS the existing adminProvidersQueryKeys factory rather than starting a
// second one (docs/sprint-09b/UX-UI-COMPONENT-AUDIT.md, decision 16). Two key
// factories means two invalidation stories, and a mutation that invalidates one
// leaves the other stale.

export const verificationCaseKey = (providerProfileId: string) =>
  [...adminProvidersQueryKeys.detail(providerProfileId), 'verification'] as const;

/**
 * The case metadata for one provider.
 *
 * SAFE TO CACHE. The payload carries no bytes, no storage key and no signed
 * URL — opening a document is a separate, short-lived, audited call
 * (docs/adr/0009). Keeping the credential out of this response is what makes
 * caching it acceptable at all: a signed URL held in a query cache outlives its
 * intended lifetime by however long the cache does.
 *
 * `null` is a legitimate result meaning "this provider has never submitted",
 * which is why the endpoint returns null rather than 404.
 */
export function useVerificationCase(providerProfileId: string | null) {
  return useQuery<AdminVerificationCase | null>({
    queryKey: verificationCaseKey(providerProfileId ?? ''),
    enabled: providerProfileId !== null,
    queryFn: async ({ signal }) => {
      // The abort signal is threaded through so a reviewer who closes the
      // drawer mid-flight cancels the request rather than leaving it to
      // resolve into a discarded cache entry.
      const res = await api.get<AdminVerificationCase | null>(
        `/v1/admin/providers/${providerProfileId}/verification`,
        { signal },
      );
      return res.data;
    },
    // Short. A reviewer acting on a case wants to see their own decision
    // reflected, and scan state changes underneath them while they read.
    staleTime: 15_000,
  });
}
