# ADR 0005 — Provider lifecycle is six independent axes, not one status

- **Status:** Accepted
- **Date:** 2026-08-23
- **Sprint:** 07
- **Related:** [0006](0006-provider-capability-service.md) (single decision point), [0007](0007-legacy-provider-status-compatibility.md) (compatibility + backfill)

## Context

Everything a provider is allowed to do is currently derived from one column:

```prisma
enum ProviderProfileStatus { DRAFT PENDING_REVIEW ACTIVE SUSPENDED REJECTED }
```

That single value is being asked to answer at least six unrelated questions:

1. Has this provider finished filling in their profile?
2. Has an admin looked at them?
3. Have we verified who they actually are?
4. Are they in good standing right now?
5. Are they allowed to take work today?
6. Are they paying us, or promoted by us?

One enum cannot answer six questions, and the collisions are already visible:

- **`ACTIVE` claims too much.** It is set by an admin clicking approve. It says
  nothing about identity verification — no document was ever seen — yet it is
  the only gate on bidding. When document verification ships, either `ACTIVE`
  silently changes meaning for every existing row, or a second flag appears and
  the two disagree.
- **`SUSPENDED` is ambiguous.** Provider suspension (a marketplace-standing
  decision) and account suspension (`User.status = SUSPENDED`, a security
  decision) are different events with different owners, different appeal paths,
  and different blast radii. Today the provider one is a profile status and the
  account one is elsewhere, and nothing states which wins.
- **`REJECTED` is terminal-looking but isn't.** A rejected applicant may
  reapply; the enum has no way to express "rejected once, now re-drafting"
  without destroying the audit trail.
- **There is nowhere to put time.** A provider approved for work _until March_
  cannot be represented. Any expiry today means a background job flipping the
  status column, which loses why it changed.
- **Recognition is mixed in.** `verified` and `topPro` are display booleans
  sitting next to a column that grants access. Nothing stops the next person
  reading `verified` as an authorization input — the name invites it.

## Decision

Model the six questions as **six independent axes**. A provider is a point in
all six simultaneously; no axis is derivable from another.

| #   | Axis                  | Answers                                       | Owner                | Sprint 7 scope                            |
| --- | --------------------- | --------------------------------------------- | -------------------- | ----------------------------------------- |
| 1   | **Onboarding**        | Is the application complete and submitted?    | Provider             | Full                                      |
| 2   | **Verification**      | Have we confirmed who they are?               | Ops / automated      | Enum + storage only; no document flow     |
| 3   | **Provider standing** | Are they in good standing on the marketplace? | Trust & safety       | Full                                      |
| 4   | **Work access**       | May they take work _right now_?               | Policy, time-bounded | Grant table foundation; not yet consulted |
| 5   | **Subscription**      | What have they paid for?                      | Billing              | Enum only; no payments                    |
| 6   | **Recognition**       | What have we awarded them?                    | Marketing / scoring  | Enum only; never authoritative            |

Plus one axis that is **not** the provider's and outranks all six:

| 0 | **Account eligibility** | May this human use the platform at all? | IAM (`User.status`, `isActive`, `deletedAt`) |

### Axis 1 — Onboarding

```
NOT_STARTED ──upgrade──▶ DRAFT ──submit(complete)──▶ SUBMITTED
                           ▲                            │
                           │                     admin decision
                           │                            │
                           └──────reopen◀── RETURNED ◀───┤
                                                        │
                                                   ACCEPTED
```

| From          | To          | Trigger                               | Guard                                        |
| ------------- | ----------- | ------------------------------------- | -------------------------------------------- |
| `NOT_STARTED` | `DRAFT`     | `POST /me/provider/upgrade`           | role `provider` granted                      |
| `DRAFT`       | `DRAFT`     | profile PATCH                         | owner only                                   |
| `DRAFT`       | `SUBMITTED` | `POST /me/provider/submit-for-review` | `evaluateOnboarding()` returns **no** issues |
| `SUBMITTED`   | `ACCEPTED`  | admin approve                         | admin role                                   |
| `SUBMITTED`   | `RETURNED`  | admin request changes / reject        | admin role                                   |
| `RETURNED`    | `DRAFT`     | provider edits                        | owner only                                   |
| any           | any         | —                                     | **no other transition is legal**             |

A submission writes an immutable **snapshot** (see [0007](0007-legacy-provider-status-compatibility.md)) recording exactly what was submitted and under which `policyVersion`. Reviewers must judge what was sent, not what the row looks like now, and a later policy change must not retroactively invalidate a pending application.

### Axis 2 — Verification

```
UNVERIFIED ──▶ PENDING ──▶ VERIFIED
     ▲            │            │
     └── EXPIRED ◀┴── REJECTED ┘
```

| From                   | To                      | Trigger                           |
| ---------------------- | ----------------------- | --------------------------------- |
| `UNVERIFIED`           | `PENDING`               | documents submitted _(Sprint 8+)_ |
| `PENDING`              | `VERIFIED` / `REJECTED` | reviewer decision                 |
| `VERIFIED`             | `EXPIRED`               | document expiry elapses           |
| `EXPIRED` / `REJECTED` | `PENDING`               | resubmission                      |

