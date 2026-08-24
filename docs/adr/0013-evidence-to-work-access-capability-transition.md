# ADR 0013 — From submitted evidence to time-bounded work access

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 09
- **Related:** [0005](0005-provider-lifecycle-axes.md) (the axes and ranks 6–7), [0006](0006-provider-capability-service.md) (the one decision point), [0010](0010-policy-versioned-verification.md) (what evidence was required), [0011](0011-redacted-pre-verification-preview.md) (what submitted evidence grants)

## Context

[ADR 0005](0005-provider-lifecycle-axes.md) modelled verification (rank 6) and
work access (rank 7) and left both **inert**, with an explicit instruction:

> When Sprint 9 issues real grants: flip rank 7 from inert to enforcing, behind a
> flag, and only after a backfill has granted access to every currently-
> `LEGACY_APPROVED` provider. Getting that order wrong locks out the entire
> supply side.

This is that sprint. The regression test committed at the head of this branch
proves the current behaviour: a `LEGACY_APPROVED` provider with
`verificationState = UNVERIFIED` and no grant is returned

```
[VIEW_OWN_PROFILE, EDIT_OWN_PROFILE, VIEW_MARKETPLACE,
 SUBMIT_BID, MANAGE_BOOKINGS, VIEW_EARNINGS]
```

— the full working set, on the strength of `status === 'ACTIVE'` alone.

Two failure modes bound this work. Arming the gate before grants exist locks out
every provider on the platform. Leaving it inert means identity verification
never actually gates anything, and the whole sprint is decoration.

## Decision

### 1. The state machine, end to end

```
onboarding ACCEPTED / DOCUMENTS_REQUIRED
        │
        │ provider uploads evidence
        ▼
VerificationCase  DRAFT ──submit──▶ SUBMITTED ──assign──▶ IN_REVIEW
                                         │                    │
                                         │            ┌───────┴────────┐
                                         │            ▼                ▼
                                         │      ACTION_REQUIRED     decision
                                         │            │          ┌────┴────┐
                                         └────resubmit┘          ▼         ▼
                                                             VERIFIED  REJECTED
                                                                 │
                                                    issues ProviderWorkAccessGrant
                                                       (startsAt, endsAt, source)
                                                                 │
                                                    ┌────────────┼────────────┐
                                                    ▼            ▼            ▼
                                                 expiry       revoke     re-verify
```

`SUBMITTED` grants the **preview only** ([0011](0011-redacted-pre-verification-preview.md)).
It is not a partial work grant. This is the distinction Sprint 8 built
`DOCUMENTS_REQUIRED` to make unmistakable, and it holds here: _submitting
evidence grants nothing but the right to wait and to look._

### 2. Approval is one transaction or it is nothing

A reviewer's approval must commit, atomically:

1. `VerificationCase` → `VERIFIED` (conditional on its current state)
2. `VerificationDecision` row — outcome, reason code, reviewer, policy version
3. `ProviderProfile.verificationState` → `VERIFIED`
4. `ProviderWorkAccessGrant` — `startsAt`, `endsAt`, `source`, `reason`, actor
5. `AuditEvent`
6. `Notification` to the provider
7. `OutboxEvent` (deduped on the decision id)

Partial commit is the dangerous outcome in both directions: a grant without a
decision is unaudited access, and a decision without a grant is a provider told
they are verified who still cannot work. A forced-failure test injects a throw at
each step and asserts **nothing** persisted.

The `securityEvents` bus stays post-commit, as today — it is an in-process cache
eviction, not a durable record. Durability is the outbox's job.

### 3. Grants are time-bounded, and expiry is computed

`endsAt = decidedAt + VERIFICATION_GRANT_DAYS` (default 365, configurable). Access
is `revokedAt IS NULL AND now() BETWEEN startsAt AND COALESCE(endsAt,'infinity')`
— computed at read time, exactly as [ADR 0005](0005-provider-lifecycle-axes.md)
specified, so expiry needs no writer and a failed cron cannot grant access nobody
authorised.

`source` records what justified it: `VERIFIED_DOCUMENTS`, `LEGACY_BACKFILL`,
`MANUAL_OVERRIDE`, `RENEWAL`. A manual override is legitimate and must be
distinguishable from a verified one forever.

