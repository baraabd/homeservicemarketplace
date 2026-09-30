import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from './api';
import { AuthProvider, createAuthQueryClient, useAuth } from './auth-provider';
import * as authApi from './auth-api';
import { AUTH_BOUNDARY_KEY, authRequestScope, invalidateAuthRequests, isLocallySignedOut, recordLocalLogout, recordVerifiedLogin } from './auth-session-boundary';
import { useIdentityState } from './use-identity-state';

vi.mock('./realtime/use-realtime-socket', () => ({ useRealtimeSocket: () => undefined }));
vi.mock('./realtime/notification-arrival-watcher', () => ({ useNotificationArrivalWatcher: () => undefined }));
const first = { id: 'synthetic-a', email: 'a@example.test', firstName: 'A', lastName: 'Test', status: 'ACTIVE', emailVerifiedAt: '2026-01-01T00:00:00Z', mfaEnabled: false, roles: ['customer'] };
let mock: MockAdapter;
beforeEach(() => {
  recordVerifiedLogin();
  mock = new MockAdapter(api);
  document.cookie = 'hsm_csrf=synthetic-csrf';
});
afterEach(() => {
  cleanup();
  mock.restore();
  vi.restoreAllMocks();
  recordVerifiedLogin();
  localStorage.clear();
  document.cookie = 'hsm_csrf=; Max-Age=0';
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
function Probe() {
  const auth = useAuth();
  return <>
    <output data-testid="identity">{auth.user?.id ?? 'guest'}</output>
    <output data-testid="logout">{auth.logoutState}</output>
    <button onClick={() => { void auth.logout(); }}>Sign out</button>
    <button onClick={() => { void auth.verifyOtp('synthetic-challenge', '123456'); }}>Verify</button>
  </>;
}

describe('R04 mounted account boundary with actual query observers and mock HTTP', () => {
  it('purges private state before logout responds; an unconfirmed logout survives remount', async () => {
    mock.onGet('/v1/auth/me').reply(200, first);
    const reply = deferred<[number, unknown]>();
    mock.onPost('/v1/auth/logout').reply(() => reply.promise);
    const client = createAuthQueryClient();
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText('synthetic-a');
    client.setQueryData(['private', 'draft'], { owner: first.id });
    fireEvent.click(screen.getByText('Sign out'));
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('guest'));
    expect(client.getQueryData(['private', 'draft'])).toBeUndefined();
    expect(screen.getByTestId('logout')).toHaveTextContent('pending');
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    await act(async () => { reply.resolve([503, {}]); });
    await waitFor(() => expect(screen.getByTestId('logout')).toHaveTextContent('unconfirmed'));
    const reads = mock.history.get.length;
    view.unmount();
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('guest');
    expect(mock.history.get).toHaveLength(reads);
    client.clear();
  });

  it('exposes a newly verified account only after the previous query and mutation data is gone', async () => {
    let current = first;
    mock.onGet('/v1/auth/me').reply(() => [200, current]);
    mock.onPost('/v1/auth/verify-otp').reply(() => { current = { ...first, id: 'synthetic-b' }; return [200, {}]; });
    const client = createAuthQueryClient();
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText('synthetic-a');
    client.setQueryData(['admin', 'private'], { old: true });
    const mutation = client.getMutationCache().build(client, { mutationFn: async (value: string) => value });
    await mutation.execute('synthetic private draft');
    fireEvent.click(screen.getByText('Verify'));
    await screen.findByText('synthetic-b');
    expect(client.getQueryData(['admin', 'private'])).toBeUndefined();
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    client.clear();
  });

  it('a cross-tab notification supplies no identity; only a fresh server response may replace it', async () => {
    let current = first;
    mock.onGet('/v1/auth/me').reply(() => [200, current]);
    const client = createAuthQueryClient();
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText('synthetic-a');
    client.setQueryData(['messages'], ['private']);
    current = { ...first, id: 'synthetic-b' };
    await act(async () => {
      localStorage.setItem(AUTH_BOUNDARY_KEY, JSON.stringify({ revision: 'peer-new', state: 'changed' }));
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_BOUNDARY_KEY }));
    });
    await screen.findByText('synthetic-b');
    expect(client.getQueryData(['messages'])).toBeUndefined();
    await act(async () => {
      localStorage.setItem(AUTH_BOUNDARY_KEY, JSON.stringify({ revision: 'peer-out', state: 'signed-out' }));
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_BOUNDARY_KEY }));
    });
    await screen.findByText('guest');
    client.clear();
  });

  it('successful password recovery revocation clears local authentication without remounting the public form', async () => {
    mock.onGet('/v1/auth/me').reply(200, first);
    mock.onPost('/v1/auth/reset-password').reply(200);
    const client = createAuthQueryClient();
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText('synthetic-a');
    await act(async () => { await authApi.resetPassword('synthetic-token', 'synthetic-new-passphrase'); });
    await screen.findByText('guest');
    expect(screen.getByTestId('logout')).toHaveTextContent('confirmed');
    expect(isLocallySignedOut()).toBe(true);
    client.clear();
  });
});

describe('R04 delayed response and degraded transport boundaries', () => {
  it.each([200, 401])('an earlier identity response %s cannot save, refresh or expire the new account', async (status) => {
    const response = deferred<[number, unknown]>();
    mock.onPatch('/v1/provider/profile').reply(() => response.promise);
    mock.onPost('/v1/auth/refresh').reply(200);
    const accepted = vi.fn();
    const rejected = vi.fn();
    const expired = vi.fn();
    window.addEventListener('auth:session-expired', expired);
    try {
      const request = api.patch('/v1/provider/profile', { bio: 'old synthetic draft' }).then(accepted, rejected);
      await waitFor(() => expect(mock.history.patch).toHaveLength(1));
      invalidateAuthRequests();
      response.resolve([status, { saved: true }]);
      await request;
      expect(accepted).not.toHaveBeenCalled();
      expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERR_CANCELED' }));
      expect(mock.history.post).toHaveLength(0);
      expect(expired).not.toHaveBeenCalled();
    } finally { window.removeEventListener('auth:session-expired', expired); }
  });
  it.each([429, 500, 503])('refresh %s is not evidence of server revocation', async (status) => {
    const expired = vi.fn();
    window.addEventListener('auth:session-expired', expired);
    mock.onGet('/v1/auth/me').reply(401);
    mock.onPost('/v1/auth/refresh').reply(status);
    try {
      await expect(authApi.getMe()).rejects.toMatchObject({ response: { status } });
      expect(expired).not.toHaveBeenCalled();
      expect(mock.history.get).toHaveLength(1);
    } finally { window.removeEventListener('auth:session-expired', expired); }
  });
  it('local logout still wins when localStorage writes fail but old values remain readable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota denied'); });
    const scope = authRequestScope();
    recordLocalLogout();
    expect(authRequestScope()).not.toBe(scope);
    expect(isLocallySignedOut()).toBe(true);
  });
});

it('account-local state drops old async callbacks without remounting a public child', () => {
  const view = renderHook(({ identity }) => useIdentityState(identity, 'empty'), { initialProps: { identity: 'A' } });
  const oldWrite = view.result.current[1];
  act(() => oldWrite('private-A'));
  expect(view.result.current[0]).toBe('private-A');
  view.rerender({ identity: 'B' });
  expect(view.result.current[0]).toBe('empty');
  act(() => oldWrite('late-A'));
  expect(view.result.current[0]).toBe('empty');
});
