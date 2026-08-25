# Sprint 9B.1 — architecture: two axes, not seven actions

Status: **decided**. Enforced by `apps/api/src/modules/provider/verification/policy/canonical-axes.spec.ts` (13 tests).

## The decision

Provider lifecycle in this repository runs on **two canonical tables**, on two
different axes, each with its own state vocabulary:

| Table                           | Lives in                                                        | Axis             | State enum              |
| ------------------------------- | --------------------------------------------------------------- | ---------------- | ----------------------- |
| `VERIFICATION_CASE_TRANSITIONS` | `apps/api/.../provider/verification/policy/case-transitions.ts` | Evidence review  | `VerificationCaseState` |
| `ADMIN_PROVIDER_TRANSITIONS`    | `packages/contracts/src/admin/verification/`                    | Account standing | `ProviderProfileStatus` |

**No third, merged, "seven reviewer actions" table will be created.**

The 9B brief asked for seven reviewer actions as a single source of truth. The
seven exist, but they span both axes:

| Requested action  | Real home                        | Canonical name        |
| ----------------- | -------------------------------- | --------------------- |
| request changes   | case                             | `requestAction`       |
| resubmit / reopen | case (actor is the **provider**) | `submit`              |
| approve           | case                             | `approve`             |
| reject            | case                             | `reject`              |
| suspend           | **account**                      | `suspend`             |
| revoke            | case (withdraws the grant)       | `revoke`              |
| expire / renew    | case                             | `expire` / `reverify` |

Merging them would put "suspend this account" and "reject this evidence" behind
one enum whose source states come from two vocabularies. That is the D-3 defect
(`docs/sprint-09/INSPECTION.md`) in a new costume: one authority covering two
rules, drifting against both. The admin UI once offered Approve on a `DRAFT`
provider and the server answered 409 — that is what a second copy of a rule
costs, and a merged table is a second copy of two rules at once.

## Lifecycle 1 — the verification case (evidence)

Eight actions. `actor` is who may drive the edge; `reason` marks the edges that
refuse to run without a reason code.

| Action          | From                                        | To                | Actor    | Decision outcome    | Reason |
| --------------- | ------------------------------------------- | ----------------- | -------- | ------------------- | ------ |
| `submit`        | `DRAFT`, `ACTION_REQUIRED`                  | `SUBMITTED`       | provider | —                   | no     |
| `assign`        | `SUBMITTED`, `IN_REVIEW`                    | `IN_REVIEW`       | reviewer | —                   | no     |
| `requestAction` | `SUBMITTED`, `IN_REVIEW`                    | `ACTION_REQUIRED` | reviewer | `ACTION_REQUIRED`   | yes    |
| `approve`       | `SUBMITTED`, `IN_REVIEW`                    | `VERIFIED`        | reviewer | `APPROVED`          | yes    |
| `reject`        | `SUBMITTED`, `IN_REVIEW`, `ACTION_REQUIRED` | `REJECTED`        | reviewer | `REJECTED`          | yes    |
| `reverify`      | `VERIFIED`                                  | `EXPIRED`         | reviewer | `REVERIFY_REQUIRED` | yes    |
| `expire`        | `VERIFIED`                                  | `EXPIRED`         | system   | `EXPIRED`           | no     |
| `revoke`        | `VERIFIED`                                  | `EXPIRED`         | reviewer | `REVOKED`           | yes    |

```
                 submit
   DRAFT ─────────────────────────► SUBMITTED ◄────────────┐
                                      │  │                 │
                              assign  │  │ requestAction   │ submit
                                      ▼  ▼                 │
                                 IN_REVIEW ──────► ACTION_REQUIRED
                                      │  │                 │
                            approve   │  │ reject          │ reject
                                      ▼  ▼                 ▼
                                 VERIFIED     REJECTED ◄────┘   (terminal)
                                      │
             expire | revoke | reverify
                                      ▼
                                  EXPIRED     (terminal)
```

Terminal states are `REJECTED` and `EXPIRED`; nothing leaves them. Re-verifying
opens a **new case** rather than reopening the old one — a provider who was
verified on a date _was_ verified on that date, and editing the record to say
otherwise fabricates history.

Notice `submit` is the same edge from `DRAFT` and from `ACTION_REQUIRED`.
Resubmission is not a special case and gets no second code path.

## Lifecycle 2 — the provider account (standing)

| Action       | From                                             | To          |
| ------------ | ------------------------------------------------ | ----------- |
| `approve`    | `PENDING_REVIEW`                                 | `ACTIVE`    |
| `reject`     | `DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `SUSPENDED` | `REJECTED`  |
| `suspend`    | `ACTIVE`                                         | `SUSPENDED` |
| `reactivate` | `SUSPENDED`                                      | `ACTIVE`    |

`DRAFT` is deliberately **not** approvable: a DRAFT profile has never been
checked against the onboarding completeness policy, so approving one activates
a provider with no headline, no service area and no categories.

## How the two axes meet, and where they must not

They share two state **names** and nothing else:

```
VerificationCaseState   DRAFT  SUBMITTED  IN_REVIEW  ACTION_REQUIRED  VERIFIED  REJECTED  EXPIRED
ProviderProfileStatus   DRAFT  PENDING_REVIEW  ACTIVE  SUSPENDED  REJECTED
                        ^^^^^                                     ^^^^^^^^
