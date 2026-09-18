import { useQuery } from '@tanstack/react-query';
import { getProviderCapabilities } from '../../../lib/provider/provider-verification-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

/** Render the server's current decision; never infer permission from status.
 * A fresh answer is required each time the workspace is entered. The auth
 * provider purges this cache on sign-out and session expiry. */
export function useProviderCapabilities(enabled = true) {
  return useQuery({
    queryKey: providerQueryKeys.capabilities.get(),
    queryFn: getProviderCapabilities,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
  });
}
