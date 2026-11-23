import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LoginScreen } from './AuthScreens';
import type { AuthConfigurationState } from './AuthChannelNotice';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('new login policy guard', () => {
  it.each(['pending', 'error'] as const)(
    'blocks keyboard submission while %s even if a caller supplies email credentials',
    async (status) => {
      const onLogin = vi.fn().mockResolvedValue({
        challengeId: 'confirmed-email-challenge',
        codeLength: 6,
        expiresInSeconds: 300,
        channel: 'email',
      });
      const onOtpVerify = vi.fn();
      const onOtpResend = vi.fn();
      const screenFor = (configuration: AuthConfigurationState) => (
        <MemoryRouter>
          <LanguageProvider>
            <LoginScreen
              configuration={configuration}
              channel="email"
              whatsappAvailable
              onLogin={onLogin}
              onOtpVerify={onOtpVerify}
              onOtpResend={onOtpResend}
              onSignUp={vi.fn()}
              onForgotPassword={vi.fn()}
            />
          </LanguageProvider>
        </MemoryRouter>
      );
      const view = render(screenFor({ status, retry: vi.fn() }));
      const email = screen.getByLabelText('Email Address');
      const password = screen.getByLabelText('Password');
      fireEvent.change(email, { target: { value: 'draft@example.test' } });
      fireEvent.change(password, { target: { value: 'Long-test-password-17' } });
      expect(screen.getByRole('button', { name: 'Log In' })).toBeDisabled();
      // The password field invokes the handler directly on Enter. The guard
      // must hold independently of the primary button's disabled attribute.
      fireEvent.keyDown(password, { key: 'Enter' });
      expect(onLogin).not.toHaveBeenCalled();

      view.rerender(screenFor({ status: 'ready' }));
      expect(screen.getByLabelText('Email Address')).toBe(email);
      expect(screen.getByLabelText('Password')).toBe(password);
      expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled();
      fireEvent.keyDown(password, { key: 'Enter' });
      await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
      expect(onLogin).toHaveBeenCalledWith('draft@example.test', 'Long-test-password-17', 'email');
    },
  );
});
