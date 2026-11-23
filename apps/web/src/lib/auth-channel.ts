import type { AuthChannelConfiguration, AuthOtpChannel } from '@homeservicemarketplace/contracts';
import { api } from './api';
import { AUTH_CONFIG_PATH } from './auth-policy-query';

export type OtpChannel = AuthOtpChannel;
export type AuthConfiguration = AuthChannelConfiguration;

export async function getAuthConfiguration(): Promise<AuthConfiguration> {
  const { data } = await api.get<AuthConfiguration>(AUTH_CONFIG_PATH, { timeout: 10_000 });
  if (
    !data ||
    !['email', 'whatsapp'].includes(data.otpChannel) ||
    typeof data.whatsappAvailable !== 'boolean'
  ) {
    throw new Error('Authentication configuration is unavailable');
  }
  return data;
}
