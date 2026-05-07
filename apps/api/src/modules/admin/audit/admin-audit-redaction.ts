// Sprint 6.6 — redact sensitive values from audit metadata before
// the row leaves the API. The audit log is a high-value target
// for an attacker — anything that survives a PATCH attempt
// (server-env-name keys via the legacy keyed settings PUT, raw
// auth tokens via a misconfigured upstream) must not surface in
// the audit response body.
//
// The matcher is conservative: any object key matching
// /password|token|secret|apikey|jwt|bearer|cookie/i (case-insensitive)
// in nested metadata gets its value replaced with "<redacted>".

const SENSITIVE_KEY_RE = /password|token|secret|apikey|jwt|bearer|cookie|database_url/i;
const REDACTED = '<redacted>' as const;

export function redactSensitive<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = REDACTED;
      } else if (typeof v === 'string' && SENSITIVE_KEY_RE.test(v) && v.length > 32) {
        // Heuristic: a very long string that LITERALLY contains a
        // sensitive marker (e.g. "Bearer eyJ…") gets redacted too.
        out[key] = REDACTED;
      } else {
        out[key] = walk(v);
      }
    }
    return out;
  }
  return value;
}
