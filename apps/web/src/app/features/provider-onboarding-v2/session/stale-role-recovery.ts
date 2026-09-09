import type { RoleName } from '@homeservicemarketplace/contracts';

// Sprint 9B.29 — recovering from a stale role claim, exactly once.
//
// docs/provider-experience-v2/SPRINT_09B29_BASELINE.md §7
//
// THE FAILURE THIS EXISTS FOR
//
// `POST /v1/me/provider/upgrade` writes the provider role to the database and
// returns the new profile. It does not touch the caller's session, and
// `JwtStrategy.validate` reads roles from the ACCESS TOKEN — deliberately. So
// a token minted before the upgrade still says "seeker", `RolesGuard` answers
// 403 to every `/v1/me/provider/**` call, and the provider is locked out of the
// application they just created.
//
// 9B.28 added a session rotation to the upgrade mutation, which fixes the happy
// path. It does not cover the cases that actually strand people: the rotation
// failing, the tab being reloaded mid-transition, a deep link opened before the
// rotation lands, or a second device. Those all arrive at the hub as a bare
// 403.
//
// WHY IT IS CAPPED AT ONE ATTEMPT
//
// A 403 normally means "correctly identified, genuinely not allowed". Retrying
// every 403 after a refresh is a privilege-escalation retry loop: it turns a
// correct refusal into a storm of requests that will each be refused again, and
// it is precisely what the rule forbids ("Never globally refresh or retry all
// 403 responses").
//
// One attempt is enough for the transition this targets, because the stale
// claim is a single, known, self-clearing condition: rotate once, and either
// the new token carries `provider` or the refusal was real. A second attempt
// could not learn anything the first did not.
//
// VERIFICATION IS PART OF RECOVERY, NOT AN EXTRA
//
// A rotation that succeeds at the HTTP level but returns a session still
// missing the role has not recovered anything. Reporting success there would
// send the provider back into the same 403 with the recovery budget already
// spent. So the role is checked against the authoritative session, and a
// rotation that does not produce it is a `role-missing` failure with its own
// message.
//
// Pure. The hook that performs the IO lives beside this file; everything
// decidable without a network is decided here so the whole matrix is testable.

/** The role a provider surface requires. */
export const PROVIDER_ROLE: RoleName = 'provider';

/**
 * How many times a stale-role recovery may be attempted per mount.
 *
 * One. See the header — this is a cap, not a tuning knob, and raising it
 * re-introduces the retry loop the rule forbids.
 */
export const MAX_STALE_ROLE_ATTEMPTS = 1;

/**
 * What a COMPLETED rotation can conclude.
 *
 * Narrower than `RecoveryState` on purpose: `classifyRecovery` can only ever
 * return one of these two, and saying so in the type is what lets callers read
 * `.reason` without a cast. Widening this to `RecoveryState` was the original
 * shape and it forced exactly that cast at the one place the distinction
 * matters.
 */
export type RecoveryOutcome =
  /** The session now carries the provider role; the caller should refetch. */
  { kind: 'recovered' } | { kind: 'failed'; reason: 'refresh-failed' | 'role-missing' };

export type RecoveryState =
  /** No 403 seen, or nothing attempted yet. */
  | { kind: 'idle' }
  /** A rotation is in flight. */
  | { kind: 'recovering' }
  /** The session now carries the provider role; the caller should refetch. */
  | { kind: 'recovered' }
  /**
   * The attempt was made and did not work.
   *
   * `refresh-failed` — the rotation call itself failed (network, expired
   * refresh cookie). Retrying by hand is reasonable, so the UI offers it.
   *
   * `role-missing` — the rotation succeeded and the authoritative session
   * STILL does not carry the role. That is a genuine authorization answer, not
   * a synchronization lag, and no amount of retrying changes it.
   */
  | { kind: 'failed'; reason: 'refresh-failed' | 'role-missing' }
  /** The budget is spent. Further 403s are reported, never retried. */
  | { kind: 'exhausted' };

export interface RecoveryDecisionInput {
  /** Is the surface currently being refused with a 403? */
  forbidden: boolean;
  /** How many attempts have already been made on this mount. */
  attempts: number;
  /** Where the machine is now. */
  state: RecoveryState['kind'];
}

/**
 * May a recovery be started right now?
 *
 * Every clause is a real guard rather than defensive padding:
 *
 *   - not forbidden        → nothing to recover from; starting anyway would
 *                            rotate the session of a perfectly healthy page;
 *   - already recovering   → the second caller would open a parallel rotation
 *                            and both would race to set the cookie;
 *   - budget spent         → the loop guard, and the whole point of the cap;
 *   - already settled      → `recovered` and `failed` are terminal for this
 *                            mount. Re-attempting from `failed` is the storm
 *                            this prevents, and re-attempting from `recovered`
 *                            means the refusal was real.
 */
export function shouldAttemptRecovery(input: RecoveryDecisionInput): boolean {
  if (!input.forbidden) return false;
  if (input.attempts >= MAX_STALE_ROLE_ATTEMPTS) return false;
  return input.state === 'idle';
}

/**
 * Read the outcome of a completed rotation.
 *
 * Takes the roles the AUTHORITATIVE session reports, not what the client hoped
 * for. `null` means the session could not be read at all, which is treated as
 * a failed refresh rather than a missing role: we did not learn that the role
 * is absent, only that we could not ask.
 */
export function classifyRecovery(roles: readonly RoleName[] | null): RecoveryOutcome {
  if (roles === null) return { kind: 'failed', reason: 'refresh-failed' };
  return roles.includes(PROVIDER_ROLE)
    ? { kind: 'recovered' }
    : { kind: 'failed', reason: 'role-missing' };
}

/**
 * Is this state one the provider can act on with a retry button?
 *
 * `role-missing` deliberately is not: the server has given a considered answer
 * and offering a button that re-asks the same question would be a lie about
 * what is happening.
 */
export function isRetryable(state: RecoveryState): boolean {
  return state.kind === 'failed' && state.reason === 'refresh-failed';
}
