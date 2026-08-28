import { useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { ProviderOnboardingHubView } from '@homeservicemarketplace/contracts';

import { getOnboardingHub } from '../../../lib/provider/provider-onboarding-hub-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

// Sprint 9B.16 — the hub read-model.
//
// Mirrors `useOnboardingDraft` deliberately, including its retry rule: 401,
// 403 and 404 are ANSWERS, not transient failures, and retrying them holds the
// screen on a spinner through several seconds of backoff before showing the
// same thing. The difference from the wizard hook is that this query has no
// local writer to protect, so it MAY refetch on window focus — a provider who
// finished a task in another tab should come back to a hub that agrees.

export function useProviderOnboardingHub(options: { enabled?: boolean } = {}) {
  return useQuery<ProviderOnboardingHubView, AxiosError>({
    queryKey: providerQueryKeys.onboarding.hub(),
    queryFn: getOnboardingHub,
    enabled: options.enabled ?? true,
    retry: (failureCount, err) => {
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}
