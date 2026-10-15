// HTML escaping for mail bodies. Every value interpolated into HTML passes
// through `escapeHtml`; every URL is built from configuration plus a fixed path
// and then escaped as an attribute. There is no "trusted HTML" input.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]!);
}

/** Plain-text bodies cannot execute anything, but a CR/LF or other control
 *  character inside a value could forge structure a reader trusts (a fake
 *  "From:" line, a second link). Values are single-line by contract. */
// C0 controls, DEL and the Unicode line/paragraph separators (U+2028/2029),
// built from code points so no invisible separator sits in the source.
const CONTROL_CHARS = new RegExp(
  `[${[0x00, 0x2d, 0x1f, 0x7f, 0x2028, 0x2029].map((c) => String.fromCharCode(c)).join('')}]`,
  'g',
);

export function singleLine(value: string): string {
  return value.replace(CONTROL_CHARS, ' ');
}

/** Absolute application URL for a fixed path. Returns null when no valid
 *  http(s) origin is configured, so a template falls back to a link-free body
 *  instead of emitting a relative or attacker-shaped URL. */
export function appUrl(
  frontendUrl: string | null,
  path: string,
  query?: Record<string, string>,
): string | null {
  if (!frontendUrl) return null;
  let base: URL;
  try {
    base = new URL(frontendUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  const url = new URL(base.origin);
  // Keep any deployment base path (e.g. https://host/app).
  url.pathname = `${base.pathname.replace(/\/+$/, '')}${path}`;
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}
