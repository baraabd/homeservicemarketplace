# Sprint 9B.24 — post-submission status, actions, and withdrawal

**No schema change and no migration.** Nearly everything this task needed was
already built across 9B.2–9B.23. The work was composition, three gaps closed,
and one audit defect fixed.

---

## 1. The inventory, and what it found already built

| Question                                    | Answer                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Is there a canonical action resolver?       | **Yes.** `offerableCaseActions(state, actor)` — legal _and_ backed by a working command.                 |
| Are the axes already separate?              | **Yes, structurally.** The verification case and `ProviderCapabilitiesResponse` are different contracts. |
| Does the provider view leak reviewer prose? | **No.** It has carried `reasonCode` and never `reviewerNotes` since 9B.11.                               |
| Is self-review refused?                     | **Yes**, with `reason: 'SELF_REVIEW'`, and already covered by an integration test.                       |
| Are decisions atomic and race-safe?         | **Yes.** Concurrent approvals → one decision and one grant; approve-vs-revoke → one coherent outcome.    |
| Is there a withdrawal command?              | **Yes**, `withdraw()`, already scoped by a conditional `updateMany`.                                     |
| Is there SLA data to quote?                 | **No.** No setting, no configuration, nothing operational — see §5.                                      |
| Was the provider told its allowed actions?  | **No.** The reviewer surface has been since 9B.5; the provider surface derived buttons from state.       |

Most of the brief's required tests **already existed**. Adding a second copy of
them would have been noise, so this sprint added only what was missing.

---

## 2. The provider is now told what it may do

`ProviderVerificationCase` gains `availableActions`, computed by the same
`offerableCaseActions` the reviewer surface uses, with `actor: 'provider'`.

That is the D-3 lesson written into `case-transitions.ts` applied to the other
audience: the admin table once offered an **Approve** button the backend
answered with a 409, because two copies of one rule had drifted. The provider
screen was deriving its submit button from `READY_TO_SUBMIT` — this client's
reading of the evidence — which is the same shape of defect waiting to happen.

**A separate vocabulary, deliberately.** `ProviderVerificationCaseActionCode`
is `'submit'` and nothing else. Reusing the reviewer's
`VerificationCaseActionCode` would have made `approve` and `reject`
_type-reachable_ from the provider surface — the compiler would have stopped
objecting to exactly the confusion these contracts exist to prevent. The
compiler caught the first attempt to do this.

Asserted for every state, including that a provider is **never** offered
`approve`, `reject`, `requestAction`, `revoke`, `reverify` or `assign`.

---

## 3. Expiry is not the same as having no access

`EXPIRED` used to derive to `VERIFIED_NO_ACCESS`. Both mean "cannot work", but
only one means the provider can **do** something about it.

Worse, the copy attached to the collapsed state read _"send fresh documents"_ —
so a provider whose **grant** was revoked was told to upload documents that
would not have helped them. Now:

| State                     | What is true                                   | What it says                                |
| ------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `REVERIFICATION_REQUIRED` | the case expired; a **new case** is the answer | "Your verification needs renewing"          |
| `VERIFIED_NO_ACCESS`      | documents stand; the **grant** ended           | "Sending more documents will not change it" |

---

## 4. Withdrawal

Offered from `canWithdraw` on the review read-model, computed from
`WITHDRAWABLE_STATES` — **the same states `withdraw()` scopes its conditional
write to**. The offer and the command cannot drift, so the button never appears
for a state the server would refuse.

Proven against real Postgres:

- the draft data survives — display name, bio, headline, city, experience **and
  the consent already given**;
- the submission history survives: still exactly one
  `ProviderOnboardingSubmission` row afterwards;
- resubmitting produces a **second** row, so the history grows rather than
  being rewritten;
- **the race**: if a reviewer accepts first, withdrawal returns 409 and the
  acceptance stands. Deterministic because the pre-withdrawal states live in
  the command's `WHERE` clause rather than in a prior read;
- two concurrent withdrawals produce exactly one transition.

Withdrawal is never described as deleting or resetting.

### An audit defect found on the way

`withdraw()` has recorded `previousState` since Sprint 8. It was **not on the
audit allowlist**, so the sanitizer dropped it and the row could say an
application reached `DRAFT` but not what it was pulled back _from_. Same class
as the three fields fixed in 9B.23, and fixed the same way.

> **Known, not fixed here:** withdrawal is still recorded under the
> `PROVIDER_ONBOARDING_SUBMITTED` event type, distinguished only by
> `metadata.outcome === 'withdrawn'`, because `AuditEventType` has no member for
> it. It is distinguishable but not queryable by type. Fixing it means an enum
> value and a migration; it is recorded here rather than quietly accepted.

---

## 5. No SLA copy, because there is no SLA data

The brief asks for qualified SLA copy **from configured operational data**.
There is none — no setting, no policy field, no measured turnaround anywhere in
the codebase. So none is shown. An invented "usually 2–3 days" is a promise the
platform has not made and cannot keep.

What ships instead is what is true and available: `submittedAt` ("what I did")
and `updatedAt` ("has anything happened since"), served separately.

---

## 6. Capability non-escalation

Asserted end-to-end rather than argued:

- a profile patch carrying `verified` / `verificationState` is **refused 400**
  by `forbidNonWhitelisted` — not silently dropped, which would let a client
  believe it had succeeded;
- the verification axis is unchanged after such an attempt;
- a legitimate profile write grants no work access;
- a full submission still grants nothing on either axis.

And the case response carries no grant, no work-access field and no capability
at all — asserted over the serialised body.

---

## 7. Evidence

| Gate                                    | Result                              |
| --------------------------------------- | ----------------------------------- |
| api lint / typecheck                    | pass                                |
| provider module unit suites             | 1535 passed                         |
| verification-case-workflow integration  | **57 passed** (+8)                  |
| onboarding review/submit integration    | **30 passed** (+12)                 |
| **full API suite, DB + Redis gates ON** | **188 suites, 3513 passed / 3517**  |
| web lint                                | 0 errors (32 pre-existing warnings) |
| web typecheck / production Rollup build | pass                                |
| web unit                                | **1320 passed / 94 files**          |

The 4 remaining API failures are `outbox.integration.spec.ts`, caused by a **~5s
host↔container clock skew** on this machine (`availableAt` is written with host
time; the claim query compares against Postgres' `now()`). They reproduce on
unmodified `develop` and pass in CI. See `docs/sprint-09b23/REVIEW_AND_SUBMIT.md`
§7. **CI is the authority for the full gate.**

---

## 8. Not in scope

- **A distinct audit event type for withdrawal** — §4.
- **SLA copy** — §5; blocked on operational data existing.
- **The 9B.15 hub endpoint**, still missing, so the composed V2 journey still
  cannot run against a real API.