### 4. Ranks 6 and 7, armed — in this order

Rank 6 (verification) denies work when the resolved policy **requires**
verification for that provider and the case is not `VERIFIED`. Rank 7 (work
access) denies work when no live grant exists. Both deny work only; both preserve
`COMPLETE_ONBOARDING`, `VIEW_OWN_PROFILE` and `APPEAL_DECISION`, because a
provider who cannot work must still be able to see why and act on it.

Denial reasons remain policy-free (`VERIFICATION_REQUIRED`, `NO_WORK_ACCESS`) per
[ADR 0006](0006-provider-capability-service.md): they are read by the person being
denied, including someone probing the boundary. They never disclose which
threshold failed or when a grant expires.

### 5. Rollout order is non-negotiable

1. **Backfill first.** Every provider currently `LEGACY_APPROVED` receives a grant
   with `source = LEGACY_BACKFILL` and `endsAt = null`, in a forward-only
   migration. Truthfully: they were approved under the old process. Their
   `verificationState` stays `UNVERIFIED` — the backfill grants access, it does
   **not** invent a verification that never happened.
2. **Then arm, behind a flag.** `WORK_ACCESS_ENFORCED` defaults **off**. Off
   preserves today's legacy rule exactly; on consults the grant.
3. **Verify the count.** The number of live grants must equal the number of
   previously-working providers before the flag flips in any environment.

The flag exists to make the flip reversible in seconds without a deploy. It is a
rollout control, not a permanent branch, and its removal is scheduled.

### 6. Losing access is bounded and truthful

Expiry, revocation, suspension or account lock removes work capabilities within
**one capability evaluation** — the next guarded request — because the capability
service reads state per request and holds no cross-request cache
([ADR 0006](0006-provider-capability-service.md) forbids one precisely so rank 0
cannot go stale). The documented blocking window is therefore _the next request_,
with the realtime socket eviction already emitted post-commit as a best-effort
accelerator.

**Verification history survives all of it.** A revoked grant does not make a
`VERIFIED` case untrue. Revocation writes `revokedAt`, `revokedByUserId`,
`revokedReason`; it never edits the decision, and it never deletes the case. A
provider whose grant lapsed was still verified on the date they were verified.

## Alternatives rejected

**Set `verificationState = VERIFIED` and let rank 6 alone gate work.** Collapses
"we confirmed who you are" into "you may work today" — one column answering two
questions, which is the defect [ADR 0005](0005-provider-lifecycle-axes.md) exists
to undo. It also has nowhere to put an expiry.

**Grant access on submission, revoke on rejection.** Optimistic access to a
marketplace involving strangers entering homes. The window between submission and
review is exactly when a fraudulent applicant is most motivated.

**Arm the gate and backfill afterwards.** Locks out the entire supply side, and is
named as the failure mode in ADR 0005's own revisit note.

**No flag, deploy straight to enforcing.** Makes the rollback a deploy. For a
change that can deny every provider on the platform, seconds matter.

## Consequences

**Good** — evidence, decision and access are three separable facts; access
expires without a writer; the badge is earned by a decision rather than set on a
form; the flip is reversible; history stays truthful through revocation.

**Costs / risks**

- **One more read** in the capability path (grant lookup). Indexed on
  `(providerProfileId, status, expiresAt)`, which already exists.
- **The flag is a second code path** and both must be tested. The suite runs the
  capability cross-product in both positions.
- **The backfill is the single highest-risk step in the sprint.** Forward-only,
  counted before and after, and reversible by flipping the flag off rather than
  by un-writing rows.
- **Legacy-backfilled providers are working while `UNVERIFIED`.** True, visible,
  and intended: they are findable by exactly that query, which is what makes a
  later "verify the back catalogue" campaign possible.
- **Grant expiry will one day mass-lapse** a cohort backfilled on the same day.
  `endsAt = null` for the backfill avoids it now; any future bulk renewal must
  stagger.

## Revisit

- Remove `WORK_ACCESS_ENFORCED` once enforced in production and stable.
- Per-category grants, if a provider should be able to work one trade while
  another's licence is pending. The grant table can carry it; the capability
  set cannot express it yet.
