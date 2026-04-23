import type { MeResponse, OtpChallengeResponse } from '@homeservicemarketplace/contracts';
import type { AxiosError } from 'axios';
import { api } from './api';

// ─── Auth API functions ──────────────────────────────────────────────────────
// Every function is a thin typed wrapper around the Axios client.
// Auth state is cookie-managed; we never read tokens from response bodies.
//
// OTP flow (email-otp phase): both register() and login() return an OTP
// challenge envelope instead of a session. The session cookies are only
// issued by verifyOtp(), which is why that's the function the consumer
// must await before treating the user as authenticated.

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

function rewriteLoginErrorMessage(err: unknown): void {
  const error = err as AxiosError<ApiErrorBody> | undefined;
  const code = error?.response?.data?.error?.code;

  const friendlyMessage =
    code === 'AUTH_INVALID_CREDENTIALS'
      ? 'Invalid email or password.'
      : code === 'AUTH_ACCOUNT_UNVERIFIED'
        ? 'Your account is not verified yet. Please check your email for the latest code.'
        : code === 'AUTH_ACCOUNT_LOCKED'
          ? 'Too many failed attempts. Please wait a little and try again.'
          : code === 'AUTH_ACCOUNT_SUSPENDED'
            ? 'This account is suspended. Please contact support.'
            : null;

  if (friendlyMessage && error?.response?.data?.error) {
    error.response.data.error.message = friendlyMessage;
  }
}

export async function register(data: RegisterInput): Promise<OtpChallengeResponse> {
  const { data: body } = await api.post<OtpChallengeResponse>('/v1/auth/register', data);
  return body;
}

export async function login(data: LoginInput): Promise<OtpChallengeResponse> {
  try {
    const { data: body } = await api.post<OtpChallengeResponse>('/v1/auth/login', data);
    return body;
  } catch (err) {
    rewriteLoginErrorMessage(err);
    throw err;
  }
}

export async function verifyOtp(challengeId: string, code: string): Promise<void> {
  await api.post('/v1/auth/verify-otp', { challengeId, code });
}

export async function resendOtp(challengeId: string): Promise<void> {
  await api.post('/v1/auth/resend-otp', { challengeId });
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/v1/auth/me');
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/v1/auth/logout');
}

export async function refresh(): Promise<void> {
  await api.post('/v1/auth/refresh');
}

export async function forgotPassword(email: string): Promise<void> {
  await api.post('/v1/auth/forgot-password', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post('/v1/auth/reset-password', { token, newPassword });
}

export async function verifyEmail(token: string): Promise<void> {
  await api.post('/v1/auth/verify-email', { token });
}

export async function resendVerification(email: string): Promise<void> {
  await api.post('/v1/auth/resend-verification', { email });
}
