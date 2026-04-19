import type { MeResponse } from '@homeservicemarketplace/contracts';
import { api } from './api';

// ─── Auth API functions ──────────────────────────────────────────────────────
// Every function is a thin typed wrapper around the Axios client.
// Auth state is cookie-managed; we never read tokens from response bodies.

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

export async function register(data: RegisterInput): Promise<void> {
  await api.post('/v1/auth/register', data);
}

export async function login(data: LoginInput): Promise<void> {
  await api.post('/v1/auth/login', data);
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