```

`DRAFT` and `REJECTED` mean different things on each. A DRAFT _case_ is
unsubmitted evidence; a DRAFT _account_ has never finished onboarding. Any code
that compares a state without knowing which axis produced it is wrong for
exactly these two values. The spec pins the overlap set to `['DRAFT',
'REJECTED']` so a third shared name forces the conversation rather than sliding
in.

Both helpers **fail closed** on a foreign state: `availableCaseActions('ACTIVE',
…)` returns `[]`, and `availableAdminProviderActions('SUBMITTED')` returns `[]`.
A miswired call offers nothing rather than something.

## Actor and permission matrix

| Surface                                                            | Guard today                                                | Axis        |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ----------- |
| `POST /v1/admin/providers/:id/{approve,reject,suspend,reactivate}` | `JwtAuthGuard` + `RolesGuard('admin')` + `CsrfGuard`       | account     |
| `GET /v1/admin/providers/:id/verification`                         | `RolesGuard('admin')`                                      | case (read) |
| Restricted evidence read                                           | `verification:evidence:view`, resolved **per request**     | case (read) |
| Case mutations (9B.2)                                              | `verification:decide` — **not yet referenced by any code** | case        |

Two permissions are seeded and deliberately distinct:

- `verification:evidence:view` — open a restricted identity document. Held
  separately so "who looked at this passport?" does not answer "anyone on the
  team".
- `verification:decide` — approve/reject/otherwise decide a case. A trainee
  reviewer may need to read documents without authority to decide.

Both are seeded onto `admin` today because `admin` is the only admin role.
Splitting them onto a dedicated reviewer role is a Product/Security decision,
recorded here rather than guessed at.

**Self-review is excluded at discovery**, not only at mutation — the case
service already omits a reviewer's own case from what it offers them.

## Verification is not work access

Four independent axes decide what a provider may do (`docs/adr/0005`). Two of
them are routinely confused:

| Concept            | Column / table                      | Means                                         |
| ------------------ | ----------------------------------- | --------------------------------------------- |
| Verification state | `ProviderProfile.verificationState` | Did a human check identity documents?         |
| Work-access grant  | `ProviderWorkAccessGrant`           | Is this provider allowed to work _right now_? |

They are separate because a grant can exist without verification and must:

```
ProviderWorkAccessSource
  VERIFIED_DOCUMENTS   issued by an approved case
  LEGACY_BACKFILL      approved under the OLD single-status process — identity
                       NEVER checked. Grants access; claims no verification.
  MANUAL_OVERRIDE      an operator decided, on the record
  RENEWAL              a continuation
```

`LEGACY_BACKFILL` is the whole reason the axes cannot be collapsed. The Sprint 7
backfill wrote **every** legacy provider as `UNVERIFIED` — including the
approved ones — because an admin clicking approve is not evidence that anyone
saw a document. Writing `VERIFIED` there would have fabricated an audit trail
for the entire existing supply side.

Liveness is a **time predicate evaluated in SQL**, never a status column:

```sql
revokedAt IS NULL
  AND status = 'ACTIVE'
  AND now() BETWEEN grantedAt AND COALESCE(expiresAt, 'infinity')
