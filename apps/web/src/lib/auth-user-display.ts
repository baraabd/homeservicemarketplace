import type { MeResponse } from '@homeservicemarketplace/contracts';

type AuthUserLike = Pick<MeResponse, 'email' | 'firstName' | 'lastName'> | null | undefined;

const FALLBACK_DISPLAY_NAME = {
  ar: 'أحمد الخالد',
  en: 'Ahmed Al-Khalid',
} as const;

const FALLBACK_EMAIL = 'ahmed@fixnow.app';
const FALLBACK_INITIALS = 'AK';

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function authDisplayName(user: AuthUserLike, lang: 'ar' | 'en'): string {
  const parts = [clean(user?.firstName), clean(user?.lastName)].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return lang === 'ar' ? FALLBACK_DISPLAY_NAME.ar : FALLBACK_DISPLAY_NAME.en;
}

export function authDisplayEmail(user: AuthUserLike): string {
  return clean(user?.email) || FALLBACK_EMAIL;
}

export function authDisplayInitials(user: AuthUserLike): string {
  const first = clean(user?.firstName).charAt(0);
  const last = clean(user?.lastName).charAt(0);
  const joined = `${first}${last}`.toUpperCase();
  if (joined) return joined;

  const emailBase = clean(user?.email)
    .split('@')[0]
    ?.replace(/[^a-zA-Z0-9]/g, '') ?? '';
  const fromEmail = emailBase.slice(0, 2).toUpperCase();
  return fromEmail || FALLBACK_INITIALS;
}
