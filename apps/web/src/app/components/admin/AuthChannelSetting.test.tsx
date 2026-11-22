import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthChannelSetting } from './AuthChannelSetting';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';

const state = vi.hoisted(() => ({
  available: true,
  verified: true,
  emailVerified: true,
  configFails: false,
  query: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('../../../lib/auth-provider', () => ({
  useAuth: () => ({
    user: {
      id: 'admin-account',
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
    if (state.configFails) return Promise.reject(new Error('Readiness unavailable'));
    return Promise.resolve({ otpChannel: 'email', whatsappAvailable: state.available });
  },
}));
vi.mock('../../../lib/auth-contact-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/auth-contact-api')>()),
  requestContactVerification: state.request,
  verifyContact: state.verify,
}));

function show(lang = 'en', value = 'email') {
  const change = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // AuthProvider owns this query in the app; keep its proof distinct from the mocked view.
  qc.setQueryData(['auth', 'me'], {
    id: 'admin-account',
    email: 'admin@example.test',
    emailVerifiedAt: '2026-11-18T00:00:00Z',
    phoneNumber: '+966500000002',
    phoneVerifiedAt: '2026-11-18T00:00:00Z',
  });
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
  return { change, invalidate, qc, refresh: () => view.rerender(ui()) };
}
beforeEach(() => {
  state.available = true;
  state.verified = true;
  state.emailVerified = true;
  state.configFails = false;
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
  it('explains the WhatsApp default while retaining an explicitly saved email selection', async () => {
    const { change } = show();
    await screen.findByText(/Your verified number/);
    expect(screen.getByText('Platform default')).toBeVisible();
    expect(screen.getByText(/WhatsApp is the initial choice/)).toHaveTextContent(
      'users see only the saved method',
    );
    expect(screen.getByText(/The saved channel is the only sign-in method/)).toHaveTextContent(
      'verified contact for the selected channel',
    );
    expect(screen.getByText(/Phone → WhatsApp code → Sign in/)).toBeVisible();
    expect(screen.queryByText(/Phone → Password/)).toBeNull();
    expect(screen.getByRole('radio', { name: /^Email/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /WhatsApp/ })).not.toBeChecked();
    expect(change).not.toHaveBeenCalled();
  });
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
    await waitFor(() => expect(screen.getByLabelText('Email address')).toBeEnabled());
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
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: ['auth', 'me'], exact: true },
      { throwOnError: true },
    );
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

  it('retains the WhatsApp draft across readiness loss and completes an issued code after a config failure', async () => {
    state.verified = false;
    state.request.mockResolvedValue({
      otpRequired: true,
      challengeId: 'phone-code',
      channel: 'whatsapp',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    const { qc } = show();
    const phone = await screen.findByLabelText('WhatsApp phone number');
    fireEvent.change(phone, { target: { value: '+966500000002' } });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Current-password-27' },
    });
    state.available = false;
    await act(() => qc.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY }));
    expect(await screen.findByText(/first configure WhatsApp Business/)).toBeInTheDocument();
    expect(phone).toHaveValue('+966500000002');
    expect(phone).toBeDisabled();
    expect(screen.getByLabelText('Current password')).toHaveValue('Current-password-27');
    expect(screen.getByRole('button', { name: 'Send code to WhatsApp' })).toBeDisabled();
    expect(state.request).not.toHaveBeenCalled();

    state.available = true;
    await act(() => qc.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send code to WhatsApp' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send code to WhatsApp' }));
    const code = await screen.findByLabelText('Verification code sent to WhatsApp');
    fireEvent.change(code, { target: { value: '123456' } });
    state.configFails = true;
    await act(() => qc.refetchQueries({ queryKey: AUTH_CONFIG_QUERY_KEY }));
    expect(await screen.findByText('Could not load sign-in settings.')).toBeInTheDocument();
    expect(code).toHaveValue('123456');
    expect(code).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Verify number' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
    expect(await screen.findByText('WhatsApp number verified.')).toBeInTheDocument();
    expect(state.verify).toHaveBeenCalledExactlyOnceWith('whatsapp', 'phone-code', '123456');
    expect(screen.getByRole('button', { name: 'Send code to WhatsApp' })).toBeDisabled();
  });

  it.each([
    ['email', '٠١٢٣٤٥', true],
    ['whatsapp', '۰۱۲۳۴۵', false],
  ] as const)(
    'normalizes Arabic/Persian %s enrollment codes before verification',
    async (channel, digits, typed) => {
      state.verified = channel === 'email';
      state.emailVerified = channel === 'whatsapp';
      state.request.mockResolvedValue({
        otpRequired: true,
        challengeId: 'localized-code',
        channel,
        codeLength: 6,
        expiresInSeconds: 300,
      });
      show();
      const identity = await screen.findByLabelText(
        channel === 'email' ? 'Email address' : 'WhatsApp phone number',
      );
      await waitFor(() => expect(identity).toBeEnabled());
      fireEvent.change(identity, {
        target: { value: channel === 'email' ? 'admin@example.test' : '+966500000002' },
      });
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'Current-password-27' },
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: channel === 'email' ? 'Send code to email' : 'Send code to WhatsApp',
        }),
      );
      const input = (await screen.findByLabelText(
        channel === 'email'
          ? 'Verification code sent to email'
          : 'Verification code sent to WhatsApp',
      )) as HTMLInputElement;
      if (typed) {
        for (const digit of digits)
          fireEvent.change(input, { target: { value: input.value + digit } });
      } else {
        fireEvent.change(input, { target: { value: digits } });
      }
      expect(input).toHaveValue('012345');
      fireEvent.click(
        screen.getByRole('button', {
          name: channel === 'email' ? 'Verify email' : 'Verify number',
        }),
      );
      await waitFor(() =>
        expect(state.verify).toHaveBeenCalledExactlyOnceWith(channel, 'localized-code', '012345'),
      );
    },
  );
});
