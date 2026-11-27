import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { SignUpPage } from '../../pages/AuthPages';
import { SIGNUP_CONSENT_COPY } from '../../features/legal/signup-consent';

// Real signup page and OTP panel; only HTTP and the clock are controlled.
// These verify the recovery/request contract, not WhatsApp delivery.
const phoneNumber = '+966501234567';
const password = 'original-registration-password';
const challenge = {
  otpRequired: true,
  challengeId: 'initial-registration-challenge',
  codeLength: 6,
  expiresInSeconds: 12,
  channel: 'whatsapp',
  maskedDestination: '+966 ****567',
};
let mock: MockAdapter;
let now: number;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  now = Date.UTC(2026, 0, 1);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mock = new MockAdapter(api);
  mock.onGet('/v1/auth/me').reply(401);
  mock.onPost('/v1/auth/refresh').reply(401);
  mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
  mock.onGet('/v1/legal/documents').reply(200, {
    acceptanceOpen: true,
    documents: Object.values(CURRENT_LEGAL_DOCUMENTS),
  });
});

afterEach(() => {
  cleanup();
  mock.restore();
  vi.restoreAllMocks();
});

describe.each(['en', 'ar'] as const)('WhatsApp signup recovery (%s)', (lang) => {
  const freshLabel = lang === 'ar' ? 'طلب رمز جديد' : 'Request a new code';
  const restartLabel = lang === 'ar' ? 'استكمال التسجيل' : 'Continue registration';
  const passwordLabel = lang === 'ar' ? 'كلمة المرور' : 'Password';

  async function openOtp() {
    localStorage.setItem('hsm.lang', lang);
    mock.onPost('/v1/auth/register').replyOnce(202, challenge);
    render(
      <AuthProvider client={createAuthQueryClient()}>
        <LanguageProvider>
          <MemoryRouter initialEntries={[{ pathname: '/signup', state: { app: 'provider' } }]}>
            <Routes>
              <Route path="/signup" element={<SignUpPage />} />
              <Route path="/login" element={<div data-testid="login-route" />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText(lang === 'ar' ? 'الاسم الكامل' : 'Full Name'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.change(
      screen.getByLabelText(
        lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
      ),
      { target: { value: phoneNumber } },
    );
    const next = screen.getByRole('button', { name: lang === 'ar' ? 'التالي' : 'Next' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: password } });
    const consent = await screen.findByRole('checkbox', {
      name: SIGNUP_CONSENT_COPY[lang].statement,
    });
    await waitFor(() => expect(consent).toBeEnabled());
    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole('button', { name: lang === 'ar' ? 'إنشاء الحساب' : 'Create Account' }),
    );
    await screen.findByTestId('otp-input');
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:12');
  }

  function assertCredentialRecovery() {
    expect(screen.queryByTestId('login-route')).toBeNull();
    expect(screen.queryByTestId('otp-input')).toBeNull();
    expect(screen.getByLabelText(passwordLabel)).toHaveValue('');
    expect(screen.getByLabelText(passwordLabel)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByText(phoneNumber)).toBeVisible();
    expect(screen.getByRole('button', { name: freshLabel })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      lang === 'ar'
        ? 'أدخل كلمة المرور التي اخترتها لهذا الرقم.'
        : 'enter the password you chose for this number.',
    );
    for (const storage of [localStorage, sessionStorage]) {
      const values = Object.keys(storage)
        .map((key) => storage.getItem(key))
        .join(' ');
      expect(values).not.toContain(password);
    }
  }

  it('recovers an expired signup through credentials and verifies only the fresh challenge', async () => {
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    now += 12_000;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByTestId('otp-input')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: freshLabel }));
    assertCredentialRecovery();
    expect(mock.history.post.map((request) => request.url)).toEqual(['/v1/auth/register']);

    mock.onPost('/v1/auth/register').replyOnce(202, {
      ...challenge,
      challengeId: 'recovered-registration-challenge',
      expiresInSeconds: 40,
    });
    fireEvent.change(screen.getByLabelText(passwordLabel), { target: { value: password } });
    const fresh = screen.getByRole('button', { name: freshLabel });
    fireEvent.click(fresh);
    fireEvent.click(fresh);
    await screen.findByTestId('otp-input');
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:40');
    expect(screen.getByTestId('otp-input')).toHaveValue('');
    const requests = mock.history.post.filter((request) => request.url === '/v1/auth/register');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.data)).toMatchObject({ phoneNumber, password });
    expect(mock.history.post.some((request) => request.url === '/v1/auth/login')).toBe(false);
    expect(mock.history.post.some((request) => request.url === '/v1/auth/resend-otp')).toBe(false);

    mock.onPost('/v1/auth/verify-otp').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: lang === 'ar' ? 'تأكيد' : 'Confirm' }));
    await waitFor(() =>
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
      ).toHaveLength(1),
    );
    expect(JSON.parse(mock.history.post.at(-1)!.data)).toEqual({
      challengeId: 'recovered-registration-challenge',
      code: '654321',
    });
  });

  it('can leave a neutral signup challenge without a login or automatic resend request', async () => {
    await openOtp();
    fireEvent.click(screen.getByRole('button', { name: restartLabel }));
    assertCredentialRecovery();
    expect(mock.history.post.map((request) => request.url)).toEqual(['/v1/auth/register']);
  });

  it('uses credential recovery from the header back control and waits for verification to finish', async () => {
    await openOtp();
    let finishVerification: ((response: [number, object]) => void) | undefined;
    mock.onPost('/v1/auth/verify-otp').reply(
      () =>
        new Promise<[number, object]>((resolve) => {
          finishVerification = resolve;
        }),
    );
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: lang === 'ar' ? 'تأكيد' : 'Confirm' }));
    await waitFor(() => expect(finishVerification).toBeTypeOf('function'));
    const back = screen.getByRole('button', { name: lang === 'ar' ? 'رجوع' : 'Back' });
    fireEvent.click(back);
    expect(screen.getByTestId('otp-input')).toBeVisible();
    expect(screen.queryByLabelText(passwordLabel)).toBeNull();

    await act(async () => {
      finishVerification!([400, { error: { code: 'AUTH_OTP_INVALID' } }]);
    });
    fireEvent.click(back);
    assertCredentialRecovery();
    expect(mock.history.post.map((request) => request.url)).toEqual([
      '/v1/auth/register',
      '/v1/auth/verify-otp',
    ]);
  });
});
