import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LoginPage, SignUpPage, ForgotPasswordPage } from '../../pages/AuthPages';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import { writeSignupDraft } from '../../features/legal/signup-consent';

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
const unavailable = 'The sign-in service is temporarily unavailable. Please try again shortly.';
const providerUnavailable =
  'WhatsApp verification is temporarily unavailable. Please try again later.';

describe('server-selected authentication channel', () => {
  for (const app of ['seeker', 'provider', 'admin'] as const)
    it.each(['en', 'ar'] as const)(
      `shows the default WhatsApp form for ${app} in %s while ignoring an unconfirmed email cache`,
      async (lang) => {
        localStorage.setItem('hsm.lang', lang);
        const client = createAuthQueryClient();
        client.setQueryData(AUTH_CONFIG_QUERY_KEY, {
          otpChannel: 'email',
          whatsappAvailable: true,
        });
        let resolvePolicy!: (response: [number, unknown]) => void;
        mock.onGet('/v1/auth/config').reply(
          () =>
            new Promise<[number, unknown]>((resolve) => {
              resolvePolicy = resolve;
            }),
        );
        open('/login', app, client);
        const phone = screen.getByLabelText(
          lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
        );
        const country = screen.getByTestId('dial-code-select');
        const toggle = screen.getByTestId('lang-toggle');
        const send = screen.getByRole('button', {
          name: lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code',
        });
        expect(screen.getByTestId(`auth-hero-${app}`)).toBeVisible();
        expect(screen.getByTestId('auth-channel-whatsapp')).toBeVisible();
        expect(
          screen.getByText(
            lang === 'ar' ? 'جارٍ تجهيز تسجيل الدخول…' : 'Preparing secure sign in…',
          ),
        ).toHaveAttribute('role', 'status');
        expect(phone).toBeEnabled();
        expect(country).toBeEnabled();
        expect(send).toBeDisabled();
        expect(document.querySelector('input[type="email"]')).toBeNull();
        expect(document.querySelector('input[type="password"]')).toBeNull();
        fireEvent.change(country, { target: { value: 'SE' } });
        fireEvent.change(phone, { target: { value: '701234567' } });
        act(() => phone.focus());
        fireEvent.click(send);
        expect(mock.history.post).toHaveLength(0);

        await waitFor(() => expect(resolvePolicy).toBeDefined());
        await act(async () => {
          resolvePolicy([200, { otpChannel: 'whatsapp', whatsappAvailable: true }]);
        });
        await waitFor(() => expect(send).toBeEnabled());
        expect(screen.getByDisplayValue('701234567')).toBe(phone);
        expect(phone).toHaveFocus();
        expect(country).toHaveValue('SE');
        expect(screen.getByTestId('lang-toggle')).toBe(toggle);
        expect(mock.history.post).toHaveLength(0);
      },
    );

  it('keeps the phone draft and focus through failure and explicit retry before accepting fresh email policy', async () => {
    const client = createAuthQueryClient();
    client.setQueryData(AUTH_CONFIG_QUERY_KEY, { otpChannel: 'email', whatsappAvailable: true });
    mock.onGet('/v1/auth/config').replyOnce(503, {});
    let resolvePolicy!: (response: [number, unknown]) => void;
    mock.onGet('/v1/auth/config').reply(
      () =>
        new Promise<[number, unknown]>((resolve) => {
          resolvePolicy = resolve;
        }),
    );
    open('/login', 'seeker', client);
    expect(await screen.findByRole('alert')).toHaveTextContent(unavailable);
    const phone = screen.getByLabelText('WhatsApp phone number');
    fireEvent.change(phone, { target: { value: '+966501234567' } });
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeDisabled();
    expect(screen.queryByText(providerUnavailable)).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveAttribute('data-tone', 'seeker');
    expect(retry).toHaveClass('h-12', 'bg-amber-700');
    fireEvent.click(retry);
    await screen.findByText('Preparing secure sign in…');
    act(() => phone.focus());
    expect(screen.getByLabelText('WhatsApp phone number')).toBe(phone);
    expect(phone).toHaveValue('+966501234567');
    expect(phone).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeDisabled();
    expect(mock.history.post).toHaveLength(0);
    await act(async () => {
      resolvePolicy([200, { otpChannel: 'email', whatsappAvailable: false }]);
    });
    await screen.findByTestId('auth-channel-email');
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled();
    expect(mock.history.post).toHaveLength(0);
  });

  it.each(['network failure', 'timeout', 'HTML response'] as const)(
    'keeps sending disabled after a policy %s and recovers from a fresh response',
    async (failure) => {
      const client = createAuthQueryClient();
      client.setQueryData(AUTH_CONFIG_QUERY_KEY, {
        otpChannel: 'whatsapp',
        whatsappAvailable: true,
      });
      const request = mock.onGet('/v1/auth/config');
      if (failure === 'network failure') request.networkErrorOnce();
      else if (failure === 'timeout') request.timeoutOnce();
      else request.replyOnce(200, '<!doctype html><html>Application shell</html>');
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: false });

      open('/login', 'provider', client);
      expect(await screen.findByRole('alert')).toHaveTextContent(unavailable);
      expect(screen.getByLabelText('WhatsApp phone number')).toBeEnabled();
      expect(screen.queryByText(providerUnavailable)).toBeNull();
      expect(document.querySelector('input[type="email"]')).toBeNull();
      expect(document.querySelector('input[type="password"]')).toBeNull();
      const send = screen.getByRole('button', { name: 'Send verification code' });
      expect(send).toBeDisabled();
      fireEvent.click(send);
      expect(mock.history.get.filter((item) => item.url === '/v1/auth/config')).toHaveLength(1);
      expect(mock.history.post).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByTestId('auth-channel-email');
      expect(screen.getByTestId('auth-hero-provider')).toBeVisible();
      expect(document.querySelector('input[type="email"]')).not.toBeNull();
      expect(document.querySelector('input[type="tel"]')).toBeNull();
      expect(mock.history.get.filter((item) => item.url === '/v1/auth/config')).toHaveLength(2);
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it('recovers in Arabic without changing the server-reported WhatsApp availability', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mock.onGet('/v1/auth/config').networkErrorOnce();
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: false });

    open('/login', 'admin');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.',
    );
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    const phone = screen.getByLabelText('رقم الهاتف المسجل في واتساب');
    fireEvent.change(screen.getByTestId('dial-code-select'), { target: { value: 'SY' } });
    fireEvent.change(phone, { target: { value: '912345678' } });
    expect(phone).toBeEnabled();

    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The sign-in service is temporarily unavailable. Please try again shortly.',
    );
    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByLabelText('رقم الهاتف المسجل في واتساب')).toBe(phone);
    expect(phone).toHaveValue('912345678');
    expect(screen.getByTestId('dial-code-select')).toHaveValue('SY');
    expect(mock.history.get.filter((item) => item.url === '/v1/auth/config')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await screen.findByText('التحقق عبر واتساب غير متاح مؤقتًا. يرجى المحاولة لاحقًا.');
    expect(screen.getByTestId('auth-hero-admin')).toBeVisible();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.querySelector('input[type="tel"]')).not.toBeNull();
    expect(screen.getByLabelText('رقم الهاتف المسجل في واتساب')).toBe(phone);
    expect(phone).toHaveValue('912345678');
    expect(screen.getByTestId('dial-code-select')).toHaveValue('SY');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'إرسال رمز التحقق', exact: true })).toBeDisabled();
    expect(mock.history.get.filter((item) => item.url === '/v1/auth/config')).toHaveLength(2);
    expect(mock.history.post).toHaveLength(0);
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
    act(() => (field as HTMLInputElement).focus());
    const refresh = client.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY });
    await waitFor(() =>
      expect(mock.history.get.filter((r) => r.url === '/v1/auth/config')).toHaveLength(2),
    );
    expect(screen.getByDisplayValue('draft@example.test')).toBe(field);
    resolveRefresh([503, {}]);
    await refresh;
    expect(screen.getByDisplayValue('draft@example.test')).toBe(field);
    expect(screen.getByDisplayValue('Unsaved-password-17')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled();
    expect(screen.queryByText(unavailable)).toBeNull();
  });

  for (const app of ['seeker', 'provider', 'admin'] as const)
    it.each(['en', 'ar'] as const)(
      `preserves the ${app} signup draft in %s while policy failure blocks progression`,
      async (lang) => {
        localStorage.setItem('hsm.lang', lang);
        let resolvePolicy!: (response: [number, unknown]) => void;
        mock.onGet('/v1/auth/config').replyOnce(
          () =>
            new Promise<[number, unknown]>((resolve) => {
              resolvePolicy = resolve;
            }),
        );
        mock
          .onGet('/v1/auth/config')
          .reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
        open('/signup', app);
        const phone = await screen.findByLabelText(
          lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
        );
        setInput('input[type="text"]', 'Noura Ahmad');
        fireEvent.change(phone, { target: { value: '+966501234567' } });
        const next = screen.getByRole('button', { name: lang === 'ar' ? 'التالي' : 'Next' });
        expect(next).toBeDisabled();
        fireEvent.click(next);
        expect(document.querySelector('input[type="password"]')).toBeNull();
        expect(mock.history.post).toHaveLength(0);
        await act(async () => resolvePolicy([503, {}]));
        await screen.findByRole('alert');
        expect(screen.getByDisplayValue('Noura Ahmad')).toBeInTheDocument();
        expect(screen.getByDisplayValue('+966501234567')).toBe(phone);
        expect(next).toBeDisabled();
        const retry = screen.getByRole('button', {
          name: lang === 'ar' ? 'إعادة المحاولة' : 'Try again',
        });
        expect(retry).toHaveAttribute('data-tone', app);
        fireEvent.click(retry);
        act(() => phone.focus());
        await waitFor(() => expect(next).toBeEnabled());
        expect(screen.getByDisplayValue('+966501234567')).toBe(phone);
        expect(phone).toHaveFocus();
        expect(mock.history.post).toHaveLength(0);
        fireEvent.click(next);
        await waitFor(() =>
          expect(document.querySelector('input[type="password"]')).not.toBeNull(),
        );
        expect(document.querySelector('input[type="email"]')).toBeNull();
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        expect(
          screen.getByRole('button', {
            name: lang === 'ar' ? 'إنشاء الحساب' : 'Create Account',
            exact: true,
          }),
        ).toBeDisabled();
      },
    );

  it('offers inline retry for a restored signup credential step without enabling registration', async () => {
    writeSignupDraft({
      step: 2,
      name: 'Noura Ahmad',
      email: '',
      countryCode: 'SY',
      localNumber: '912345678',
    });
    mock.onGet('/v1/auth/config').replyOnce(503, {});
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: false });
    open('/signup');
    expect(await screen.findByRole('alert')).toHaveTextContent(unavailable);
    const password = document.querySelector('input[type="password"]');
    expect(password).not.toBeNull();
    setInput('input[type="password"]', 'Long-test-password-17');
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('auth-channel-email');
    expect(screen.getByDisplayValue('Long-test-password-17')).toBe(password);
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create Account', exact: true })).toBeDisabled();
    expect(mock.history.post).toHaveLength(0);
  });

  for (const app of ['seeker', 'provider', 'admin'] as const)
    it.each(['en', 'ar'] as const)(`uses only phone and OTP for ${app} in %s`, async (lang) => {
      localStorage.setItem('hsm.lang', lang);
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
      mock.onPost('/v1/auth/login').reply(202, challenge);
      open('/login', app);
      await screen.findByTestId(`auth-hero-${app}`);
      expect(document.querySelector('input[type="password"]')).toBeNull();
      expect(document.querySelector('input[type="email"]')).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: /forgot password|نسيت كلمة المرور|I have an email|لدي حساب بالبريد/i,
        }),
      ).toBeNull();
      setInput('input[type="tel"]', '+966501234567');
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code',
          }),
        ).toBeEnabled(),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code',
        }),
      );
      await screen.findByText(lang === 'ar' ? 'تحقق من واتساب' : 'Check WhatsApp');
      expect(JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/login')!.data)).toEqual({
        phoneNumber: '+966501234567',
      });
      expect(screen.queryByText('Verify your email')).toBeNull();
      expect(screen.getByText('+966 •••• 4567')).toBeVisible();
      expect(screen.getByTestId('otp-countdown')).toHaveTextContent('05:00');
    });

  it('keeps WhatsApp as the only method during a provider outage', async () => {
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: false });
    open('/login');
    await screen.findByText(
      'WhatsApp verification is temporarily unavailable. Please try again later.',
    );
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'I have an email account' })).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(mock.history.post).toHaveLength(0);
  });

  it.each(['seeker', 'provider', 'admin'] as const)(
    'uses email and password only for %s under email policy',
    async (app) => {
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: true });
      mock
        .onPost('/v1/auth/login')
        .reply(202, { ...challenge, channel: 'email', maskedDestination: 'a•••@example.test' });
      open('/login', app);
      await screen.findByTestId('auth-channel-email');
      expect(screen.getByTestId(`auth-hero-${app}`)).toBeVisible();
      expect(document.querySelector('input[type="tel"]')).toBeNull();
      expect(screen.queryByRole('button', { name: /WhatsApp account/i })).toBeNull();
      setInput('input[type="email"]', 'a@example.test');
      setInput('input[type="password"]', 'Long-test-password-17');
      fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
      await screen.findByText('Verify your email');
      expect(JSON.parse(mock.history.post.find((r) => r.url === '/v1/auth/login')!.data)).toEqual({
        email: 'a@example.test',
        password: 'Long-test-password-17',
      });
    },
  );

  it.each(['seeker', 'provider', 'admin'] as const)(
    'registers in the %s experience without requiring email or accepting a role from the UI',
    async (app) => {
      mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
      mock.onPost('/v1/auth/register').reply(202, challenge);
      open('/signup', app);
      await screen.findByTestId('auth-channel-whatsapp');
      setInput('input[type="text"]', 'Noura Ahmad');
      setInput('input[type="tel"]', '+963912345678');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
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

  it('returns a WhatsApp password-recovery visit to phone-only sign-in', async () => {
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    open('/forgot-password', 'provider');
    await screen.findByTestId('auth-channel-whatsapp');
    expect(screen.getByTestId('auth-hero-provider')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send verification code' })).toBeEnabled(),
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(mock.history.post).toHaveLength(0);
  });

  it('refreshes a changed policy after a rejected new login request', async () => {
    mock
      .onGet('/v1/auth/config')
      .replyOnce(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: true });
    mock.onPost('/v1/auth/login').reply(409, { error: { code: 'AUTH_CHANNEL_CHANGED' } });
    open('/login');
    await screen.findByTestId('auth-channel-whatsapp');
    setInput('input[type="tel"]', '+966501234567');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send verification code' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    await screen.findByTestId('auth-channel-email');
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(
      screen.getByText(
        'The selected sign-in method has changed. Continue with the method now shown.',
      ),
    ).toBeVisible();
    expect(mock.history.post).toHaveLength(1);
  });

  it('keeps an issued WhatsApp challenge and partial code during an admin policy change', async () => {
    const client = createAuthQueryClient();
    mock
      .onGet('/v1/auth/config')
      .replyOnce(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
    mock.onGet('/v1/auth/config').replyOnce(503, {});
    mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'email', whatsappAvailable: true });
    mock.onPost('/v1/auth/login').reply(202, challenge);
    mock.onPost('/v1/auth/verify-otp').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    open('/login', 'admin', client);
    await screen.findByTestId('auth-channel-whatsapp');
    setInput('input[type="tel"]', '+966501234567');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send verification code' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    const codeInput = await screen.findByTestId('otp-input');
    fireEvent.change(codeInput, { target: { value: '123' } });
    act(() => codeInput.focus());
    await act(async () => {
      await client.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY });
    });
    expect(screen.getByTestId('otp-input')).toBe(codeInput);
    expect(codeInput).toHaveValue('123');
    expect(codeInput).toHaveFocus();
    expect(screen.queryByText(unavailable)).toBeNull();
    await act(async () => {
      await client.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY });
    });
    expect(screen.getByText('Check WhatsApp')).toBeVisible();
    expect(screen.getByTestId('otp-input')).toBe(codeInput);
    expect(codeInput).toHaveValue('123');
    expect(document.querySelector('input[type="email"]')).toBeNull();
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
      ).toHaveLength(1),
    );
    expect(
      JSON.parse(mock.history.post.find((request) => request.url === '/v1/auth/verify-otp')!.data),
    ).toEqual({ challengeId: challenge.challengeId, code: '123456' });
    expect(mock.history.post.filter((request) => request.url === '/v1/auth/login')).toHaveLength(1);
  });
});
