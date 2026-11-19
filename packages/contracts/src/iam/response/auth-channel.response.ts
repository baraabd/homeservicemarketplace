export type AuthOtpChannel = 'email' | 'whatsapp';

/** Safe public policy; provider credentials and account identities are never exposed. */
export interface AuthChannelConfiguration {
  otpChannel: AuthOtpChannel;
  /** Configured and approved by the operator; not a delivery receipt. */
  whatsappAvailable: boolean;
}
