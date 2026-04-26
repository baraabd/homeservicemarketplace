import { useAuth } from './auth-provider';

// ─────────────────────────────────────────────────────────────────────────────
// useAuthIdentity
//
// Single source of truth for "what do we show in the header / user chip".
// Reads the authenticated user from the existing auth-provider (no duplicate
// query, no localStorage) and derives:
//   - displayName: "First Last" (falls back to first alone, then email
//     local-part — never a hardcoded placeholder)
//   - initials: up to two uppercase letters derived the same way
//
// While auth is still loading OR there is no authenticated user, both
// displayName and initials are `null` so consumers can render a neutral
// skeleton instead of a fake logged-in identity block.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthIdentity {
  displayName: string | null;
  initials: string | null;
  email: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuthIdentity(): AuthIdentity {
  const { user, isLoading, isAuthenticated } = useAuth();
  if (!user) {
    return { displayName: null, initials: null, email: null, isLoading, isAuthenticated };
  }
  return {
    displayName: deriveDisplayName(user),
    initials: deriveInitials(user),
    email: user.email,
    isLoading,
    isAuthenticated,
  };
}

// Exported for tests and for any surface that has a user object on hand
// without going through the hook (e.g. tests asserting the exact output).
export function deriveDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  const local = (user.email ?? '').split('@')[0]?.trim();
  return local && local.length > 0 ? local : '';
}

export function deriveInitials(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  if (first && last) return (first[0]! + last[0]!).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last) return last.slice(0, 2).toUpperCase();
  const local = (user.email ?? '').split('@')[0]?.trim() ?? '';
  return local.slice(0, 2).toUpperCase();
}
