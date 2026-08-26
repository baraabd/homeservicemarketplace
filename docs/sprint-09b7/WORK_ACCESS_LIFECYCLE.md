# Sprint 9B.7 — work-access lifecycle: approval, revocation, expiry

Companion to [ADR 0013](../adr/0013-evidence-to-work-access-capability-transition.md).
This document records what was built, the two defects the work uncovered, and how
the expiry job is activated.

---

## 1. The two axes, and why suspension is not an evidence decision

| Axis     | Column                                             | Written by                           | Never written by          |
| -------- | -------------------------------------------------- | ------------------------------------ | ------------------------- |
| Evidence | `providerProfile.verificationState`, `verified`    | approve / revoke / reverify / expire | suspend, reactivate       |
| Standing | `providerProfile.status` (legacy), `standingState` | suspend, reactivate                  | any verification decision |

Approving documents says nothing about whether an account is in good standing, and
a suspended provider whose documents check out is still suspended. Conflating the
two is how a suspension gets lifted by an unrelated document review.

## 2. The P0 this sprint found

`ProviderCapabilityService` rank 3 denied work on `standingState === 'SUSPENDED'`.
Admin suspension (`decideIfInStatus`) writes **only** the legacy `status` column,
leaving `standingState` at a non-null `'GOOD'`.

That was survivable while `WORK_ACCESS_ENFORCED` was **off**, because rank 7 then
re-checked `legacyStatus === 'ACTIVE'`, which suspension does clear. With the flag
**on**, rank 7 consults the grant instead — so a suspended provider holding an
ACTIVE grant became authorised to work, and arming the flag would have silently
un-suspended everyone who held one.

Rank 3 now denies when **either** axis says suspended. ADR 0007's mapping table
already specified `SUSPENDED → standing SUSPENDED`; the service applied that table
for the onboarding axis (`onboardingFromLegacy`) and never for standing. It is not
a null-fallback, because the stale value is not null.

Proved twice: two unit tests that go red when the fix is reverted, and
`work-access-enforcement.integration.spec.ts` with the flags on against a real
database, which also goes red on revert.

## 3. The second defect: revocation swept up unrelated grants

The grant close was scoped `{ providerProfileId, status: 'ACTIVE' }` — every ACTIVE
grant the provider held, whatever its source. A documents revocation would have
destroyed a `MANUAL_OVERRIDE` granted deliberately for an unrelated reason, with no
decision naming it and no way to tell afterwards it had existed.

Now scoped to `{ providerProfileId, caseId, status: 'ACTIVE' }`. A verification
decision judges the evidence in **one case** and may only close what that case
issued.

**Consequence worth stating plainly:** revocation does not guarantee the provider
stops working. If they hold a separate live override they keep working on it, and
that is correct. The instrument that overrides every source is account suspension,
which outranks work access regardless of how many grants exist.

## 4. Grant duration

ADR 0013: `endsAt = decidedAt + VERIFICATION_GRANT_DAYS` (default 365, configurable).

| Requirement                | Where                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| Typed                      | `computeGrantWindow` in `grant/grant-validity.ts`; zod-validated settings entry |
| DB-backed                  | `PlatformSetting` row `verification_work_grant_validity_days`                   |
| Admin-configurable         | `ADMIN_SETTINGS_SCHEMA`, bounds 1–3650, default 365                             |
| Not hard-coded             | resolved per approval via `VerificationSettingsService.workGrantValidityDays()` |
| Historically auditable     | frozen into the row as `grantedAt`/`expiresAt`, never recalculated              |
| Policy-version association | `grant.caseId → case.policyVersion`                                             |

The env var `VERIFICATION_GRANT_DAYS` was **removed**. It was declared and never
read — a dead knob that would have let the next person needing a shorter window
set it, deploy, and change nothing.

Lowering the setting shortens **future** approvals and re-dates nobody's existing
access, which is the only behaviour that can be audited honestly.

A validity that is zero, negative or fractional **fails the whole approval**. An
approval that reports success while authorising nothing is worse than a refusal
nobody can miss.

## 5. Expiry

### Why a writer exists at all

ADR 0013 makes access a read-time predicate precisely so a failed cron cannot leave
access granted that nobody authorised. That property is preserved: **a lapsed
verification stops authorising work whether or not the sweep ever runs**, proved by
a test that expires a grant window and never runs the sweep.

What needs a writer is everything the predicate cannot express — the case is still
`VERIFIED`, the provider's evidence axis is still `VERIFIED`, and no decision,
audit row, notification or event exists. So the sweep is a lifecycle-and-
truthfulness job. If it stops, access stays correct and the record goes stale,
which is the right direction for a background job to fail.

### Shape

`VerificationExpiryService.runOnce({ now, limit })`:

1. selects ACTIVE, unrevoked grants with `expiresAt <= now` whose case is still `VERIFIED`
2. bounded — default 100, hard cap 500, floor 1
3. oldest-expiry-first, so a backlog drains in the order it accumulated
4. `expireCase` per case: one transaction, conditional claim on the observed state
5. decision `EXPIRED` with `decidedByUserId = null` — no human decided, so no human is named
6. grant closed `EXPIRED`, scoped to the case
7. audit `VERIFICATION_CASE_EXPIRED`, notification `VERIFICATION_EXPIRED`, outbox `verification.case.access_closed`
8. a failing case is logged and left due; the batch continues

Selection is **not** a claim. Two workers may pick the same case; the conditional
update lets exactly one write and the other reports `alreadyDone`. There is no
leader election to get wrong.

### No HTTP route, deliberately

`VERIFICATION_CASE_TRANSITIONS.expire` names the actor as `system`. An endpoint
that expired a case would be a human performing a machine's act, recorded against
their name. `expire` is in `IMPLEMENTED_CASE_ACTIONS` but `offerableCaseActions`
never shows it to a provider or a reviewer — being implemented and being offerable
to a human are different things, and this is the one action where they differ.

The reviewer-facing instrument for ending access early already exists: `revoke`.

### Activation

```
VERIFICATION_EXPIRY_WORKER_ENABLED=true    # default false
VERIFICATION_EXPIRY_INTERVAL_MS=900000     # 15 minutes
VERIFICATION_EXPIRY_BATCH_SIZE=100
```

Modelled on `OutboxCleanupJob` — an unref'd `setTimeout` chain, a public `runOnce`
for deterministic tests, and a flag that decides whether it schedules at all. **No
new scheduling dependency was introduced**: `@nestjs/schedule`, a queue or a cron
container would each be a new failure domain to operate, for a pass that is not
load-bearing for authorization.

Safe on every replica, for the reason in "Shape" above.

## 6. Enforcement flags

`WORK_ACCESS_ENFORCED` and `VERIFICATION_ENFORCED` remain **`default(false)`**.

`work-access-enforcement.integration.spec.ts` arms both explicitly and proves the
whole loop over real HTTP against a real database: denied → approved → allowed →
revoked → denied → expired → denied, plus suspension and reactivation. It is the
only suite that runs with them on; every other suite describes the shipped
default.

## 7. VIP and Featured

They do not exist in this codebase — not in the schema, not in code, not in any
contract, and this sprint did **not** add them. The general invariant they would be
a special case of is enforced: the only source an approval writes is
`VERIFIED_DOCUMENTS`, and `MANUAL_OVERRIDE` / `LEGACY_BACKFILL` exist precisely so a
grant somebody was _given_ stays distinguishable from one they _earned_. If VIP or
Featured are added later, that distinction is where the rule hangs.
