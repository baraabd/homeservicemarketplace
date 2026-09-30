import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from './api';
import * as authApi from './auth-api';
import { AuthProvider, createAuthQueryClient, useAuth } from './auth-provider';
import {
  AUTH_BOUNDARY_KEY, hasUnconfirmedLogout, isLocallySignedOut,
  recordLocalLogout, recordSessionEnded, recordVerifiedLogin,
} from './auth-session-boundary';

vi.mock('./realtime/use-realtime-socket', () => ({ useRealtimeSocket: () => undefined }));
vi.mock('./realtime/notification-arrival-watcher', () => ({ useNotificationArrivalWatcher: () => undefined }));

const user = { id: 'synthetic-logout', email: 'logout@example.test', firstName: 'Test', lastName: 'Account', status: 'ACTIVE', emailVerifiedAt: '2026-01-01T00:00:00Z', mfaEnabled: false, roles: ['customer'] };
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
function Probe() {
  const auth = useAuth();
  return <>
    <span data-testid="identity">{auth.user?.id ?? 'guest'}</span>
    <span data-testid="logout-state">{auth.logoutState}</span>
    <button onClick={() => { void auth.logout(); }}>Sign out</button>
  </>;
}

describe('R04 persistent logout notice state', () => {
  it('separates local restoration blocking from unconfirmed server logout', () => {
    recordLocalLogout();
    expect(isLocallySignedOut()).toBe(true);
    expect(hasUnconfirmedLogout()).toBe(true);
    recordSessionEnded();
    expect(isLocallySignedOut()).toBe(true);
    expect(hasUnconfirmedLogout()).toBe(false);
    recordVerifiedLogin();
    expect(isLocallySignedOut()).toBe(false);
    expect(hasUnconfirmedLogout()).toBe(false);
  });

  it.each([undefined, 'false', null])('keeps older or invalid confirmation metadata %p conservative', (unconfirmed) => {
    localStorage.setItem(AUTH_BOUNDARY_KEY, JSON.stringify({ revision: 'older-tab', state: 'signed-out', unconfirmed }));
    expect(isLocallySignedOut()).toBe(true);
    expect(hasUnconfirmedLogout()).toBe(true);
  });

  it('retains both kinds of local state when storage writes are denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota denied'); });
    recordLocalLogout();
    expect(hasUnconfirmedLogout()).toBe(true);
    recordSessionEnded();
    expect(isLocallySignedOut()).toBe(true);
    expect(hasUnconfirmedLogout()).toBe(false);
    recordLocalLogout();
    expect(hasUnconfirmedLogout()).toBe(true);
  });

  it('a cold guest 401 never invents an unsuccessful logout on remount', async () => {
    mock.onGet('/v1/auth/me').reply(401);
    mock.onPost('/v1/auth/refresh').reply(401);
    const client = createAuthQueryClient();
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    await waitFor(() => expect(client.getQueryData(['auth', 'me'])).toBeNull());
    expect(screen.getByTestId('logout-state')).toHaveTextContent('idle');
    expect(hasUnconfirmedLogout()).toBe(false);
    expect(isLocallySignedOut()).toBe(true);
    const reads = mock.history.get.length;
    view.unmount();
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('guest');
    expect(screen.getByTestId('logout-state')).toHaveTextContent('idle');
    expect(mock.history.get).toHaveLength(reads);
    client.clear();
  });

  it('server-acknowledged logout remains blocked without an unconfirmed notice after remount', async () => {
    mock.onGet('/v1/auth/me').reply(200, user);
    mock.onPost('/v1/auth/logout').reply(204);
    const client = createAuthQueryClient();
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText(user.id);
    fireEvent.click(screen.getByText('Sign out'));
    await waitFor(() => expect(screen.getByTestId('logout-state')).toHaveTextContent('confirmed'));
    expect(hasUnconfirmedLogout()).toBe(false);
    expect(isLocallySignedOut()).toBe(true);
    const reads = mock.history.get.length;
    view.unmount();
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('guest');
    expect(screen.getByTestId('logout-state')).toHaveTextContent('idle');
    expect(mock.history.get).toHaveLength(reads);
    client.clear();
  });

  it('peer confirmation clears private data without restoring an identity or inventing a warning', async () => {
    mock.onGet('/v1/auth/me').reply(200, user);
    const client = createAuthQueryClient();
    render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText(user.id);
    client.setQueryData(['private', 'messages'], ['old-account']);
    const reads = mock.history.get.length;
    await act(async () => {
      localStorage.setItem(AUTH_BOUNDARY_KEY, JSON.stringify({ revision: 'confirmed-peer', state: 'signed-out', unconfirmed: false }));
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_BOUNDARY_KEY }));
    });
    await screen.findByText('guest');
    expect(client.getQueryData(['private', 'messages'])).toBeUndefined();
    expect(screen.getByTestId('logout-state')).toHaveTextContent('idle');
    expect(mock.history.get).toHaveLength(reads);
    client.clear();
  });

  it('successful password reset does not revive the unconfirmed logout notice after remount', async () => {
    mock.onGet('/v1/auth/me').reply(200, user);
    mock.onPost('/v1/auth/reset-password').reply(200);
    const client = createAuthQueryClient();
    const view = render(<AuthProvider client={client}><Probe /></AuthProvider>);
    await screen.findByText(user.id);
    await act(async () => { await authApi.resetPassword('synthetic-token', 'synthetic-new-passphrase'); });
    await screen.findByText('guest');
    expect(screen.getByTestId('logout-state')).toHaveTextContent('confirmed');
    expect(isLocallySignedOut()).toBe(true);
    expect(hasUnconfirmedLogout()).toBe(false);
    view.unmount();
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('guest');
    expect(screen.getByTestId('logout-state')).toHaveTextContent('idle');
    client.clear();
  });
});
