import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LoginPage, SignUpPage, ForgotPasswordPage } from '../../pages/AuthPages';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';

let mock: MockAdapter;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mock = new MockAdapter(api);
  mock.onGet('/v1/auth/me').reply(401);
  mock
    .onGet('/v1/legal/documents')
    .reply(200, { acceptanceOpen: true, documents: Object.values(CURRENT_LEGAL_DOCUMENTS) });
});
afterEach(() => {
  cleanup();
  mock.restore();
});
function open(
  path: string,
  app: 'seeker' | 'provider' | 'admin' = 'seeker',
  client = createAuthQueryClient(),
) {
  return render(
    <AuthProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[{ pathname: path, state: { app } }]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
}
function setInput(selector: string, value: string) {
  const input = document.querySelector(selector);
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value } });
}
const challenge = {
  otpRequired: true,
  challengeId: 'abc123',
  codeLength: 6,
  expiresInSeconds: 300,
  channel: 'whatsapp',
  maskedDestination: '+966 •••• 4567',
};

describe('server-selected authentication channel', () => {
  it('waits for a fresh policy before rendering credentials from a warm cache', async () => {
    const client = createAuthQueryClient();
    client.setQueryData(AUTH_CONFIG_QUERY_KEY, { otpChannel: 'email', whatsappAvailable: true });
    let resolvePolicy!: (response: [number, unknown]) => void;
    mock.onGet('/v1/auth/config').reply(
      () =>
        new Promise<[number, unknown]>((resolve) => {
          resolvePolicy = resolve;
        }),
    );
    open('/login', 'admin', client);
    await waitFor(() =>
      expect(mock.history.get.some((r) => r.url === '/v1/auth/config')).toBe(true),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Preparing secure sign in');
    expect(document.querySelector('input')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log In' })).toBeNull();
    expect(mock.history.post).toHaveLength(0);

    resolvePolicy([200, { otpChannel: 'whatsapp', whatsappAvailable: true }]);
    await screen.findByTestId('auth-channel-whatsapp');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.querySelector('input[type="tel"]')).not.toBeNull();
  });

  it('requires retry when a warm cache cannot be confirmed by the server', async () => {
    const client = createAuthQueryClient();
    client.setQueryData(AUTH_CONFIG_QUERY_KEY, { otpChannel: 'email', whatsappAvailable: true });
    mock.onGet('/v1/auth/config').replyOnce(503, {});
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    open('/login', 'seeker', client);
    await screen.findByText('Sign-in options are unavailable');
    expect(document.querySelector('input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('auth-channel-whatsapp');
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  it('keeps typed credentials mounted while a confirmed policy refreshes in the background', async () => {
    const client = createAuthQueryClient();
    mock.onGet('/v1/auth/config').replyOnce(200, { otpChannel: 'email', whatsappAvailable: true });
    let resolveRefresh!: (response: [number, unknown]) => void;
    mock.onGet('/v1/auth/config').reply(
      () =>
        new Promise<[number, unknown]>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    open('/login', 'seeker', client);
    await screen.findByTestId('auth-channel-email');
    setInput('input[type="email"]', 'draft@example.test');
    setInput('input[type="password"]', 'Unsaved-password-17');
    const field = document.querySelector('input[type="email"]');
    const refresh = client.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY });
    await waitFor(() =>
      expect(mock.history.get.filter((r) => r.url === '/v1/auth/config')).toHaveLength(2),
    );
    expect(screen.getByDisplayValue('draft@example.test')).toBe(field);
    resolveRefresh([503, {}]);
    await refresh;
    expect(screen.getByDisplayValue('draft@example.test')).toBe(field);
    expect(screen.getByDisplayValue('Unsaved-password-17')).toBeInTheDocument();
    expect(screen.queryByText('Sign-in options are unavailable')).toBeNull();
  });

  it('keeps identity fields hidden on config failure and retries explicitly', async () => {
    let attempts = 0;
    mock
      .onGet('/v1/auth/config')
      .reply(() =>
        ++attempts === 1 ? [503, {}] : [200, { otpChannel: 'whatsapp', whatsappAvailable: true }],
      );
    open('/login');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    await screen.findByText('Sign-in options are unavailable');
    expect(document.querySelector('input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('auth-channel-whatsapp');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(screen.queryByText(/Inferred from browser locale/)).toBeNull();
  });

  for (const app of ['seeker', 'provider', 'admin'] as const)
    it(`uses WhatsApp identity and keeps ${app} branding`, async () => {
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
      mock.onPost('/v1/auth/login').reply(202, challenge);
      open('/login', app);
      await screen.findByTestId(`auth-hero-${app}`);
      setInput('input[type="tel"]', '+966501234567');
      setInput('input[type="password"]', 'Long-test-password-17');
      fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
      await screen.findByText('Check WhatsApp');
      expect(JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/login')!.data)).toEqual({
        phoneNumber: '+966501234567',
        password: 'Long-test-password-17',
      });
      expect(screen.queryByText('Verify your email')).toBeNull();
      expect(screen.getByText('+966 •••• 4567')).toBeVisible();
    });

  it('keeps existing email login reachable during a WhatsApp provider outage', async () => {
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: false });
    open('/login');
    await screen.findByText(
      'WhatsApp verification is temporarily unavailable. Use an existing email account or try again later.',
    );
    expect(screen.getByRole('button', { name: 'Log In' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'I have an email account' }));
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled();
  });

  it('retains an email login path and follows the challenge delivery channel', async () => {
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    mock
      .onPost('/v1/auth/login')
      .reply(202, { ...challenge, channel: 'email', maskedDestination: 'a•••@example.test' });
    open('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'I have an email account' }));
    setInput('input[type="email"]', 'a@example.test');
    setInput('input[type="password"]', 'Long-test-password-17');
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await screen.findByText('Verify your email');
    expect(JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/login')!.data)).toEqual({
      email: 'a@example.test',
      password: 'Long-test-password-17',
    });
  });

  it.each(['seeker', 'provider', 'admin'] as const)(
    'registers in the %s experience without requiring email or accepting a role from the UI',
    async (app) => {
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
      mock.onPost('/v1/auth/register').reply(202, challenge);
      open('/signup', app);
      await screen.findByTestId('auth-channel-whatsapp');
      setInput('input[type="text"]', 'Noura Ahmad');
      setInput('input[type="tel"]', '+963912345678');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
      expect(document.querySelector('input[type="email"]')).toBeNull();
      setInput('input[type="password"]', 'Long-test-password-17');
      fireEvent.click(await screen.findByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Check WhatsApp');
      const payload = JSON.parse(
        mock.history.post.find((r) => r.url === '/v1/auth/register')!.data,
      );
      expect(payload.phoneNumber).toBe('+963912345678');
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('role');
      expect(payload).not.toHaveProperty('roles');
      expect(screen.queryByText('Use a verification link instead')).toBeNull();
    },
  );

  it.each(['seeker', 'provider', 'admin'] as const)(
    'honors saved email policy for %s signup without asking for an unused phone number',
    async (app) => {
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: false });
      mock.onPost('/v1/auth/register').reply(202, {
        ...challenge,
        channel: 'email',
        maskedDestination: 'n•••@example.test',
      });
      open('/signup', app);
      await screen.findByTestId('auth-channel-email');
      expect(document.querySelector('input[type="tel"]')).toBeNull();
      setInput('input[type="text"]', 'Noura Ahmad');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      setInput('input[type="email"]', 'noura@example.test');
      setInput('input[type="password"]', 'Long-test-password-17');
      fireEvent.click(await screen.findByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Verify your email');
      const payload = JSON.parse(
        mock.history.post.find((r) => r.url === '/v1/auth/register')!.data,
      );
      expect(payload.email).toBe('noura@example.test');
      expect(payload).not.toHaveProperty('phoneNumber');
      expect(screen.getByText('Use a verification link instead')).toBeVisible();
    },
  );

  it('resets a WhatsApp-only account with a code and a new password', async () => {
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    mock.onPost('/v1/auth/forgot-password-otp').reply(202, challenge);
    mock.onPost('/v1/auth/reset-password-otp').reply(200, { success: true });
    open('/forgot-password');
    await screen.findByTestId('auth-channel-whatsapp');
    setInput('input[type="tel"]', '+966501234567');
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }));
    await screen.findByText('Check WhatsApp');
    const passwords = document.querySelectorAll('input[type="password"]');
    passwords.forEach((input) =>
      fireEvent.change(input, { target: { value: 'New-long-password-27' } }),
    );
    setInput('[data-testid="otp-input"]', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Password updated');
    expect(
      JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/reset-password-otp')!.data),
    ).toEqual({ challengeId: 'abc123', code: '123456', newPassword: 'New-long-password-27' });
  });
});
