// Stable, client-visible error codes for auth flows. Keep minimal on purpose:
// anti-enumeration responses rely on codes being intentionally coarse.
// Every entry here is a code the backend actually emits — parity is verified
// by grepping `code: 'AUTH_…'` in apps/api/src against this union. Adding
// a new emission site means adding the symbol here in the same change.
export const AuthErrorCode = {
  InvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  AccountUnverified: 'AUTH_ACCOUNT_UNVERIFIED',
  AccountLocked: 'AUTH_ACCOUNT_LOCKED',
  AccountSuspended: 'AUTH_ACCOUNT_SUSPENDED',
  RefreshInvalid: 'AUTH_REFRESH_INVALID',
  TokenExpired: 'AUTH_TOKEN_EXPIRED',
  AmbiguousAuth: 'AUTH_AMBIGUOUS_TRANSPORT',
  CsrfFailed: 'AUTH_CSRF_FAILED',
  MfaRequired: 'AUTH_MFA_REQUIRED',
  // OTP challenge outcomes — added when the email-OTP flow was introduced.
  // The frontend narrows on these to show the right recovery copy
  // (wrong code vs. expired vs. locked vs. resend cap).
  OtpInvalid: 'AUTH_OTP_INVALID',
  OtpExpired: 'AUTH_OTP_EXPIRED',
  OtpLocked: 'AUTH_OTP_LOCKED',
  OtpResendExceeded: 'AUTH_OTP_RESEND_EXCEEDED',
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
