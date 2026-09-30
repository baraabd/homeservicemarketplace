import type { MeResponse, OtpChallengeResponse } from '@homeservicemarketplace/contracts';
import { api } from './api';
import { authRequestScope, recordSessionEnded, recordVerifiedLogin } from './auth-session-boundary';
import { withAuthCookieLock } from './auth-cookie-lock';

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

export async function register(data: RegisterInput): Promise<OtpChallengeResponse> {
  const { data: body } = await api.post<OtpChallengeResponse>('/v1/auth/register', data);
  return body;
}

export async function login(data: LoginInput): Promise<OtpChallengeResponse> {
  const { data: body } = await api.post<OtpChallengeResponse>('/v1/auth/login', data);
  return body;
}

export async function verifyOtp(challengeId: string, code: string): Promise<void> {
  await withAuthCookieLock(authRequestScope(), async () => {
    await api.post('/v1/auth/verify-otp', { challengeId, code }, { timeout: 15_000 });
    // Publish before releasing the lock: a peer's queued old request must be
    // cancelled rather than issued with this new account's cookies.
    recordVerifiedLogin();
  });
}

export async function resendOtp(challengeId: string): Promise<void> {
  await api.post('/v1/auth/resend-otp', { challengeId });
}

export async function getMe(signal?: AbortSignal): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/v1/auth/me', { signal });
  return data;
}

export async function logout(): Promise<void> {
  await withAuthCookieLock(authRequestScope(), () => api.post('/v1/auth/logout', undefined, { timeout: 10_000 }).then(() => undefined));
}

export async function refresh(): Promise<void> {
  await withAuthCookieLock(authRequestScope(), () => api.post('/v1/auth/refresh', undefined, { timeout: 15_000 }).then(() => undefined));
}

export async function forgotPassword(email: string): Promise<void> {
  await api.post('/v1/auth/forgot-password', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await withAuthCookieLock(authRequestScope(), async () => {
    await api.post('/v1/auth/reset-password', { token, newPassword }, { timeout: 15_000 });
    recordSessionEnded();
    window.dispatchEvent(new Event('auth:credentials-reset'));
  });
}

export async function verifyEmail(token: string): Promise<void> {
  await api.post('/v1/auth/verify-email', { token });
}

export async function resendVerification(email: string): Promise<void> {
  await api.post('/v1/auth/resend-verification', { email });
}
