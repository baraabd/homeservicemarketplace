import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderActivationScreen } from './ProviderActivationScreen';
import { ACTIVATION_COPY } from '../copy/activation-copy';

// Sprint 09B.29 — prototype screens 0 and 1, every visible state.
//
// The rule these assertions exist to hold: NOTHING navigates into a provider
// route until the AUTHORITATIVE session has been verified to carry the provider
// role. A profile row exists the moment `/upgrade` commits; the session is what
// lags, and routing on the profile is what produced the 403 loop.

const UPGRADE_URL = '/v1/me/provider/upgrade';
const REFRESH_URL = '/v1/auth/refresh';
const ME_URL = '/v1/auth/me';

const PROFILE = {
  profile: { id: 'pp-1', displayName: 'Sam Seeker', status: 'DRAFT' },
};

function me(roles: string[]) {
  return {
    id: 'u-1',
    email: 'sam@example.com',
    firstName: 'Sam',
    lastName: 'Seeker',
    status: 'ACTIVE',
    emailVerifiedAt: null,
    mfaEnabled: false,
    roles,
  };
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderActivation(lang: 'en' | 'ar' = 'en') {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/provider/activate']}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <Routes>
            <Route path="/provider/activate" element={<ProviderActivationScreen />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProviderActivationScreen — screen 0, activation', () => {
  it('renders the prototype hero, the "what you need" panel, and one primary action', () => {
    renderActivation();

    expect(screen.getByTestId('activation-hero')).toBeTruthy();
    expect(screen.getByText(ACTIVATION_COPY.en.activateHeading)).toBeTruthy();
    expect(screen.getByText(ACTIVATION_COPY.en.needTitle)).toBeTruthy();

    const cta = screen.getByTestId('activation-cta');
    expect(cta.textContent).toContain(ACTIVATION_COPY.en.activateCta);
  });

  it('renders the Arabic copy under RTL', () => {
    renderActivation('ar');
    expect(screen.getByText(ACTIVATION_COPY.ar.activateHeading)).toBeTruthy();
    expect(screen.getByTestId('activation-cta').textContent).toContain(
      ACTIVATION_COPY.ar.activateCta,
    );
    // Direction is owned by the shell, and it has to be the Arabic one.
    expect(screen.getByTestId('onboarding-v2-shell').getAttribute('dir')).toBe('rtl');
  });

  it('shows 0% progress — no application exists yet', () => {
    renderActivation();
    expect(screen.getByTestId('onboarding-v2-progress-bar').getAttribute('aria-valuenow')).toBe(
      '0',
    );
  });

  it('disables the button while the upgrade is in flight, so it cannot be submitted twice', async () => {
    // Never resolves: the point is the pending state, not the outcome.
    mock.onPost(UPGRADE_URL).reply(() => new Promise(() => {}));
    renderActivation();

    const cta = screen.getByTestId('activation-cta') as HTMLButtonElement;
    fireEvent.click(cta);

    await waitFor(() => expect(cta.disabled).toBe(true));
    expect(cta.getAttribute('aria-busy')).toBe('true');
    expect(cta.textContent).toContain(ACTIVATION_COPY.en.activatePending);
  });

  it('surfaces an upgrade failure and offers a retry, without pretending anything changed', async () => {
    mock.onPost(UPGRADE_URL).reply(500);
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    const error = await screen.findByTestId('activation-upgrade-error');
    expect(error.textContent).toContain(ACTIVATION_COPY.en.upgradeFailedTitle);
    // It is an alert, and it takes focus — a recovery action nobody can find
    // is not a recovery action.
    expect(error.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(document.activeElement).toBe(error));

    expect(screen.getByTestId('activation-cta').textContent).toContain(
      ACTIVATION_COPY.en.upgradeRetryCta,
    );
  });
});

describe('ProviderActivationScreen — screen 1, role synchronization', () => {
  it('shows the sync screen with the "no sign-in needed" reassurance while rotating', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    // Rotation hangs, so the in-flight state stays on screen.
    mock.onPost(REFRESH_URL).reply(() => new Promise(() => {}));
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    const notice = await screen.findByTestId('activation-sync-notice');
    expect(notice.textContent).toContain(ACTIVATION_COPY.en.syncNoticeTitle);
    // The sentence that stops a provider reaching for the sign-in button.
    expect(notice.textContent).toContain('not an expired session');
    expect(screen.getByText(ACTIVATION_COPY.en.syncHeading)).toBeTruthy();
    // 5%, exactly as the prototype's sync screen draws it.
    expect(screen.getByTestId('onboarding-v2-progress-bar').getAttribute('aria-valuenow')).toBe(
      '5',
    );
  });

  it('navigates ONLY after the authoritative session reports the provider role', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(200);
    mock.onGet(ME_URL).reply(200, me(['seeker', 'provider']));
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/provider/onboarding'),
    );
  });

  it('does NOT navigate when the rotation succeeds but the role never arrives', async () => {
    // The trap this whole repair exists to avoid: a 200 from /refresh is not
    // proof of anything. Navigating here lands the provider in a 403.
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(200);
    mock.onGet(ME_URL).reply(200, me(['seeker']));
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    const error = await screen.findByTestId('activation-sync-error');
    expect(error.getAttribute('data-reason')).toBe('role-missing');
    expect(screen.queryByTestId('location')).toBeNull();
  });

  it('offers no retry for a genuine refusal — asking again returns the same answer', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(200);
    mock.onGet(ME_URL).reply(200, me(['seeker']));
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    await screen.findByTestId('activation-sync-error');
    expect(screen.queryByTestId('activation-sync-retry')).toBeNull();
    expect(screen.getByText(ACTIVATION_COPY.en.syncRefusedTitle)).toBeTruthy();
  });

  it('surfaces a failed rotation as retryable, and says the account was still created', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(500);
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));

    const error = await screen.findByTestId('activation-sync-error');
    expect(error.getAttribute('data-reason')).toBe('refresh-failed');
    // The provider's actual worry at this point is whether they must start
    // again. They must not be left guessing.
    expect(error.textContent).toContain('created successfully');
    expect(screen.getByTestId('activation-sync-retry')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(error));
  });

  it('recovers when the provider retries a failed rotation and it then succeeds', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).replyOnce(500);
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));
    await screen.findByTestId('activation-sync-retry');

    // Second attempt works, and the session now carries the role.
    mock.onPost(REFRESH_URL).reply(200);
    mock.onGet(ME_URL).reply(200, me(['seeker', 'provider']));
    fireEvent.click(screen.getByTestId('activation-sync-retry'));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/provider/onboarding'),
    );
  });

  it('never shows session-expired copy for a synchronization problem', async () => {
    // The regression in one assertion: whatever else this screen says, it must
    // not tell a provider with a valid session to sign in again.
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(500);
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));
    await screen.findByTestId('activation-sync-error');

    const body = document.body.textContent ?? '';
    expect(body).not.toContain('sign in again');
    expect(body).not.toContain('session has ended');
    expect(body).not.toContain('expired');
  });

  it('announces the synchronization politely for assistive technology', async () => {
    mock.onPost(UPGRADE_URL).reply(200, PROFILE);
    mock.onPost(REFRESH_URL).reply(() => new Promise(() => {}));
    renderActivation();

    fireEvent.click(screen.getByTestId('activation-cta'));
    await screen.findByTestId('activation-sync-notice');

    const live = document.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toBe(ACTIVATION_COPY.en.syncLiveStatus);
  });
});
