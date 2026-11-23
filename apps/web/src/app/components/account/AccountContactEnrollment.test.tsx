import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestContactVerification, verifyContact } from '../../../lib/auth-contact-api';
import { AccountContactEnrollment } from './AccountContactEnrollment';

vi.mock('../../../lib/auth-contact-api', () => ({
  requestContactVerification: vi.fn(),
  verifyContact: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(requestContactVerification).mockReset().mockResolvedValue({
    otpRequired: true,
    challengeId: 'account-contact-proof',
    channel: 'email',
    codeLength: 6,
    expiresInSeconds: 300,
  });
  vi.mocked(verifyContact).mockReset().mockResolvedValue(undefined);
});

async function requestCode() {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'customer@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'Current-password-27' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send code to email' }));
  return screen.findByLabelText('Verification code sent to email');
}

async function requestAndSubmitCode() {
  const code = await requestCode();
  fireEvent.change(code, { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  return code;
}

describe('shared account contact enrollment', () => {
  it('keeps the challenge busy until the caller has refreshed the verified account', async () => {
    let finishRefresh!: () => void;
    const onVerified = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    render(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        onVerified={onVerified}
      />,
    );
    expect(screen.getByText(/Protect access to your account/)).toBeInTheDocument();
    const code = await requestAndSubmitCode();
    await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
    expect(verifyContact).toHaveBeenCalledExactlyOnceWith(
      'email',
      'account-contact-proof',
      '012345',
    );
    expect(code).toHaveValue('012345');
    expect(code).toBeDisabled();
    expect(screen.queryByText('Email address verified.')).not.toBeInTheDocument();
    await act(async () => finishRefresh());
    expect(await screen.findByText('Email address verified.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code sent to email')).not.toBeInTheDocument();
  });

  it('retries only the account refresh when the OTP has already been accepted', async () => {
    let finishRefresh!: () => void;
    const onVerified = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRefresh = resolve;
          }),
      );
    const view = render(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        onVerified={onVerified}
      />,
    );
    const code = await requestAndSubmitCode();
    expect(await screen.findByText(/The code was accepted/)).toBeInTheDocument();
    view.rerender(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        canRequest={false}
        onVerified={onVerified}
      />,
    );
    expect(code).toHaveValue('012345');
    expect(code).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh verification' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(2));
    expect(verifyContact).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Refreshing verification…' })).toBeDisabled();
    expect(screen.queryByText('Email address verified.')).not.toBeInTheDocument();
    await act(async () => finishRefresh());
    expect(await screen.findByText('Email address verified.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Verification code sent to email')).not.toBeInTheDocument();
  });

  it('keeps an unverified challenge editable after the server rejects its code', async () => {
    vi.mocked(verifyContact).mockRejectedValueOnce(new Error('invalid code'));
    const onVerified = vi.fn();
    render(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        onVerified={onVerified}
      />,
    );
    const code = await requestAndSubmitCode();
    expect(await screen.findByText(/Verification failed/)).toBeInTheDocument();
    expect(code).toHaveValue('012345');
    expect(code).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('requires a fresh code after changing a contact whose account refresh failed', async () => {
    const onVerified = vi.fn().mockRejectedValueOnce(new Error('refresh unavailable'));
    render(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        onVerified={onVerified}
      />,
    );
    await requestAndSubmitCode();
    expect(await screen.findByText(/The code was accepted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change contact or request a new code' }));
    await requestAndSubmitCode();
    await waitFor(() => expect(verifyContact).toHaveBeenCalledTimes(2));
    expect(requestContactVerification).toHaveBeenCalledTimes(2);
  });

  it.each(['email', 'whatsapp'] as const)(
    'preserves the %s and password draft when new requests become unavailable',
    async (channel) => {
      const onVerified = vi.fn();
      const ui = (canRequest: boolean) => (
        <AccountContactEnrollment
          channel={channel}
          lang="en"
          disabled={false}
          canRequest={canRequest}
          onVerified={onVerified}
        />
      );
      const view = render(ui(true));
      const label = channel === 'email' ? 'Email address' : 'WhatsApp phone number';
      const contact = channel === 'email' ? 'customer@example.test' : '+966500000002';
      fireEvent.change(screen.getByLabelText(label), { target: { value: contact } });
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'Current-password-27' },
      });
      view.rerender(ui(false));
      expect(screen.getByLabelText(label)).toHaveValue(contact);
      expect(screen.getByLabelText(label)).toBeDisabled();
      expect(screen.getByLabelText('Current password')).toHaveValue('Current-password-27');
      expect(screen.getByLabelText('Current password')).toBeDisabled();
      const send = screen.getByRole('button', { name: /^Send code to/ });
      expect(send).toBeDisabled();
      fireEvent.submit(send.closest('form')!);
      expect(requestContactVerification).not.toHaveBeenCalled();
      view.rerender(ui(true));
      expect(screen.getByLabelText(label)).toHaveValue(contact);
      expect(send).toBeEnabled();
      fireEvent.click(send);
      await waitFor(() =>
        expect(requestContactVerification).toHaveBeenCalledExactlyOnceWith(
          channel,
          contact,
          'Current-password-27',
        ),
      );
    },
  );

  it('allows verification of an issued challenge while new requests are unavailable', async () => {
    const onVerified = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        onVerified={onVerified}
      />,
    );
    const code = await requestCode();
    view.rerender(
      <AccountContactEnrollment
        channel="email"
        lang="en"
        disabled={false}
        canRequest={false}
        onVerified={onVerified}
      />,
    );
    expect(code).toBeEnabled();
    fireEvent.change(code, { target: { value: '012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByText('Email address verified.')).toBeInTheDocument();
    expect(verifyContact).toHaveBeenCalledExactlyOnceWith(
      'email',
      'account-contact-proof',
      '012345',
    );
    expect(onVerified).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Send code to email' })).toBeDisabled();
  });
});
