/** The API's AUTH_COOKIE_PREFIX and this public build value must agree. */
export function csrfCookieName(prefix: string | undefined): string {
  const value = prefix ?? 'hsm';
  if (value !== value.trim() || !/^[a-z][a-z0-9_]{0,31}$/.test(value)) {
    throw new Error('VITE_AUTH_COOKIE_PREFIX must be a lowercase cookie identifier');
  }
  return `${value}_csrf`;
}

export function readCsrfCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(';')) {
    const cookie = part.trim();
    const boundary = cookie.indexOf('=');
    if (boundary >= 0 && cookie.slice(0, boundary) === name) {
      return cookie.slice(boundary + 1) || undefined;
    }
  }
  return undefined;
}
