// A return target is untrusted router state, not an authorization fact.
// Keep this final boundary shared by GuestOnly and the post-OTP resolver.
const LOCAL_ORIGIN = 'https://hsm.invalid';
const AUTH_ENTRY_PATHS = new Set([
  '/login', '/signup', '/forgot-password', '/check-email',
  '/verify-email', '/reset-password',
]);
function hasUnsafeCharacters(value: string): boolean {
  return Array.from(value).some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function sanitizeAuthReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (hasUnsafeCharacters(raw)) return null;
  try {
    const url = new URL(raw, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return null;
    // Decode only the pathname, not query values such as an encoded address.
    // A router may decode a path segment; neither spelling may change origin
    // or normalize to another login entry and create an authenticated loop.
    const decodedPath = decodeURIComponent(url.pathname);
    if (hasUnsafeCharacters(decodedPath) || decodedPath.startsWith('//')) return null;
    const decoded = new URL(decodedPath, LOCAL_ORIGIN);
    if (decoded.origin !== LOCAL_ORIGIN) return null;
    const pathname = decoded.pathname.replace(/\/+$/u, '') || '/';
    if (AUTH_ENTRY_PATHS.has(pathname)) return null;
    return raw;
  } catch {
    return null;
  }
}
