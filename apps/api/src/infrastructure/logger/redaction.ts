// R23 — the privacy boundary for everything the API writes to logs or spans.
//
// Two layers, because neither is sufficient alone:
//
//  1. An ALLOWLIST for request and response shapes (see `serializeRequest`).
//     pino-http's default serializer copies every header and the full URL, so
//     anything a client sends — a cookie, a reset token in a query string, a
//     proxy credential — reached the log unless someone had thought to deny
//     it. Now only fields named here are written.
//
//  2. A SCRUBBER for free text and structured log arguments (see
//     `scrubLogArgument`). Error messages from drivers and SDKs are the usual
//     leak: a connection string with its password, a presigned URL with its
//     signature, a JWT echoed by a validation error. Key-based redaction runs
//     first; pattern-based redaction catches what arrives inside strings.
//
// What is deliberately NOT done: hashing identifiers and calling the result
// anonymous. An email hash is still a stable identifier that can be joined
// and brute-forced from a candidate list. Values are removed, not transformed.

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY = 50;
const MAX_STRING = 2_048;

// Compared after lower-casing and stripping non-alphanumerics, so `api_key`,
// `apiKey` and `API-KEY` are one entry.
const SENSITIVE_KEYS = new Set([
  'password',
  'pass',
  'passwd',
  'pwd',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'resettoken',
  'verificationtoken',
  'rawtoken',
  'csrftoken',
  'xcsrftoken',
  'xrefreshtoken',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'xapikey',
  'apikey',
  'privatekey',
  'otp',
  'otpcode',
  'mfacode',
  'pin',
  'jwt',
  'signature',
  'xamzsignature',
  'xamzsecuritytoken',
  'xamzcredential',
  'sessionid',
  'databaseurl',
  'connectionstring',
  'dsn',
  'smtppass',
  'smtppassword',
  'iban',
  'cardnumber',
  'pan',
  'cvv',
  'cvc',
]);

// Personal data that is never needed to debug the platform. Dropped entirely
// rather than masked, because a mask still confirms that a value existed.
const PERSONAL_KEYS = new Set([
  'email',
  'newemail',
  'firstname',
  'lastname',
  'fullname',
  'phone',
  'phonenumber',
  'dateofbirth',
  'dob',
  'nationalid',
  'idnumber',
  'documentnumber',
  'address',
  'street',
  'streetaddress',
]);

// Content that must never be copied into telemetry as a debugging shortcut:
// request/response bodies, uploaded bytes, identity images, receipts, message
// bodies.
const CONTENT_KEYS = new Set([
  'body',
  'rawbody',
  'payload',
  'requestbody',
  'responsebody',
  'data',
  'buffer',
  'bytes',
  'content',
  'filecontent',
  'image',
  'imagedata',
  'documentimage',
  'selfie',
  'receipt',
  'receiptbody',
  'receiptcontent',
  'messagebody',
  'html',
  'text',
]);

const COORDINATE_KEYS = new Set(['lat', 'lng', 'lon', 'latitude', 'longitude']);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

export type KeyClass = 'secret' | 'personal' | 'content' | 'coordinate' | 'plain';

export function classifyKey(key: string): KeyClass {
  const k = normalizeKey(key);
  if (SENSITIVE_KEYS.has(k)) return 'secret';
  if (PERSONAL_KEYS.has(k)) return 'personal';
  if (CONTENT_KEYS.has(k)) return 'content';
  if (COORDINATE_KEYS.has(k)) return 'coordinate';
  return 'plain';
}

// ── free text ──────────────────────────────────────────────────────────────

