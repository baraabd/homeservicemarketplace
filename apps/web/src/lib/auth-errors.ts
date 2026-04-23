import type { AxiosError } from 'axios';

// Centralized mapping from backend auth error codes to user-facing copy.
//
// The frontend MUST NOT display `response.data.error.message` verbatim on
// auth flows. Before the exception filter was hardened, NestJS auto-derived
// UnauthorizedException's message from its class name ("Unauthorized
// Exception") whenever the IAM layer threw with only a `{ code }` payload;
// that raw string was leaking to the login form. Even with the filter fixed,
// treating backend `message` as display copy couples the UI to server
// wording and risks re-introducing leaks on the next code that forgets an
// explicit message. The stable, contract-level surface is the error CODE;
// UI copy lives here.

interface AuthErrorResponseShape {
  response?: {
    status?: number;
    data?: {
      error?: {
        code?: string;
        message?: string;
      };
    };
  };
}

export interface ExtractedAuthError {
  code: string | null;
  status: number | null;
}

export function extractAuthError(err: unknown): ExtractedAuthError {
  const shaped = err as AxiosError | AuthErrorResponseShape | undefined;
  const response = (shaped as AuthErrorResponseShape | undefined)?.response;
  const status = typeof response?.status === 'number' ? response.status : null;
  const code = typeof response?.data?.error?.code === 'string' ? response.data.error.code : null;
  return { code, status };
}

// Login-screen copy. Narrow set — we only show the cases the login form can
// meaningfully surface. Unknown codes collapse to a generic, non-alarming
// fallback; never fall through to the backend's raw message.
export function loginErrorMessage(err: unknown): string {
  const { code, status } = extractAuthError(err);
  switch (code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Incorrect email or password.';
    case 'AUTH_ACCOUNT_LOCKED':
      return 'Account temporarily locked due to too many failed attempts. Try again later or reset your password.';
    case 'AUTH_ACCOUNT_SUSPENDED':
      return 'This account has been suspended. Contact support.';
    case 'AUTH_ACCOUNT_UNVERIFIED':
      return 'Please verify your email before signing in.';
    case 'VALIDATION_ERROR':
      return 'Please check your email and password and try again.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      break;
  }
  if (status === 401 || status === 403) return 'Incorrect email or password.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status && status >= 500) return "We couldn't reach the server. Please try again.";
  return "Couldn't sign in. Please try again.";
}

// OTP-panel copy. Covers verify-otp + resend-otp outcomes. Unknown codes
// collapse to a generic "try again".
export function otpErrorMessage(err: unknown, kind: 'verify' | 'resend'): string {
  const { code } = extractAuthError(err);
  if (kind === 'verify') {
    switch (code) {
      case 'AUTH_OTP_LOCKED':
        return 'Too many attempts. Please sign in again to get a new code.';
      case 'AUTH_OTP_EXPIRED':
        return 'This code has expired. Please request a new one.';
      case 'AUTH_OTP_INVALID':
        return 'Incorrect code. Please try again.';
      default:
        return 'Incorrect code. Please try again.';
    }
  }
  // kind === 'resend'
  switch (code) {
    case 'AUTH_OTP_RESEND_EXCEEDED':
      return 'Resend limit reached. Please sign in again.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment and try again.';
    default:
      return 'Could not resend the code. Please try again.';
  }
}

// Reset-password copy (new-password submit). The backend collapses every
// "bad link" reason into a 400 AUTH_INVALID_CREDENTIALS (anti-probe), so we
// only differentiate "bad link / expired" from "other failure".
export function resetPasswordErrorMessage(err: unknown): string {
  const { status, code } = extractAuthError(err);
  if (status === 400 || code === 'AUTH_INVALID_CREDENTIALS') {
    return 'This reset link is invalid or expired. Request a new one.';
  }
  return 'Something went wrong. Please try again.';
}
