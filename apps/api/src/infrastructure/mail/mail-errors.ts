// R21 — transport failure classification.
//
// The class decides what the dispatcher does next and is the only thing
// persisted or exported as a metric label. Driver messages are never stored:
// an SMTP error string can echo the envelope, credentials or a DSN.
//
//   transient  retry with backoff (4xx reply, network, timeout, TLS handshake)
//   permanent  stop; this message will never be accepted (5xx reply, bad
//              envelope)
//   config     retry, but alert: the relay rejected our credentials or
//              identity, which only an operator can fix

export type MailFailureClass = 'transient' | 'permanent' | 'config';

export interface ClassifiedMailFailure {
  failureClass: MailFailureClass;
  smtpCode: number | null;
}

const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETLS',
  'EPROTOCOL',
]);

export function classifyMailFailure(err: unknown): ClassifiedMailFailure {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown };
  const smtpCode = typeof e.responseCode === 'number' ? e.responseCode : null;
  const code = typeof e.code === 'string' ? e.code : '';

  if (code === 'EAUTH' || smtpCode === 530 || smtpCode === 535) {
    return { failureClass: 'config', smtpCode };
  }
  if (smtpCode !== null) {
    if (smtpCode >= 400 && smtpCode < 500) return { failureClass: 'transient', smtpCode };
    if (smtpCode >= 500 && smtpCode < 600) return { failureClass: 'permanent', smtpCode };
  }
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return { failureClass: 'permanent', smtpCode };
  if (TRANSIENT_CODES.has(code)) return { failureClass: 'transient', smtpCode };
  // Unknown: retry. Giving up on an unrecognised error turns every new driver
  // error code into lost mail; the attempt budget still bounds it.
  return { failureClass: 'transient', smtpCode };
}

/** Parses "250 2.0.0 Ok: queued" → 250. */
export function smtpCodeFromResponse(response: unknown): number | undefined {
  if (typeof response !== 'string') return undefined;
  const match = /^(\d{3})\b/.exec(response.trim());
  return match ? Number(match[1]) : undefined;
}