const TEXT_RULES: ReadonlyArray<[RegExp, string | ((...m: string[]) => string)]> = [
  // PEM blocks (private keys, certificates with keys).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, REDACTED],
  // JWT / JWS compact form.
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/gu, REDACTED],
  // HTTP auth schemes.
  [/\b(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{4,}/giu, (_m, scheme) => `${scheme} ${REDACTED}`],
  // Credentials embedded in a URL: scheme://user:password@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu, (_m, scheme) => `${scheme}${REDACTED}@`],
  // key=value / key: value pairs whose key is sensitive. Covers query strings,
  // form bodies, connection-string options and "token: abc" in messages.
  [
    /(^|[?&;,\s{("'])((?:x-amz-)?(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|reset_token|api[_-]?key|apikey|otp|signature|credential|security-token|session(?:_?id)?|authorization|cookie))(["']?\s*[=:]\s*["']?)([^&\s"',;})]+)/giu,
    (_m, lead, key, sep) => `${lead}${key}${sep}${REDACTED}`,
  ],
  // Email addresses.
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/gu, '[REDACTED:email]'],
  // Precise coordinate pairs ("33.51384, 36.27654"): kept to two decimals
  // (~1 km), enough to tell which city an incident concerns, not which house.
  [
    /(-?\d{1,3}\.\d{2})\d{2,}(\s*,\s*)(-?\d{1,3}\.\d{2})\d{2,}/gu,
    (_m, lat, sep, lng) => `${lat}${sep}${lng}`,
  ],
];

export function scrubText(input: string): string {
  let out = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[truncated]` : input;
  for (const [pattern, replacement] of TEXT_RULES) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}

export function coarsenCoordinate(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value)) {
    return String(Math.round(Number(value) * 100) / 100);
  }
  return REDACTED;
}

// ── structured values ──────────────────────────────────────────────────────

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

interface ScrubOptions {
  includeStack: boolean;
}

const ERROR_CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u;

// pino's error serializer treats any object with a string `message` as
// error-like and derives `type` from its constructor's name, which reads
// "Object" for plain data. A hidden constructor named after the original class
// keeps the type truthful for incident responders.
function nameAsErrorClass(out: Record<string, unknown>, type: string): void {
  const ctor = function () {};
  Object.defineProperty(ctor, 'name', { value: type });
  Object.defineProperty(out, 'constructor', { value: ctor, enumerable: false });
}

function scrubError(err: Error, depth: number, seen: WeakSet<object>, opts: ScrubOptions) {
  const type = ERROR_CLASS_NAME.test(err.name) ? err.name : 'Error';
  const out: Record<string, unknown> = {
    type,
    message: scrubText(String(err.message ?? '')),
  };
  nameAsErrorClass(out, type);
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = code;
  if (opts.includeStack && typeof err.stack === 'string') out.stack = scrubText(err.stack);
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = scrubDeep(cause, depth + 1, seen, opts);
  return out;
}

function scrubDeep(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  opts: ScrubOptions,
): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';

  if (value instanceof Error) {
    seen.add(value);
    return scrubError(value, depth, seen, opts);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[OMITTED:binary ${(value as ArrayBufferLike).byteLength} bytes]`;
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.slice(0, MAX_ARRAY).map((v) => scrubDeep(v, depth + 1, seen, opts));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }
  // Framework objects (IncomingMessage, ServerResponse, Date, Map) are left to
  // pino's serializers; walking a socket graph here would be both slow and
  // pointless. Only plain data is inspected.
  if (!isPlainObject(value)) return value;

  seen.add(value);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value);
  for (const key of keys.slice(0, MAX_KEYS)) {
    const v = (value as Record<string, unknown>)[key];
    switch (classifyKey(key)) {
      case 'secret':
        out[key] = REDACTED;
        break;
      case 'personal':
        out[key] = '[REDACTED:personal]';
        break;
      case 'content':
        // `data` and `text` are common innocent keys; only redact when the
        // value is actually content-like (an object, bytes or long text).
        out[key] =
          (typeof v === 'string' && v.length <= 64) ||
          typeof v === 'number' ||
          typeof v === 'boolean'
            ? scrubDeep(v, depth + 1, seen, opts)
            : '[OMITTED:content]';
        break;
      case 'coordinate':
        out[key] = coarsenCoordinate(v);
        break;
      default:
        out[key] = scrubDeep(v, depth + 1, seen, opts);
    }
  }
  if (keys.length > MAX_KEYS) out['…'] = `[+${keys.length - MAX_KEYS} keys]`;
  // An already-serialized error ({ name, message, stack }), e.g. from
  // AllExceptionsFilter: keep its class name visible to pino as well.
  const name = (value as { name?: unknown }).name;
  if (
    typeof name === 'string' &&
    ERROR_CLASS_NAME.test(name) &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    nameAsErrorClass(out, name);
  }
  return out;
}

export function scrubLogArgument(value: unknown, opts: Partial<ScrubOptions> = {}): unknown {
  try {
    return scrubDeep(value, 0, new WeakSet(), { includeStack: opts.includeStack ?? true });
  } catch {
    // A getter that throws, a revoked proxy: never let redaction take the log
    // call (or the request that made it) down with it.
    return '[Unserializable]';
  }
}

// ── request / response allowlists ──────────────────────────────────────────

const REQUEST_HEADER_ALLOWLIST = [
  'host',
  'user-agent',
  'content-type',
  'content-length',
  'accept-language',
  // Not x-request-id: the raw header is client input. The validated id is
  // logged as req.id / requestId.
] as const;

const RESPONSE_HEADER_ALLOWLIST = ['content-type', 'content-length', 'x-request-id'] as const;

function pickHeaders(
  headers: Record<string, unknown> | undefined,
  allow: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const name of allow) {
    const v = headers[name];
    if (typeof v === 'string') out[name] = scrubText(v.slice(0, 256));
    else if (typeof v === 'number') out[name] = String(v);
  }
  return out;
}

/** The URL path without query string or fragment. */
export function pathOnly(url: unknown): string {
  if (typeof url !== 'string') return '';
  const cut = url.search(/[?#]/u);
  const path = cut === -1 ? url : url.slice(0, cut);
  return scrubText(path.slice(0, 512));
}

export interface SerializedRequest {
  id?: string;
  method?: string;
  url: string;
  headers: Record<string, string>;
}

// Input is pino-http's already-wrapped request (`req.raw` holds the original);
// the remote address and port are left out: IP addresses are personal data and
// the abuse signals the runbook needs come from rate-limit metrics instead.
export function serializeRequest(req: {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  originalUrl?: unknown;
  headers?: Record<string, unknown>;
  raw?: { originalUrl?: unknown };
}): SerializedRequest {
  const url = req.raw?.originalUrl ?? req.originalUrl ?? req.url;
  return {
    ...(typeof req.id === 'string' ? { id: req.id } : {}),
    ...(typeof req.method === 'string' ? { method: req.method } : {}),
    url: pathOnly(url),
    headers: pickHeaders(req.headers, REQUEST_HEADER_ALLOWLIST),
  };
}

export function serializeResponse(res: {
  statusCode?: unknown;
  headers?: Record<string, unknown>;
}): { statusCode?: number; headers: Record<string, string> } {
  return {
    ...(typeof res.statusCode === 'number' ? { statusCode: res.statusCode } : {}),
    headers: pickHeaders(res.headers, RESPONSE_HEADER_ALLOWLIST),
  };
}

// Defense in depth for pino's own path-based redaction. With the allowlist
// serializers above, none of these paths should ever hold a value; if a future
// change widens the serializer, these still apply.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-refresh-token"]',
  'req.body',
  'req.query',
  'res.headers["set-cookie"]',
];
