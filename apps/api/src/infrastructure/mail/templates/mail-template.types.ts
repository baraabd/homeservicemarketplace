// Template ids are DATABASE VALUES (EmailDelivery.template): add new ids, do
// not rename or repurpose old ones, or queued rows lose their renderer.
//
// Variables are deliberately minimal. No template takes a name, a free-text
// reason, a reviewer note, a document number or an amount: mail is copied,
// forwarded and retained outside our control, so anything sensitive stays
// behind the authenticated view the message links to.
export interface MailTemplateVars {
  'auth.registration_otp': { code: string; minutes: number };
  'auth.login_otp': { code: string; minutes: number };
  'auth.email_verification': { token: string };
  'auth.password_reset': { token: string };
  'provider.verification_action_required': Record<string, never>;
  'provider.verification_outcome': { outcome: 'approved' | 'rejected' | 'expired' };
  'account.payment_status': { status: 'succeeded' | 'failed' | 'action_required' };
}

export type MailTemplateId = keyof MailTemplateVars;

export type MailCategory = 'AUTH' | 'NOTIFICATION';
