import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearAuthSession } from './auth-session-reset';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('S04 authenticated query cancellation', () => {
  it('a late successful /me cannot resurrect the user after logout/expiry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const oldUser = { id: 'synthetic-old-session' };
    client.setQueryData(['auth', 'me'], oldUser);
    client.setQueryData(['provider', 'private-profile'], { private: true });
    const response = deferred<typeof oldUser>();
    const fetch = client.fetchQuery({
      queryKey: ['auth', 'me'], queryFn: () => response.promise, staleTime: 0,
    }).catch(() => undefined);
    expect(client.isFetching({ queryKey: ['auth', 'me'] })).toBe(1);
    await clearAuthSession(client);
    response.resolve(oldUser);
    await fetch;
    await Promise.resolve();
    expect(client.getQueryData(['auth', 'me'])).toBeNull();
    expect(client.getQueryData(['provider', 'private-profile'])).toBeUndefined();
    expect(client.isFetching()).toBe(0);
    client.clear();
  });

  it('preserves the auth cache entry and permits a later intentional login', async () => {
    const client = new QueryClient();
    client.setQueryData(['auth', 'me'], { id: 'old' });
    await clearAuthSession(client);
    expect(client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })).toBeDefined();
    client.setQueryData(['auth', 'me'], { id: 'new' });
    expect(client.getQueryData(['auth', 'me'])).toEqual({ id: 'new' });
    client.clear();
  });

  it('removes every non-auth namespace, not only the currently active app', async () => {
    const client = new QueryClient();
    for (const namespace of ['seeker', 'provider', 'admin', 'notifications', 'messages']) {
      client.setQueryData([namespace, 'private'], { owner: 'old' });
    }
    await clearAuthSession(client);
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([['auth', 'me']]);
    client.clear();
  });
});
