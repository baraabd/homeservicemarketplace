import type { MeResponse } from '@homeservicemarketplace/contracts';

export interface AuthUserDisplay {
  fullName: string;
  email: string;
  initials: string;
}

export function buildAuthUserDisplay(
  user: MeResponse | null | undefined,
  fallback: AuthUserDisplay,
): AuthUserDisplay {
  const fullName =
    [user?.firstName?.trim(), user?.lastName?.trim()].filter(Boolean).join(' ') || fallback.fullName;
  const initials =
    [user?.firstName?.trim()?.[0], user?.lastName?.trim()?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase() || fallback.initials;

  return {
    fullName,
    email: user?.email ?? fallback.email,
    initials,
  };
}
