import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { MeResponse } from '@homeservicemarketplace/contracts';
import { api } from './api';
import {
  refreshVerifiedContact,
  requestContactVerification,
  verifyContact,
} from './auth-contact-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});

const VERIFIED_ACCOUNT: MeResponse = {
  id: 'same-account',
  email: 'account@example.test',
  emailVerifiedAt: '2026-11-18T00:00:00Z',
  phoneNumber: '+966500000002',
  phoneVerifiedAt: '2026-11-18T00:00:00Z',
  firstName: 'Account',
  lastName: 'Owner',
  status: 'ACTIVE',
  mfaEnabled: false,
  roles: ['customer'],
};

function observeAccount(queryFn: () => Promise<MeResponse | null>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth', 'me'], VERIFIED_ACCOUNT);
  const observer = new QueryObserver(client, {
    queryKey: ['auth', 'me'],
    staleTime: Infinity,
    queryFn,
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    client,
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
}

describe('refreshed account contact proof', () => {
  it.each(['email', 'whatsapp'] as const)('awaits fresh %s ownership', async (channel) => {
    const read = vi.fn().mockResolvedValue(VERIFIED_ACCOUNT);
    const { client, close } = observeAccount(read);
    try {
      expect(read).not.toHaveBeenCalled();
      await refreshVerifiedContact(client, 'same-account', channel);
      expect(read).toHaveBeenCalledOnce();
    } finally {
      close();
    }
  });

  it.each([
    ['no account', null, 'email'],
    ['another account', { ...VERIFIED_ACCOUNT, id: 'different-account' }, 'email'],
    ['missing email', { ...VERIFIED_ACCOUNT, email: null }, 'email'],
    ['unverified email', { ...VERIFIED_ACCOUNT, emailVerifiedAt: null }, 'email'],
    ['missing phone', { ...VERIFIED_ACCOUNT, phoneNumber: null }, 'whatsapp'],
    ['unverified phone', { ...VERIFIED_ACCOUNT, phoneVerifiedAt: null }, 'whatsapp'],
  ] as const)('rejects %s after refresh', async (_label, account, channel) => {
    const { client, close } = observeAccount(async () => account);
    try {
      await expect(refreshVerifiedContact(client, 'same-account', channel)).rejects.toThrow(
        'Verified account contact could not be confirmed',
      );
    } finally {
      close();
    }
  });

  it('rejects a failed refresh even when previously verified proof remains cached', async () => {
    const failure = new Error('account refresh failed');
    const { client, close } = observeAccount(async () => {
      throw failure;
    });
    try {
      await expect(refreshVerifiedContact(client, 'same-account', 'whatsapp')).rejects.toBe(
        failure,
      );
      expect(client.getQueryData(['auth', 'me'])).toEqual(VERIFIED_ACCOUNT);
    } finally {
      close();
    }
  });
});
afterEach(() => mock.restore());

describe('authenticated account contact ownership API', () => {
  for (const channel of ['email', 'whatsapp'] as const)
    it(`sends ${channel} ownership through its protected endpoint`, async () => {
      const path = channel === 'email' ? '/v1/auth/email' : '/v1/auth/phone';
      const contact = channel === 'email' ? 'account@example.test' : '+966500000001';
      const challenge = {
        otpRequired: true,
        challengeId: 'contact-proof',
        channel,
        expiresInSeconds: 300,
        codeLength: 6,
      };
      mock.onPost(`${path}/challenge`).reply(202, challenge);
      mock.onPost(`${path}/verify`).reply(200, { success: true });
      expect(await requestContactVerification(channel, contact, 'Current-password-27')).toEqual(
        challenge,
      );
      await verifyContact(channel, 'contact-proof', '123456');
      expect(JSON.parse(mock.history.post[0]!.data)).toEqual({
        [channel === 'email' ? 'email' : 'phoneNumber']: contact,
        password: 'Current-password-27',
      });
      expect(JSON.parse(mock.history.post[1]!.data)).toEqual({
        challengeId: 'contact-proof',
        code: '123456',
      });
    });
});
