import type {
  AuthOtpChannel,
  MeResponse,
  OtpChallengeResponse,
} from '@homeservicemarketplace/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';

const CONTACT_PATHS = { email: '/v1/auth/email', whatsapp: '/v1/auth/phone' } as const;

export async function requestContactVerification(
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

export async function verifyContact(
  channel: AuthOtpChannel,
  challengeId: string,
  code: string,
): Promise<void> {
  await api.post(`${CONTACT_PATHS[channel]}/verify`, { challengeId, code });
}

/** Confirm fresh ownership before presenting a newly linked sign-in method as ready. */
export async function refreshVerifiedContact(
  client: QueryClient,
  accountId: string,
  channel: AuthOtpChannel,
): Promise<void> {
  await client.invalidateQueries({ queryKey: ['auth', 'me'], exact: true }, { throwOnError: true });
  const account = client.getQueryData<MeResponse | null>(['auth', 'me']);
  const verified =
    channel === 'whatsapp'
      ? account?.phoneNumber && account.phoneVerifiedAt
      : account?.email && account.emailVerifiedAt;
  if (!account || account.id !== accountId || !verified) {
    throw new Error('Verified account contact could not be confirmed');
  }
}