```

So expiry needs no writer. A nightly sweep that fails cannot leave access
granted that nobody authorised.

## Commercial standing buys nothing

**`VIP` and `Featured` do not exist in this codebase.** Zero occurrences across
`apps/api/src`, `packages/contracts/src`, `packages/database/prisma` and
`apps/web/src`. The commercial axis that _does_ exist is:

```
ProviderSubscriptionTier   NONE  BASIC  PRO  ELITE
```

Rank 8 of the capability service is titled _subscription / recognition_ and
**never grants and never denies**. Two proofs, deliberately of different kinds:

- behavioural — `provider-capability.service.spec.ts` flips `verified`,
  `topPro` and `subscriptionTier` and expects an identical capability set;
- structural — `canonical-axes.spec.ts` asserts the capability service source
  never _reads_ those fields, and that no tier value appears in
  `ProviderVerificationState`, `ProviderWorkAccessSource` or
  `VerificationCaseState`. A service cannot be influenced by what it never
  selects.

If a VIP or Featured concept is introduced later it must be a fifth axis with
the same property, not a value smuggled into one of these enums.

## Capability precedence (the one decision point)

`ProviderCapabilityService` is the only thing allowed to answer "what may this
provider do". Deny by default; first deny wins; rank 0 is absolute.

| Rank | Gate                | Effect                                                                                              |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------- |
| 0    | Account eligibility | Suspended/locked/deleted/inactive → **all denied**, profile not even loaded                         |
| 1    | No provider profile | All denied                                                                                          |
| 2    | `TERMINATED`        | Read own profile only                                                                               |
| 3    | `SUSPENDED`         | Read + appeal                                                                                       |
| 4    | `RESTRICTED`        | Existing obligations only — bookings and earnings survive, because cutting them punishes the seeker |
| 5    | Onboarding          | Incomplete → may complete and submit, nothing else                                                  |
| 6    | Verification        | **Flagged** `VERIFICATION_ENFORCED`                                                                 |
| 7    | Work access         | **Flagged** `WORK_ACCESS_ENFORCED`                                                                  |
| 8    | Subscription        | Never grants, never denies                                                                          |

`UNDER_REVIEW` is deliberately not a restriction: an investigation that has not
concluded must not silently take away someone's livelihood.

## Transaction boundaries (the contract 9B.2 must honour)

Approval is **one** transaction or none of it:

1. `VerificationDecision` row (append-only);
2. case transition, as a **conditional UPDATE scoped to the legal `from` set** —
   a row that moved under the reviewer produces 409, not a second decision;
3. `ProviderProfile.verificationState` transition;
4. `ProviderWorkAccessGrant` create/activate;
5. immutable audit row;
6. notification;
7. outbox event.

Constraints that make this enforceable already exist in the schema: a partial
unique index refuses a second LIVE grant for the same `(provider, reason)`, and
a CHECK refuses a grant that expires before it begins. Retry safety therefore
comes from the database, not from application bookkeeping.

Suspension, revocation and expiry must remove working capability **immediately**
— which they do for free, because liveness is the SQL time predicate above
rather than a cached flag.

The seed's own transaction budget is stated explicitly (`maxWait: 30_000,
timeout: 120_000`); Prisma's 5 s interactive default is sized for a web request,
not a bootstrap routine.

## Rollout and feature flags

| Flag                    | Default | Meaning when ON                                                 |
| ----------------------- | ------- | --------------------------------------------------------------- |
| `VERIFICATION_ENFORCED` | `false` | Rank 6 denies work unless `verificationState === 'VERIFIED'`    |
| `WORK_ACCESS_ENFORCED`  | `false` | Rank 7 consults the grant instead of the legacy `ACTIVE` status |

Both remain **off** until the full 9B workflow is verified end to end.

OFF reproduces the pre-Sprint-9 rule _exactly_ — the legacy status gate — so
turning a flag off is a true rollback rather than a third behaviour. The
backfill migration `20260824084700` refuses to complete unless every working
provider holds a live grant, precisely so `WORK_ACCESS_ENFORCED` cannot be armed
against a state that would lock out the supply side.

## Migration and rollback

9B.1 adds **no migration**. The schema landed in 9A; what is missing is
application write code, not tables.

Rollback for this phase is `git revert` of its commits. The two behavioural
changes it does make:

| Change                     | Rollback         | Blast radius                                             |
| -------------------------- | ---------------- | -------------------------------------------------------- |
| Seed transaction budget    | revert `29691b1` | Seed reverts to the 5 s default it was already exceeding |
| `.gitattributes` LF policy | revert `57366dc` | Working-tree line endings only; no blob changes          |

## UI reuse

The inventory and REUSE/EXTEND/CREATE decisions already live in
`docs/sprint-09b/UX-UI-COMPONENT-AUDIT.md` (17 decisions) and are not restated
here. What 9B.1 adds is one binding constraint on every later phase:

**The client renders `availableActions` and owns no transition rule.**

`canonical-axes.spec.ts` enforces it by scanning every `.ts`/`.tsx` under
`apps/web/src` and failing if any _import_ names `ADMIN_PROVIDER_TRANSITIONS`,
`VERIFICATION_CASE_TRANSITIONS`, `availableAdminProviderActions` or
`availableCaseActions`. Comments naming them are fine — documentation is not a
second copy of a rule. The scan asserts it found more than 100 files, so a
broken path cannot make the guardrail pass by scanning nothing.

## Threat-model delta for 9B.1

The standing model is `docs/sprint-09/THREAT-MODEL.md`. This phase exposes no
new surface — it adds no route, no field and no permission — so the delta is
limited to invariants:

| Invariant added                           | Threat it closes                                            |
| ----------------------------------------- | ----------------------------------------------------------- |
| Axes fail closed on foreign states        | A miswired call offering an action the other axis allows    |
| Client owns no transition rule            | Privilege inference / drift in the browser (the D-3 defect) |
| Tier vocabulary disjoint from work access | "ELITE" ever being compared against a verification state    |
| Grant sources enumerated and pinned       | A paid tier quietly becoming a grant justification          |

Unchanged and still true: `verification:decide` is referenced by **zero** code
sites, because case mutations do not exist yet. Nothing can currently create a
case, attach a document, record a decision or issue a grant from evidence.

## What 9B.1 does not decide

- Whether `verification:decide` gets its own reviewer role — Product/Security.
- The redacted-preview granularity — needs a typed dynamic setting (9B.2+).
- Any legal document requirement per country. Requirements come from versioned
  `VerificationRequirementPolicy` rows, never from hard-coded constants.
