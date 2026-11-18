import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import { requestAdminContactVerification, verifyAdminContact } from './admin-auth-channel-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('administrator contact ownership API', () => {
  for (const channel of ['email', 'whatsapp'] as const)
    it(`sends ${channel} ownership through its protected endpoint`, async () => {
      const path = channel === 'email' ? '/v1/auth/email' : '/v1/auth/phone';
      const contact = channel === 'email' ? 'admin@example.test' : '+966500000001';
      const challenge = {
        otpRequired: true,
        challengeId: 'contact-proof',
        channel,
        expiresInSeconds: 300,
        codeLength: 6,
      };
      mock.onPost(`${path}/challenge`).reply(202, challenge);
      mock.onPost(`${path}/verify`).reply(200, { success: true });
      expect(
        await requestAdminContactVerification(channel, contact, 'Current-password-27'),
      ).toEqual(challenge);
      await verifyAdminContact(channel, 'contact-proof', '123456');
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
