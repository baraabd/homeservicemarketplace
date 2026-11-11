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

export type OtpRecoveryAction = 'restart' | 'use-latest-code' | null;

/** A wrong code can be retried, but an invalid resend challenge cannot. The
 * latest code remains usable when only the resend budget has been exhausted. */
export function otpRecoveryAction(err: unknown, kind: 'verify' | 'resend'): OtpRecoveryAction {
  const { code, status } = extractAuthError(err);
  if (status === 429 || (status !== null && status >= 500)) return null;
  if (
    code === 'AUTH_OTP_EXPIRED' ||
    code === 'AUTH_OTP_LOCKED' ||
    (kind === 'resend' && code === 'AUTH_OTP_INVALID')
  )
    return 'restart';
  if (kind === 'resend' && code === 'AUTH_OTP_RESEND_EXCEEDED') return 'use-latest-code';
  return null;
}

const OTP_ERROR_COPY = {
  en: {
    rateLimited: 'Too many requests. Please wait a moment and try again.',
    unavailable: 'The server could not confirm this request. Please try again.',
    locked: 'Too many attempts. Use the recovery option below to start again.',
    expired: 'This verification request has expired. Use the recovery option below to start again.',
    invalidCode: 'Incorrect code. Please try again.',
    invalidChallenge:
      'This verification request is no longer available. Use the recovery option below to continue.',
    resendLimit:
      'Resend limit reached. Enter the most recent code or use the recovery option below.',
    resendFailed: 'Could not resend the code. Please try again.',
  },
  ar: {
    rateLimited: 'طلبات كثيرة. انتظر قليلًا ثم حاول مجددًا.',
    unavailable: 'تعذّر تأكيد الطلب من الخادم. حاول مجددًا.',
    locked: 'بلغت الحد الأقصى للمحاولات. استخدم خيار الاستعادة أدناه للبدء مجددًا.',
    expired: 'انتهت صلاحية طلب التحقق. استخدم خيار الاستعادة أدناه للبدء مجددًا.',
    invalidCode: 'الرمز غير صحيح. تحقق منه وحاول مجددًا.',
    invalidChallenge: 'لم يعد طلب التحقق هذا متاحًا. استخدم خيار الاستعادة أدناه للمتابعة.',
    resendLimit: 'تم بلوغ حد إعادة طلب الرمز. أدخل أحدث رمز وصلك، أو استخدم خيار الاستعادة أدناه.',
    resendFailed: 'تعذّرت إعادة طلب الرمز. حاول مجددًا.',
  },
} as const;

// Only stable error codes determine copy. A refusal does not reveal whether
// an address exists; the existing recovery routes retain that same boundary.
export function otpErrorMessage(
  err: unknown,
  kind: 'verify' | 'resend',
  lang: 'en' | 'ar' = 'en',
): string {
  const { code, status } = extractAuthError(err);
  const copy = OTP_ERROR_COPY[lang];
  if (status === 429) return copy.rateLimited;
  if ((status === null && code === null) || (status !== null && status >= 500))
    return copy.unavailable;
  if (code === 'AUTH_OTP_LOCKED') return copy.locked;
  if (code === 'AUTH_OTP_EXPIRED') return copy.expired;
  if (kind === 'verify') {
    return code === 'RATE_LIMITED' ? copy.rateLimited : copy.invalidCode;
  }
  // kind === 'resend'
  switch (code) {
    case 'AUTH_OTP_INVALID':
      return copy.invalidChallenge;
    case 'AUTH_OTP_RESEND_EXCEEDED':
      return copy.resendLimit;
    case 'RATE_LIMITED':
      return copy.rateLimited;
    default:
      return copy.resendFailed;
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

// Registration never renders raw driver/provider messages or exposes existence.
export function registrationErrorMessage(err: unknown): string {
  const { code, status } = extractAuthError(err);
  if (code === 'VALIDATION_ERROR' || status === 400)
    return 'Please check your account details and try again.';
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  return 'Registration could not be confirmed. Please try again.';
}

export function recoveryRequestErrorMessage(err: unknown): string {
  const { status } = extractAuthError(err);
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  return 'Could not request a reset link. Please try again.';
}
