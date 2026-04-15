// Stable, client-visible error codes for auth flows. Keep minimal on purpose:
// anti-enumeration responses rely on codes being intentionally coarse.
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
} as const;
export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
