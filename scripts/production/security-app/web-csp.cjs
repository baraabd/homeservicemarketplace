// R26: build-time document policy. No secret may be passed as a browser origin.
// Hosts are exact; deployed CDN/upload hosts must be explicitly supplied.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_ORIGIN_CHARACTERS = /[\s*\\;'"<>,]/u;

function exactOrigin(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} requires an exact HTTP(S) origin`);
  }
  const origin = url.origin;
  if (
    typeof raw !== 'string' ||
    raw.length > 2048 ||
    FORBIDDEN_ORIGIN_CHARACTERS.test(raw) ||
    // URL canonicalization decodes host escapes and folds Unicode characters.
    // A raw %2A or fullwidth asterisk must not become a CSP wildcard here.
    FORBIDDEN_ORIGIN_CHARACTERS.test(origin) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' && !LOOPBACK.has(url.hostname))
  ) {
    throw new Error(
      `${name} requires an exact HTTPS origin (HTTP is limited to loopback fixtures)`,
    );
  }
  return origin;
}

function originList(raw, name) {
  if (!raw) return [];
  if ([...raw].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error(`${name} cannot contain control characters`);
  const parts = raw.split(',').map((value) => value.trim());
  if (parts.length > 20 || parts.some((value) => !value))
    throw new Error(`${name} requires at most 20 explicit origins`);
  return [...new Set(parts.map((value) => exactOrigin(value, name)))];
}

function buildWebCsp(env) {
  const stripeOption = env.VITE_STRIPE_SANDBOX_ENABLED ?? '';
  if (!['', 'false', 'true'].includes(stripeOption))
    throw new Error('VITE_STRIPE_SANDBOX_ENABLED must be true or false');
  const stripeSandbox = stripeOption === 'true';
  const api = exactOrigin(env.VITE_API_URL, 'VITE_API_URL');
  const socket = new URL(api);
  socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:';
  const media = originList(env.VITE_CSP_MEDIA_ORIGINS, 'VITE_CSP_MEDIA_ORIGINS');
  const uploads = originList(env.VITE_CSP_UPLOAD_ORIGINS, 'VITE_CSP_UPLOAD_ORIGINS');
  const directives = {
    'default-src': ["'none'"],
    // Stripe.js must be provider-hosted. Only this explicit sandbox build
    // option admits its documented frame origins; arbitrary hosts remain invalid.
    // https://docs.stripe.com/security/guide#content-security-policy
    'script-src': [
      "'self'",
      ...(stripeSandbox ? ['https://js.stripe.com', 'https://*.js.stripe.com'] : []),
    ],
    'script-src-attr': ["'none'"],
    // Existing React/MUI/Radix inline styles and explicit current font imports.
    // This exception does NOT enable inline scripts, eval or remote scripts.
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': [
      "'self'",
      'data:',
      'blob:',
      api,
      ...media,
      'https://tile.openstreetmap.org',
      'https://a.tile.openstreetmap.org',
      'https://b.tile.openstreetmap.org',
      'https://c.tile.openstreetmap.org',
    ],
    'media-src': ["'self'", 'blob:', api, ...media],
    'connect-src': [
      "'self'",
      api,
      socket.origin,
      ...uploads,
      'https://nominatim.openstreetmap.org',
      ...(stripeSandbox ? ['https://api.stripe.com'] : []),
    ],
    // Restricted PDFs use the existing self-hosted PDF.js worker and canvas,
    // with scripting/eval/XFA/remote auxiliary fetches disabled by that loader.
    'worker-src': ["'self'"],
    'frame-src': stripeSandbox
      ? ["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com']
      : ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`)
    .join('; ');
}

function injectWebCsp(html, policy) {
  if (/http-equiv\s*=\s*["']content-security-policy/iu.test(html))
    throw new Error('Duplicate document CSP');
  // The charset stays first; policy must precede module/preload/style requests.
  const prefix = /(<head\b[^>]*>\s*<meta\s+charset=["']UTF-8["']\s*\/?>)/iu;
  if (!prefix.test(html)) throw new Error('Document must start its head with UTF-8 metadata');
  const escaped = policy
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return html.replace(
    prefix,
    (head) => `${head}\n    <meta http-equiv="Content-Security-Policy" content="${escaped}" />`,
  );
}

module.exports = { buildWebCsp, exactOrigin, injectWebCsp, originList };
