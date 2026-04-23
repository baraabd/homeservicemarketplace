import type { AxiosError } from 'axios';

interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface UiAuthErrorLike {
  response: {
    data: {
      error: {
        code?: string;
        message: string;
      };
    };
  };
}

export function mapAuthErrorCodeToMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Invalid email or password.';
    case 'AUTH_ACCOUNT_UNVERIFIED':
      return 'Please verify your email before signing in.';
    case 'AUTH_ACCOUNT_LOCKED':
      return 'Your account is temporarily locked. Please try again later.';
    case 'AUTH_ACCOUNT_SUSPENDED':
      return 'Your account has been suspended. Please contact support.';
    case 'AUTH_OTP_INVALID':
      return 'Incorrect code. Please try again.';
    case 'AUTH_OTP_EXPIRED':
      return 'This code has expired. Please request a new one.';
    case 'AUTH_OTP_LOCKED':
      return 'Too many attempts. Please sign in again to get a new code.';
    case 'AUTH_OTP_RESEND_EXCEEDED':
      return 'Resend limit reached. Please sign in again.';
    default:
      return fallback;
  }
}

export function toUiAuthError(err: unknown, fallback: string): UiAuthErrorLike {
  const code = (err as AxiosError<ApiErrorShape> | undefined)?.response?.data?.error?.code;
  return {
    response: {
      data: {
        error: {
          code,
          message: mapAuthErrorCodeToMessage(code, fallback),
        },
      },
    },
  };
}
