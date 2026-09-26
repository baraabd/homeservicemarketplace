import type { QueryClient } from '@tanstack/react-query';

/** Cancel before clearing: an earlier /me response must not restore a session. */
export async function clearAuthSession(client: QueryClient): Promise<void> {
  try {
    await client.cancelQueries({ queryKey: ['auth', 'me'] });
  } finally {
    // Keep the auth observer subscribed. clear() would strand mounted guards.
    client.setQueryData(['auth', 'me'], null);
    for (const query of client.getQueryCache().getAll()) {
      if (query.queryKey[0] !== 'auth') {
        client.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  }
}
