import type { AuthOtpChannel, OtpChallengeResponse } from '@homeservicemarketplace/contracts';
import { api } from '../api';

const CONTACT_PATHS = { email: '/v1/auth/email', whatsapp: '/v1/auth/phone' } as const;

export async function requestAdminContactVerification(
  channel: AuthOtpChannel,
  contact: string,
  password: string,
) {
  const { data } = await api.post<OtpChallengeResponse>(`${CONTACT_PATHS[channel]}/challenge`, {
    ...(channel === 'email' ? { email: contact } : { phoneNumber: contact }),
    password,
  });
  return data;
}

export async function verifyAdminContact(
  channel: AuthOtpChannel,
  challengeId: string,
  code: string,
): Promise<void> {
  await api.post(`${CONTACT_PATHS[channel]}/verify`, { challengeId, code });
}
