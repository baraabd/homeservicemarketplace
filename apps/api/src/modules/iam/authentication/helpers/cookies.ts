import type { Response } from 'express';

import { AppConfigService } from '../../../../config/app-config.service';

export const ACCESS_COOKIE = 'hsm_at';
export const REFRESH_COOKIE = 'hsm_rt';
export const CSRF_COOKIE = 'hsm_csrf';
// Must match the actual routed URL after URI versioning. The controller is
// declared `@Controller({ path: 'auth', version: '1' })` and main.ts enables
// URI versioning with default '1', so the live endpoint is /v1/auth/refresh.
// A cookie with Path=/auth/refresh would NOT be sent by the browser on
// /v1/auth/refresh (Path must be a prefix), silently breaking web refresh.
export const REFRESH_PATH = '/v1/auth/refresh';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number; // milliseconds
  domain?: string;
}

export function accessCookieOptions(config: AppConfigService, ttlSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('COOKIE_SECURE'),
    sameSite: config.get('COOKIE_SAMESITE'),
    path: '/',
    maxAge: ttlSeconds * 1000,
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
}

export function refreshCookieOptions(config: AppConfigService, expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('COOKIE_SECURE'),
    // Refresh cookie is always Strict regardless of access-cookie sameSite —
    // it is scoped to /auth/refresh and must not ride along on cross-site
    // navigations.
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
}

export function csrfCookieOptions(config: AppConfigService, ttlSeconds: number): CookieOptions {
  return {
    // Readable by app JS so it can be echoed as X-CSRF-Token.
    httpOnly: false,
    secure: config.get('COOKIE_SECURE'),
    sameSite: 'strict',
    path: '/',
    maxAge: ttlSeconds * 1000,
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
}

export function clearAuthCookies(res: Response, config: AppConfigService): void {
  const base = {
    path: '/',
    httpOnly: true,
    secure: config.get('COOKIE_SECURE'),
    sameSite: config.get('COOKIE_SAMESITE'),
    ...(config.get('COOKIE_DOMAIN') ? { domain: config.get('COOKIE_DOMAIN') } : {}),
  };
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH, sameSite: 'strict' });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, sameSite: 'strict' });
}
