import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LoginPage } from '../../pages/AuthPages';

// Real page, provider, API wrapper and lazy OTP panel; HTTP and wall-clock time
// are controlled. These prove UI/request contracts, not delivery by WhatsApp.
let mock: MockAdapter;
let now: number;
const phoneNumber = '+966501234567';
const challenge = {
  otpRequired: true,
  challengeId: 'opaque-passwordless-challenge',
  codeLength: 6,
  expiresInSeconds: 12,
  channel: 'whatsapp',
  maskedDestination: '+966 •••• 4567',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  now = Date.UTC(2026, 0, 1);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mock = new MockAdapter(api);
  mock.onGet('/v1/auth/me').reply(401);
  mock.onPost('/v1/auth/refresh').reply(401);
  mock.onGet('/v1/auth/config').reply(200, { otpChannel: 'whatsapp', whatsappAvailable: true });
});

afterEach(() => {
  cleanup();
  mock.restore();
  vi.restoreAllMocks();
});

function elapse(seconds: number) {
  now += seconds * 1000;
  // Simulate returning from a background tab. A throttled interval must not
  // extend validity or require one tick for every second spent in background.
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe.each(['en', 'ar'] as const)('WhatsApp login OTP lifecycle (%s)', (lang) => {
  const requestLabel = lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code';
  const freshLabel = lang === 'ar' ? 'طلب رمز جديد' : 'Request a new code';
  const resendLabel = lang === 'ar' ? 'إعادة طلب الرمز' : 'Resend code';
  const confirmLabel = lang === 'ar' ? 'تأكيد' : 'Confirm';

  async function openOtp() {
    localStorage.setItem('hsm.lang', lang);
    mock.onPost('/v1/auth/login').replyOnce(202, challenge);
    render(
      <AuthProvider client={createAuthQueryClient()}>
        <LanguageProvider>
          <MemoryRouter initialEntries={[{ pathname: '/login', state: { app: 'provider' } }]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    const phone = await screen.findByLabelText(
      lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
    );
    fireEvent.change(phone, { target: { value: phoneNumber } });
    fireEvent.click(screen.getByRole('button', { name: requestLabel }));
    await screen.findByTestId('otp-input');
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:12');
  }

  it('expires using server TTL and starts a new phone-only login only when requested', async () => {
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
    elapse(5);
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:07');
    expect(screen.getByTestId('otp-input')).toHaveValue('123456');
    elapse(7);
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:00');
    expect(screen.getByTestId('otp-input')).toHaveValue('');
    expect(screen.getByTestId('otp-input')).toBeDisabled();
    expect(screen.queryByRole('button', { name: confirmLabel })).toBeNull();
    expect(screen.queryByRole('button', { name: resendLabel })).toBeNull();
    fireEvent.keyDown(screen.getByTestId('otp-input'), { key: 'Enter' });
    expect(mock.history.post.map((request) => request.url)).toEqual(['/v1/auth/login']);

    let finish!: (response: [number, unknown]) => void;
    mock.onPost('/v1/auth/login').reply(
      () =>
        new Promise<[number, unknown]>((resolve) => {
          finish = resolve;
        }),
    );
    const fresh = screen.getByRole('button', { name: freshLabel });
    fireEvent.click(fresh);
    fireEvent.click(fresh);
    await waitFor(() =>
      expect(mock.history.post.filter((request) => request.url === '/v1/auth/login')).toHaveLength(
        2,
      ),
    );
    expect(fresh).toBeDisabled();
    expect(screen.getByTestId('otp-input')).toBeDisabled();
    expect(JSON.parse(mock.history.post.at(-1)!.data)).toEqual({ phoneNumber });

    await act(async () => {
      finish([202, { ...challenge, challengeId: 'fresh-opaque-challenge', expiresInSeconds: 40 }]);
    });
    await waitFor(() => expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:40'));
    expect(screen.getByTestId('otp-input')).toBeEnabled();
    expect(screen.getByTestId('otp-input')).toHaveValue('');
    expect(
      mock.history.post.filter((request) => request.url === '/v1/auth/resend-otp'),
    ).toHaveLength(0);
    mock.onPost('/v1/auth/verify-otp').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }));
    await waitFor(() =>
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
      ).toHaveLength(1),
    );
    expect(JSON.parse(mock.history.post.at(-1)!.data)).toEqual({
      challengeId: 'fresh-opaque-challenge',
      code: '654321',
    });
  });

  it('resets expiry only after a confirmed resend, uses neutral copy and caps live requests', async () => {
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
    elapse(3);
    mock
      .onPost('/v1/auth/resend-otp')
      .replyOnce(503, { error: { code: 'UNAVAILABLE', message: 'private-detail' } });
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private-detail');
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:09');
    expect(screen.getByTestId('otp-input')).toHaveValue('123456');

    mock.onPost('/v1/auth/resend-otp').reply(202, { success: true, expiresInSeconds: 45 });
    for (let request = 0; request < 3; request += 1) {
      fireEvent.click(screen.getByRole('button', { name: resendLabel }));
      await waitFor(() =>
        expect(mock.history.post.filter((item) => item.url === '/v1/auth/resend-otp')).toHaveLength(
          request + 2,
        ),
      );
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          lang === 'ar' ? 'تم استلام الطلب' : 'Request received',
        ),
      );
      expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:45');
    }
    expect(screen.getByTestId('otp-input')).toHaveValue('');
    const resend = screen.getByRole('button', { name: resendLabel });
    expect(resend).toBeDisabled();
    fireEvent.click(resend);
    expect(
      mock.history.post.filter((request) => request.url === '/v1/auth/resend-otp'),
    ).toHaveLength(4);
    expect(screen.getByTestId('otp-input')).toBeEnabled();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '654321' } });
    expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
    expect(
      mock.history.post.filter((request) => request.url === '/v1/auth/verify-otp'),
    ).toHaveLength(0);
    elapse(45);
    expect(screen.getByRole('button', { name: freshLabel })).toBeEnabled();
    expect(screen.getByRole('status')).not.toHaveTextContent(
      lang === 'ar' ? 'تم استلام الطلب' : 'Request received',
    );
  });

  it('keeps the previous deadline and code when a resend response has no valid TTL', async () => {
    await openOtp();
    fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123' } });
    elapse(4);
    mock.onPost('/v1/auth/resend-otp').reply(202, { success: true });
    fireEvent.click(screen.getByRole('button', { name: resendLabel }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('otp-countdown')).toHaveTextContent('00:08');
    expect(screen.getByTestId('otp-input')).toHaveValue('123');
    expect(screen.getByRole('button', { name: resendLabel })).toBeEnabled();
    expect(mock.history.post.filter((request) => request.url === '/v1/auth/login')).toHaveLength(1);
  });
});
