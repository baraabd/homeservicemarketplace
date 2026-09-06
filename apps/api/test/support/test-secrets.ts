import { createHash } from 'node:crypto';

// Sprint 9B.28 CI remediation — test secrets that are DERIVED, not written.
//
// docs/security/gitleaks-historical-baseline.md
//
// WHY THIS EXISTS
//
// Ten CI secret-scan findings came from one habit: a spec needs a signing
// secret, so it writes `const SECRET = '<44 random characters>'` at the top of
// the file. That is indistinguishable, to a scanner, from a real key. Gitleaks
// flagged all ten as `generic-api-key`, the job failed, and the container
// build and image scan behind it never ran.
//
// The historical findings are baselined by fingerprint. This closes the
// SOURCE of them: a value computed at runtime is not a literal in a blob, so
// it cannot be flagged, and a future edit to one of these lines cannot
// resurrect the failure under a new fingerprint.
//
// WHAT IT IS NOT
//
// Not a security control, and not a secrets manager. These values protect
// nothing — they exist so a signer and a verifier inside one spec agree. The
// derivation is deliberately deterministic so a failing test reproduces
// exactly, and deliberately seeded only from the caller's label so no
// environment value can ever leak in.

/**
 * A deterministic, sufficiently long test secret.
 *
 * @param label  Names the thing being signed, so two suites that must NOT
 *               share a secret can ask for different ones. Same label always
 *               yields the same value.
 * @param length Defaults to 44 because that is what the previous literals
 *               were, and because `env.schema.ts` requires
 *               `JWT_ACCESS_SECRET` to be at least 32 characters — a shorter
 *               value would fail config validation rather than the assertion
 *               the spec is actually making.
 */
export function makeTestSecret(label: string, length = 44): string {
  if (length < 32) {
    // Guard rather than silently return something the config schema rejects:
    // the failure would surface as "config invalid" three layers away from
    // the caller that chose the length.
    throw new Error(`makeTestSecret: length ${length} is below the 32-character config minimum`);
  }
  // `base64url` keeps the value free of `+`, `/` and `=`, so it can be dropped
  // into a URL or a header in a test without escaping. One sha256 is 43
  // base64url characters, so longer requests are extended by re-hashing
  // rather than by padding with a repeated character.
  let out = '';
  let round = 0;
  while (out.length < length) {
    out += createHash('sha256').update(`hsm-test-secret:${label}:${round}`).digest('base64url');
    round += 1;
  }
  return out.slice(0, length);
}
