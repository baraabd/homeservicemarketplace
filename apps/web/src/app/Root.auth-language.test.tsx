import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AUTH_EXPERIENCES } from '../lib/auth-experience';
import { Root } from './Root';
import { LoginScreen, type LoginOtpChallenge } from './components/auth/AuthScreens';

// Keep Root, LanguageProvider, AnimatePresence and the real credential/OTP
// components together. Screen-only tests cannot see a shell remount on language
// changes. Authentication callbacks are doubles; these are UI state regressions,
// not evidence that a real backend accepted credentials or issued a session.
vi.mock('../lib/auth-provider', () => ({
  useAuth: () => ({ user: null, logoutState: 'idle', logout: vi.fn() }),
}));
vi.mock('./components/ui/sonner', () => ({ Toaster: () => null }));

let router: ReturnType<typeof createMemoryRouter> | undefined;

beforeEach(() => {
  localStorage.setItem('hsm.lang', 'en');
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  router?.dispose();
  router = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderLogin(experience: 'seeker' | 'provider' | 'admin') {
  const challenge: LoginOtpChallenge = {
    challengeId: crypto.randomUUID(),
    codeLength: 6,
    expiresInSeconds: 300,
  };
  const onLogin = vi
    .fn<(email: string, password: string) => Promise<LoginOtpChallenge>>()
    .mockResolvedValue(challenge);
  const onOtpVerify = vi
    .fn<(challengeId: string, code: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const onOtpResend = vi.fn<(challengeId: string) => Promise<void>>().mockResolvedValue(undefined);
  router = createMemoryRouter(
    [
      {
        Component: Root,
        children: [
          {
            path: '/login',
            element: (
              <LoginScreen
                experience={AUTH_EXPERIENCES[experience]}
                onLogin={onLogin}
                onOtpVerify={onOtpVerify}
                onOtpResend={onOtpResend}
                onSignUp={vi.fn()}
                onForgotPassword={vi.fn()}
              />
            ),
          },
        ],
      },
    ],
    { initialEntries: ['/login'] },
  );
  render(<RouterProvider router={router} />);
  return { challenge, onLogin, onOtpVerify, onOtpResend };
}

function enterCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email Address', { exact: true }), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
    target: { value: password },
  });
}

async function toggleLanguage() {
  fireEvent.click(screen.getByTestId('lang-toggle'));
  // Advance the animation clock beyond the existing 200 ms exit transition.
  // Reading Arabic labels immediately can still observe the outgoing form
  // before AnimatePresence removes it; that was the missed regression.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe.each(['seeker', 'provider', 'admin'] as const)(
  'Root preserves the %s login flow when language changes',
  (experience) => {
    it('keeps both entered credentials and submits them once from the Arabic form', async () => {
      const email = 'root-language@example.test';
      const password = crypto.randomUUID();
      const { onLogin, onOtpVerify } = renderLogin(experience);
      enterCredentials(email, password);

      await toggleLanguage();

      expect(document.documentElement).toHaveAttribute('lang', 'ar');
      expect(document.documentElement).toHaveAttribute('dir', 'rtl');
      expect(screen.getByLabelText('البريد الإلكتروني', { exact: true })).toHaveValue(email);
      expect(screen.getByLabelText('كلمة المرور', { exact: true })).toHaveValue(password);
      expect(onLogin).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'دخول', exact: true }));
      });
      expect(onLogin).toHaveBeenCalledExactlyOnceWith(email, password);
      expect(screen.getByTestId('otp-input')).toBeInTheDocument();
      expect(onOtpVerify).not.toHaveBeenCalled();
    });

    it('keeps the OTP challenge and partial code through Arabic and English changes', async () => {
      const { challenge, onLogin, onOtpVerify, onOtpResend } = renderLogin(experience);
      enterCredentials('root-otp@example.test', crypto.randomUUID());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Log In', exact: true }));
      });
      fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123' } });

      await toggleLanguage();

      expect(screen.getByRole('heading', { name: 'تحقق من بريدك الإلكتروني' })).toBeVisible();
      expect(screen.getByTestId('otp-input')).toHaveValue('123');
      expect(screen.queryByLabelText('كلمة المرور', { exact: true })).toBeNull();
      expect(screen.getByRole('button', { name: 'تأكيد', exact: true })).toBeDisabled();

      await toggleLanguage();

      expect(document.documentElement).toHaveAttribute('lang', 'en');
      expect(document.documentElement).toHaveAttribute('dir', 'ltr');
      expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
      expect(screen.getByTestId('otp-input')).toHaveValue('123');
      expect(onLogin).toHaveBeenCalledTimes(1);
      expect(onOtpVerify).not.toHaveBeenCalled();
      expect(onOtpResend).not.toHaveBeenCalled();

      fireEvent.change(screen.getByTestId('otp-input'), { target: { value: '123456' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
      });
      expect(onOtpVerify).toHaveBeenCalledExactlyOnceWith(challenge.challengeId, '123456');
      expect(onLogin).toHaveBeenCalledTimes(1);
    });
  },
);
