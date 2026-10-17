const FORBIDDEN_ORIGIN_CHARACTERS = /[\s*\\;'"<>,]/u;

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
        const origin = url.origin;
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/' ||
          FORBIDDEN_ORIGIN_CHARACTERS.test(raw) ||
          // Decoding percent escapes and Unicode host characters can introduce
          // forbidden separators or wildcards absent from the raw input.
          FORBIDDEN_ORIGIN_CHARACTERS.test(origin)
        ) {
          // Do not echo possibly credential-bearing configuration in boot errors.
          throw new Error('CORS configuration requires exact HTTP(S) origins');
        }
        return origin;
      }),
    ),
  ];
}
