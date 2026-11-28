import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { MeResponse } from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { SettingsPage } from './SettingsPage';

// Resolve the actual lazy settings module outside the UI assertion window.
await import('./AccountSignInSettings');

const EMAIL_USER: MeResponse = {
  id: 'ordinary-account',
  email: 'layla@example.test',
  phoneNumber: null,
  firstName: 'Layla',
  lastName: 'Mansour',
  status: 'ACTIVE',
  emailVerifiedAt: '2026-11-18T00:00:00.000Z',
  phoneVerifiedAt: null,
  mfaEnabled: false,
  roles: ['customer'],
};
const PHONE = '+963944123456';
let mock: MockAdapter;
let account: MeResponse;
let available: boolean;
const clients: ReturnType<typeof createAuthQueryClient>[] = [];

function show(client = createAuthQueryClient()) {
  clients.push(client);
  const view = render(
    <AuthProvider client={client}>
      <LanguageProvider>
        <MemoryRouter>
          <SettingsPage onBack={() => {}} />
        </MemoryRouter>
      </LanguageProvider>
    </AuthProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  mock = new MockAdapter(api);
  account = { ...EMAIL_USER };
  available = true;
  mock.onGet('/v1/auth/me').reply(() => [200, account]);
  mock
    .onGet('/v1/auth/config')
    .reply(() => [200, { otpChannel: 'whatsapp', whatsappAvailable: available }]);
  mock.onPost('/v1/auth/phone/challenge').reply(202, {
    otpRequired: true,
    challengeId: 'phone-link-challenge',
    channel: 'whatsapp',
    maskedDestination: '+963 •••• 3456',
    codeLength: 6,
    expiresInSeconds: 300,
  });
  mock.onPost('/v1/auth/email/challenge').reply(202, {
    otpRequired: true,
    challengeId: 'email-link-challenge',
    channel: 'email',
    maskedDestination: 'l•••@example.test',
    codeLength: 6,
    expiresInSeconds: 300,
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  mock.restore();
});

async function requestPhone() {
  fireEvent.change(await screen.findByLabelText('WhatsApp phone number'), {
    target: { value: PHONE },
  });
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'Current-password-27' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send code to WhatsApp' }));
  await screen.findByLabelText('Verification code sent to WhatsApp');
}

describe('ordinary account sign-in settings', () => {
  it('waits for fresh readiness before showing enrollment from a warm available-channel cache', async () => {
    let release: (value: [number, unknown]) => void = () => {};
    mock.onGet('/v1/auth/config').reply(
      () =>
        new Promise<[number, unknown]>((resolve) => {
          release = resolve;
        }),
    );
    const client = createAuthQueryClient();
    client.setQueryData(AUTH_CONFIG_QUERY_KEY, { otpChannel: 'whatsapp', whatsappAvailable: true });
    show(client);
    await screen.findByRole('heading', { name: 'Sign-in methods' });
    expect(screen.getByText('Checking available channels…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
    await act(async () => release([200, { otpChannel: 'email', whatsappAvailable: false }]));
    expect(await screen.findByRole('button', { name: 'Send code to WhatsApp' })).toBeDisabled();
  });

  it.each(['customer', 'provider'] as const)(
    'links WhatsApp for an existing %s email account and preserves proof after reload',
    async (role) => {
      account = { ...EMAIL_USER, roles: [role] };
      mock.onPost('/v1/auth/phone/verify').reply(() => {
        account = { ...account, phoneNumber: PHONE, phoneVerifiedAt: '2026-11-18T01:00:00.000Z' };
        return [200, { success: true }];
      });
      const view = show();
      await requestPhone();
      expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
        phoneNumber: PHONE,
        password: 'Current-password-27',
      });
      expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
        target: { value: '٠١٢٣٤٥' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
      expect(await screen.findByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
      expect(screen.getByTestId('account-verified-email')).toHaveTextContent(EMAIL_USER.email!);
      expect(JSON.parse(mock.history.post[1]!.data)).toEqual({
        challengeId: 'phone-link-challenge',
        code: '012345',
      });
      expect(mock.history.get.filter((request) => request.url === '/v1/auth/me')).toHaveLength(2);
      expect(mock.history.patch).toHaveLength(0);
      expect(mock.history.post.every((request) => request.url?.startsWith('/v1/auth/phone/'))).toBe(
        true,
      );
      view.unmount();
      view.client.clear();
      show();
      expect(await screen.findByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
      expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    },
  );

  it.each(['customer', 'provider'] as const)(
    'lets a phone-only %s link email while WhatsApp is unavailable',
    async (role) => {
      account = {
        ...EMAIL_USER,
        roles: [role],
        email: null,
        emailVerifiedAt: null,
        phoneNumber: PHONE,
        phoneVerifiedAt: '2026-11-18T00:00:00.000Z',
      };
      available = false;
      mock.onPost('/v1/auth/email/verify').reply(() => {
        account = {
          ...account,
          email: 'layla@example.test',
          emailVerifiedAt: '2026-11-18T01:00:00.000Z',
        };
        return [200, { success: true }];
      });
      show();
      fireEvent.change(await screen.findByLabelText('Email address'), {
        target: { value: 'layla@example.test' },
      });
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'Current-password-27' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send code to email' }));
      fireEvent.change(await screen.findByLabelText('Verification code sent to email'), {
        target: { value: '123456' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
      expect(await screen.findByTestId('account-verified-email')).toHaveTextContent(
        'layla@example.test',
      );
      expect(screen.getByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
      expect(mock.history.patch).toHaveLength(0);
    },
  );

  it('preserves the issued challenge and current identity after an invalid OTP', async () => {
    mock.onPost('/v1/auth/phone/verify').reply(400, { error: { code: 'AUTH_OTP_INVALID' } });
    show();
    await requestPhone();
    fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
    await screen.findByText(/Verification failed/);
    expect(screen.getByLabelText('Verification code sent to WhatsApp')).toHaveValue('123456');
    expect(screen.getByLabelText('Verification code sent to WhatsApp')).toBeEnabled();
    expect(screen.queryByTestId('account-verified-whatsapp')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-verified-email')).toHaveTextContent(EMAIL_USER.email!);
    expect(account.phoneNumber).toBeNull();
    expect(mock.history.patch).toHaveLength(0);
  });

  it('waits for fresh server ownership proof after the verification response', async () => {
    let release: (value: [number, MeResponse]) => void = () => {};
    let waiting = false;
    mock.onPost('/v1/auth/phone/verify').reply(() => {
      mock.onGet('/v1/auth/me').reply(
        () =>
          new Promise<[number, MeResponse]>((resolve) => {
            waiting = true;
            release = resolve;
          }),
      );
      return [200, { success: true }];
    });
    show();
    await requestPhone();
    fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
    await waitFor(() => expect(waiting).toBe(true));
    expect(screen.queryByTestId('account-verified-whatsapp')).not.toBeInTheDocument();
    await act(async () =>
      release([
        200,
        { ...account, phoneNumber: PHONE, phoneVerifiedAt: '2026-11-18T01:00:00.000Z' },
      ]),
    );
    expect(await screen.findByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
  });

  it('keeps confirmed-code refresh retry available when auth/me becomes degraded', async () => {
    mock.onPost('/v1/auth/phone/verify').reply(() => {
      mock.onGet('/v1/auth/me').reply(503, {});
      return [200, { success: true }];
    });
    show();
    await requestPhone();
    fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
    const retry = await screen.findByRole('button', { name: 'Refresh verification' });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(screen.getByText(/Your account could not be refreshed/)).toBeInTheDocument();
    expect(screen.queryByTestId('account-verified-whatsapp')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Verification code sent to WhatsApp')).toBeDisabled();
    account = { ...account, phoneNumber: PHONE, phoneVerifiedAt: '2026-11-18T01:00:00.000Z' };
    mock.onGet('/v1/auth/me').reply(() => [200, account]);
    fireEvent.click(retry);
    expect(await screen.findByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
    expect(
      mock.history.post.filter((request) => request.url === '/v1/auth/phone/verify'),
    ).toHaveLength(1);
  });

  it.each(['failed refresh', 'provider unavailable'])(
    'keeps an issued OTP usable after configuration changes: %s',
    async (change) => {
      const { client } = show();
      await requestPhone();
      fireEvent.change(screen.getByLabelText('Verification code sent to WhatsApp'), {
        target: { value: '123456' },
      });
      if (change === 'failed refresh') mock.onGet('/v1/auth/config').reply(503, {});
      else available = false;
      await act(async () => {
        await client.invalidateQueries({ queryKey: AUTH_CONFIG_QUERY_KEY });
      });
      expect(screen.getByLabelText('Verification code sent to WhatsApp')).toHaveValue('123456');
      expect(screen.getByRole('button', { name: 'Verify number' })).toBeEnabled();
      mock.onPost('/v1/auth/phone/verify').reply(() => {
        account = { ...account, phoneNumber: PHONE, phoneVerifiedAt: '2026-11-18T01:00:00.000Z' };
        return [200, { success: true }];
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify number' }));
      expect(await screen.findByTestId('account-verified-whatsapp')).toHaveTextContent(PHONE);
      expect(
        mock.history.post.filter((request) => request.url === '/v1/auth/phone/challenge'),
      ).toHaveLength(1);
    },
  );

  it('blocks unavailable WhatsApp linking while displaying the existing email and separate profile explanation', async () => {
    available = false;
    show();
    await screen.findByText(/WhatsApp linking is temporarily unavailable/);
    expect(screen.getByRole('button', { name: 'Send code to WhatsApp' })).toBeDisabled();
    expect(
      within(screen.getByTestId('account-verified-email')).getByText(EMAIL_USER.email!),
    ).toBeInTheDocument();
    expect(screen.getByText(/profile contact number is separate/)).toBeInTheDocument();
    expect(mock.history.get.some((request) => request.url === '/v1/me/profile')).toBe(false);
    expect(mock.history.post).toHaveLength(0);
  });
});
