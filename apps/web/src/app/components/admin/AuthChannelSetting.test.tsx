import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthChannelSetting } from './AuthChannelSetting';
import { LanguageProvider } from '../../i18n/LanguageContext';

const state = vi.hoisted(() => ({
  available: true,
  verified: true,
  emailVerified: true,
  query: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('../../../lib/auth-provider', () => ({
  useAuth: () => ({
    user: {
      phoneNumber: '+966500000001',
      phoneVerifiedAt: state.verified ? '2026-11-18T00:00:00Z' : null,
      email: state.emailVerified ? 'admin@example.test' : null,
      emailVerifiedAt: state.emailVerified ? '2026-11-18T00:00:00Z' : null,
    },
  }),
}));
vi.mock('../../../lib/auth-channel', () => ({
  getAuthConfiguration: () => {
    state.query();
    return Promise.resolve({ otpChannel: 'email', whatsappAvailable: state.available });
  },
}));
vi.mock('../../../lib/admin/admin-auth-channel-api', () => ({
  requestAdminContactVerification: state.request,
  verifyAdminContact: state.verify,
}));

function show(lang = 'en', value = 'email') {
  const change = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const ui = () => (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <AuthChannelSetting
          value={value}
          savedValue="email"
          onChange={change}
          disabled={false}
          lang={lang}
        />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { change, invalidate, refresh: () => view.rerender(ui()) };
}
beforeEach(() => {
  state.available = true;
  state.verified = true;
  state.emailVerified = true;
  state.query.mockClear();
  state.request.mockReset();
  state.verify.mockReset();
  state.request.mockResolvedValue({
    otpRequired: true,
    challengeId: 'enroll-code',
    channel: 'email',
    codeLength: 6,
    expiresInSeconds: 300,
    maskedDestination: 'a•••@example.test',
  });
  state.verify.mockResolvedValue(undefined);
});
describe('Authentication channel settings', () => {
  it('changes the draft only and explains the unsaved selection', async () => {
    const { change } = show();
    const radio = await screen.findByRole('radio', { name: /WhatsApp/ });
    await screen.findByText(/Your verified number/);
    fireEvent.click(radio);
    expect(change).toHaveBeenCalledWith('whatsapp');
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeChecked();
  });
  it('keeps WhatsApp unavailable without a configured provider', async () => {
    state.available = false;
    const { change } = show();
    await screen.findByText(/first configure WhatsApp Business/);
    const radio = screen.getByRole('radio', { name: /WhatsApp/ });
    expect(radio).toBeDisabled();
    fireEvent.click(radio);
    expect(change).not.toHaveBeenCalled();
  });
  it('requires verified ownership and exposes enrollment without granting a switch', async () => {
    state.verified = false;
    show();
    await screen.findByText('Verify your WhatsApp number first');
    expect(screen.getByRole('radio', { name: /WhatsApp/ })).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });
  it('labels Arabic controls and explains a draft change', async () => {
    show('ar', 'whatsapp');
    await screen.findByText(/رقم حسابك موثق/);
    expect(screen.getByRole('radio', { name: /واتساب/ })).toBeChecked();
    expect(screen.getByText(/اختيارك لم يُحفظ بعد/)).toBeInTheDocument();
  });
  it('lets a phone-only administrator verify email and then select email during a WhatsApp outage', async () => {
    state.emailVerified = false;
    state.available = false;
    const { change, invalidate, refresh } = show('en', 'whatsapp');
    await screen.findByText('Verify an email address first');
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Current-password-27' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code to email' }));
    await screen.findByLabelText('Verification code sent to email');
    expect(state.request).toHaveBeenCalledExactlyOnceWith(
      'email',
      'admin@example.test',
      'Current-password-27',
    );
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Verification code sent to email'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() =>
      expect(state.verify).toHaveBeenCalledExactlyOnceWith('email', 'enroll-code', '123456'),
    );
    await screen.findByText('Email address verified.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] });
    // Only the freshly read account proof enables the setting; POST success alone does not.
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeDisabled();
    state.emailVerified = true;
    refresh();
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: /^Email/ }));
    expect(change).toHaveBeenCalledWith('email');
  });
  it('uses the same enrollment workflow for WhatsApp and retains a failed code for correction', async () => {
    state.verified = false;
    state.request.mockResolvedValue({
      otpRequired: true,
      challengeId: 'phone-code',
      channel: 'whatsapp',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    state.verify.mockRejectedValue({
      response: { status: 400, data: { error: { code: 'AUTH_OTP_INVALID' } } },
    });
    show();
    await screen.findByText('Verify your WhatsApp number first');
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '+966500000002' },
    });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Current-password-27' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code to WhatsApp' }));
    await screen.findByLabelText('Verification code sent to WhatsApp');
    expect(state.request).toHaveBeenCalledExactlyOnceWith(
      'whatsapp',
      '+966500000002',
      'Current-password-27',
    );
    fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
    await screen.findByText(/Verification failed/);
    expect(screen.getByLabelText('Verification code sent to WhatsApp')).toHaveValue('000000');
    expect(screen.getByRole('radio', { name: /WhatsApp/ })).toBeDisabled();
  });
});
