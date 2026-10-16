/** Configured credentials-bearing origins must be exact HTTP(S) origins. */
export function configuredCorsOrigins(
  frontend: string | undefined,
  extras: readonly string[],
): string[] {
  return [
    ...new Set(
      [...(frontend ? [frontend] : []), ...extras].map((raw) => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new Error('CORS configuration requires exact HTTP(S) origins');
        }
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/' ||
          /[\s*\\]/u.test(raw)
        ) {
          // Do not echo possibly credential-bearing configuration in boot errors.
          throw new Error('CORS configuration requires exact HTTP(S) origins');
        }
        return url.origin;
      }),
    ),
  ];
}
