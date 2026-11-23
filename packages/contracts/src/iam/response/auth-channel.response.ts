export type AuthOtpChannel = 'email' | 'whatsapp';

/** Applied only when the operator has not saved an explicit channel preference. */
export const DEFAULT_AUTH_OTP_CHANNEL: AuthOtpChannel = 'whatsapp';

/** Safe public policy; provider credentials and account identities are never exposed. */
export interface AuthChannelConfiguration {
  otpChannel: AuthOtpChannel;
  /** Configured and approved by the operator; not a delivery receipt. */
  whatsappAvailable: boolean;
}
