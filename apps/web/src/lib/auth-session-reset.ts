import type { QueryClient } from '@tanstack/react-query';
import { invalidateAuthRequests } from './auth-session-boundary';

/** Cancel before clearing: an earlier /me response must not restore a session. */
export async function clearAuthSession(client: QueryClient): Promise<void> {
  invalidateAuthRequests();
  try {
    // Cancel every private request, not only /me. In-flight mutation responses
    // are fenced by the API scope; clearing this cache does not undo a server write.
    await client.cancelQueries();
  } finally {
    // Keep the auth observer subscribed. clear() would strand mounted guards.
    client.setQueryData(['auth', 'me'], null);
    for (const query of client.getQueryCache().getAll()) {
      if (!(query.queryKey.length === 2 && query.queryKey[0] === 'auth' && query.queryKey[1] === 'me')) {
        client.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
    client.getMutationCache().clear();
  }
}
