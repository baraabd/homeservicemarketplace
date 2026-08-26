// Sprint 9B.7 — how long a work-access grant issued by an approval lasts.
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md:
//   `endsAt = decidedAt + VERIFICATION_GRANT_DAYS` (default 365, configurable)
//
// Pure, so every boundary can be asserted without a database or a clock.
//
// WHY THIS IS NOT A CONSTANT IN THE SERVICE
//
// The number lives in `ADMIN_SETTINGS_SCHEMA` under
// `verification_work_grant_validity_days`, read at approval time from the same
// PlatformSetting row the admin screen writes. A constant here would mean the
// value an admin is shown is not the value the code enforces — the exact drift
// the whitelisted settings schema exists to prevent.
//
// WHY THE WINDOW IS FROZEN INTO THE ROW
//
// The setting is mutable, so it carries no history of its own. The grant does:
// `grantedAt` and `expiresAt` are written once, at issue, and never
// recalculated. The duration that actually applied to a provider is therefore
// reconstructible forever as `expiresAt - grantedAt`, and the policy version it
// was judged under is reachable as `grant.case.policyVersion`. Lowering the
// setting tomorrow shortens FUTURE approvals and silently re-dates nobody's
// existing access — which is the only behaviour that can be audited honestly.

/** The settings key. Exported so the service and its tests name it once. */
export const GRANT_VALIDITY_DAYS_KEY = 'verification_work_grant_validity_days';

const MS_PER_DAY = 86_400_000;

export type GrantValidityErrorCode =
  /** Not a positive whole number of days. */
  | 'INVALID_VALIDITY_DAYS'
  /** The computed window ends at or before it starts. */
  | 'WINDOW_ALREADY_EXPIRED';

export class GrantValidityError extends Error {
  constructor(
    readonly code: GrantValidityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GrantValidityError';
  }
}

export interface GrantWindow {
  /** Exactly the decision instant. Never a second clock read — see below. */
  grantedAt: Date;
  expiresAt: Date;
}

/**
 * The window a grant issued at `decidedAt` occupies.
 *
 * `grantedAt` is the decision instant *verbatim*, not a fresh `new Date()`.
 * Reading the clock twice inside one approval is how a window gets a start and
 * an end that disagree about when "now" was: under NTP correction or a leap
 * adjustment the second read can precede the first, and the grant is born
 * expired. One instant in, one window out — so the arithmetic cannot be
 * affected by clock movement between the two.
 *
 * Throws rather than clamping. A misconfigured validity must stop the approval,
 * not quietly issue a grant of some other length: an approval that reports
 * success while authorising nothing is worse than a refusal nobody can miss.
 */
export function computeGrantWindow(input: { decidedAt: Date; validityDays: number }): GrantWindow {
  const { decidedAt, validityDays } = input;

  if (
    typeof validityDays !== 'number' ||
    !Number.isFinite(validityDays) ||
    !Number.isInteger(validityDays) ||
    validityDays <= 0
  ) {
    throw new GrantValidityError(
      'INVALID_VALIDITY_DAYS',
      'Work-grant validity must be a positive whole number of days.',
    );
  }

  const expiresAt = new Date(decidedAt.getTime() + validityDays * MS_PER_DAY);

  // Belt and braces against an absurd input that survived the check above
  // (a validity so large the arithmetic overflows into a non-finite date).
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= decidedAt.getTime()) {
    throw new GrantValidityError(
      'WINDOW_ALREADY_EXPIRED',
      'The computed grant window ends before it begins.',
    );
  }

  return { grantedAt: decidedAt, expiresAt };
}
