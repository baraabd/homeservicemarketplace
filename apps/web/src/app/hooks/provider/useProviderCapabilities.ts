import { useQuery } from '@tanstack/react-query';
import { getProviderCapabilities } from '../../../lib/provider/provider-verification-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

/** R17-E — how often an open workspace re-asks the server what it may do.
 *  A suspension, restriction or lapsed grant writes no notification the
 *  provider is guaranteed to receive, and realtime is off by default, so
 *  without this the first answer stood until the next sign-in. One small GET
 *  per half minute is the price of not showing write actions the server would
 *  refuse. Any provider 403 refetches at once (useProviderAuthorityRefresh). */
export const CAPABILITY_REFRESH_MS = 30_000;

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
    refetchInterval: enabled ? CAPABILITY_REFRESH_MS : false,
    // The app turns focus refetch off globally; authority is the exception,
    // because a provider returning to a tab is exactly when it may be stale.
    refetchOnWindowFocus: 'always',
  });
}