**Sprint 7 writes `UNVERIFIED` for every existing row, including approved ones.** No historical provider ever had a document checked; recording them as `VERIFIED` would be inventing an audit trail. This is the single most important consequence of the backfill and is why `ACTIVE` maps to `LEGACY_APPROVED` rather than to verification.

### Axis 3 — Provider standing

```
GOOD ⇄ UNDER_REVIEW ──▶ RESTRICTED ──▶ SUSPENDED ──▶ TERMINATED
```

| From           | To                                    | Trigger                   | Reversible    |
| -------------- | ------------------------------------- | ------------------------- | ------------- |
| `GOOD`         | `UNDER_REVIEW`                        | report / automated signal | yes           |
| `UNDER_REVIEW` | `GOOD` \| `RESTRICTED` \| `SUSPENDED` | T&S decision              | yes           |
| `RESTRICTED`   | `GOOD` \| `SUSPENDED`                 | T&S decision              | yes           |
| `SUSPENDED`    | `GOOD` \| `TERMINATED`                | T&S decision              | to `GOOD` yes |
| `TERMINATED`   | —                                     | —                         | **terminal**  |

Distinct from account suspension: a provider may be `SUSPENDED` on the marketplace with a perfectly healthy account (they remain a seeker), and an account may be suspended while provider standing is `GOOD`.

### Axis 4 — Work access (time-bounded)

Not a status on the profile — a **grant**, because the question is "may they work _now_", and "now" changes without anyone editing a row.

```
(no grant) ─grant──▶ ACTIVE ──expiry elapses──▶ EXPIRED
                       │
                       └──revoke──▶ REVOKED
```

A provider has work access iff a grant exists with `revokedAt IS NULL` and `now() BETWEEN grantedAt AND COALESCE(expiresAt, 'infinity')`. Expiry needs no writer, which is the point: a nightly job that flips a status column is a job that can fail, and its failure grants access nobody authorised.

**Sprint 7 creates the table and the read path but does not consult it for authorization.** Marketplace access stays on the legacy rule until Sprint 9 issues real grants — flipping the gate before any grant exists would lock out every provider on the platform.

### Axis 5 — Subscription · Axis 6 — Recognition

`NONE | BASIC | PRO | ELITE` and a set of recognition flags. Enum + column only this sprint: no payments, no scoring, no checkout.

**Neither axis may ever grant a capability.** Recognition changes ordering and badges; subscription changes quotas and features. If a paid tier ever needs to unlock an action, it does so by issuing a **work-access grant**, so the decision stays on one axis and remains auditable. `verified` and `topPro` stay as display booleans and are explicitly **not** authorization inputs; [0006](0006-provider-capability-service.md) enforces that by never reading them.

## Precedence

Evaluated in order. **The first rule that denies, denies** — later rules cannot re-grant.

| Rank  | Rule                                                               | Effect                                                      |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| **0** | Account not eligible (`deletedAt`, `!isActive`, status ≠ `ACTIVE`) | **Deny everything.** No provider capability, no exceptions. |
| 1     | No provider profile                                                | Deny all provider capabilities except `upgrade`.            |
| 2     | Provider standing `TERMINATED`                                     | Deny everything except read-own-profile.                    |
| 3     | Provider standing `SUSPENDED`                                      | Deny work + onboarding; allow read + appeal.                |
| 4     | Provider standing `RESTRICTED`                                     | Deny new work; allow existing obligations.                  |
| 5     | Onboarding incomplete                                              | Deny work; **allow onboarding** (the DRAFT fix).            |
| 6     | Verification required and not met                                  | Deny work; allow onboarding.                                |
| 7     | No active work-access grant                                        | Deny work. _(inert until Sprint 9)_                         |
| 8     | Subscription / recognition                                         | **Never denies, never grants.** Quotas and ordering only.   |

Rank 0 is absolute and is why it is rank 0 rather than a check somewhere in the middle. A suspended account that still holds an unexpired access token must not be able to bid because their _provider_ row happens to say `ACTIVE`. Today that is enforced only at the session layer (`assertSessionActive` → `isInGoodStanding`); [0006](0006-provider-capability-service.md) makes it explicit at the capability layer too, so the guarantee does not depend on one call site continuing to be reached.

## Consequences

**Good** — each axis has one owner and one meaning; `ACTIVE` stops claiming verification it never did; expiry becomes data rather than a cron job; recognition and payment cannot leak into authorization; every transition table above is directly testable.

**Costs / risks**

- Six columns where there was one. Mitigated by [0006](0006-provider-capability-service.md): callers ask for a _capability_, never a status.
- The legacy enum stays for now, so there are two representations during migration. [0007](0007-legacy-provider-status-compatibility.md) owns that, including which is authoritative.
- The precedence table is the security boundary. It is enumerated in one file, and the tests walk the full cross-product rather than sampling it.
- Modelling work access as grants means "why can't I work?" needs a query, not a glance at a column. `GET /v1/me/provider/capabilities` exists so the provider gets an answer without an operator running SQL.

## Revisit

When Sprint 9 issues real grants: flip rank 7 from inert to enforcing, behind a flag, and only after a backfill has granted access to every currently-`LEGACY_APPROVED` provider. Getting that order wrong locks out the entire supply side.
