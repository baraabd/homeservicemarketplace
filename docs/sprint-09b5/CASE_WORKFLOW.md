# Sprint 9B.5 — Case submission, assignment, request-action and resubmission

The non-decision half of the verification workflow: how a case gets from a
provider's draft to a reviewer's desk and back again.

Deciding the case — approve, reject, expire, revoke — is deliberately **not**
here. See §7.

Related: `docs/adr/0013-evidence-to-work-access-capability-transition.md`,
`docs/adr/0010-policy-versioned-verification.md`,
`docs/sprint-09b4/EVIDENCE_SCANNING_AND_QUARANTINE.md`.

---

## 1. The transition table is the only authority

`case-transitions.ts` holds one table. Services act on it; the client is _told_
what is available and derives nothing. That file opens by describing D-3: the
admin provider-status table had drifted into three copies, and the UI offered an
Approve button the backend answered with 409.

| Action          | From                                  | To              | Actor    | Decision outcome  | Reason required | Implemented |
| --------------- | ------------------------------------- | --------------- | -------- | ----------------- | --------------- | ----------- |
| `submit`        | DRAFT, ACTION_REQUIRED                | SUBMITTED       | provider | —                 | no              | **yes**     |
| `assign`        | SUBMITTED, IN_REVIEW                  | IN_REVIEW       | reviewer | —                 | no              | **yes**     |
| `requestAction` | SUBMITTED, IN_REVIEW                  | ACTION_REQUIRED | reviewer | ACTION_REQUIRED   | yes             | **yes**     |
| `approve`       | SUBMITTED, IN_REVIEW                  | VERIFIED        | reviewer | APPROVED          | yes             | no (9B.7)   |
| `reject`        | SUBMITTED, IN_REVIEW, ACTION_REQUIRED | REJECTED        | reviewer | REJECTED          | yes             | no (9B.7)   |
| `reverify`      | VERIFIED                              | EXPIRED         | reviewer | REVERIFY_REQUIRED | yes             | no (9B.7)   |
| `expire`        | VERIFIED                              | EXPIRED         | system   | EXPIRED           | no              | no (9B.7)   |
| `revoke`        | VERIFIED                              | EXPIRED         | reviewer | REVOKED           | yes             | no (9B.7)   |

**`submit` covers resubmission.** It is the same edge, not a special case, so a
returned applicant does not travel a second code path.

---

## 2. The state × actor matrix, as the server offers it

Generated from the code, not written by hand.

| State           | Provider offered | Reviewer offered          | System offered | Legal but withheld       |
| --------------- | ---------------- | ------------------------- | -------------- | ------------------------ |
| DRAFT           | `submit`         | —                         | —              | —                        |
| SUBMITTED       | —                | `assign`, `requestAction` | —              | approve, reject          |
| IN_REVIEW       | —                | `assign`, `requestAction` | —              | approve, reject          |
| ACTION_REQUIRED | `submit`         | —                         | —              | reject                   |
| VERIFIED        | —                | —                         | —              | reverify, revoke, expire |
| REJECTED        | —                | —                         | —              | —                        |
| EXPIRED         | —                | —                         | —              | —                        |

Two things this table says out loud:

- **A provider is offered nothing while a reviewer holds the case.** Offering
  `submit` on SUBMITTED would let them overwrite a case someone is mid-way
  through reading.
- **The withheld column is not aspirational.** Those actions are legal in the
  domain and have no command behind them, so the server never offers them.

---

## 3. Legal ≠ implemented

`IMPLEMENTED_CASE_ACTIONS` is the list of actions with a working command.
`offerableCaseActions()` = legal ∩ implemented, and that is what any client is
given.

The distinction exists because the transition table describes the **domain** —
approve is legal from SUBMITTED and stays legal, because that is true of
verification regardless of what this codebase has finished. The allowlist
describes the **build**.

Two guards keep it honest:

- `offerableCaseActions` can only ever **withhold**; a test walks every
  state × actor cell and asserts the offered set is a subset of the legal one.
- A test pins exactly which actions are missing, so finishing one in a later
  sprint fails until the list is updated. The list cannot drift away from
  reality quietly.

This fixed a live defect: the reviewer case view was computing actions straight
from the table and offering `approve` on every SUBMITTED case, with no
case-level approve command anywhere. D-3, again, in its original form.

---

## 4. Submission readiness

Recomputed server-side at submission time. A client that posts "I have satisfied
everything" is ignored — it cannot see scan states.

Submission requires **all** of:

| Requirement                                   | Blocker when unmet                         |
| --------------------------------------------- | ------------------------------------------ |
| the state allows it                           | `WRONG_STATE`                              |
| every required document supplied              | `MISSING_EVIDENCE`                         |
| every required document's evidence is `CLEAN` | `EVIDENCE_NOT_CLEAN`                       |
| the profile is complete                       | `ONBOARDING_INCOMPLETE`                    |
| the current terms version is accepted         | `TERMS_NOT_ACCEPTED`                       |
| the caller owns the case                      | 404, indistinguishable from "no such case" |

**`MISSING_EVIDENCE` and `EVIDENCE_NOT_CLEAN` are different on purpose.**
"Upload a licence" and "the licence you uploaded has not cleared scanning yet"
have different fixes; collapsing them sends people to re-upload files that were
fine. The blocker carries the actual scan state so the UI can say which.

**All blockers are returned together**, except `WRONG_STATE`, which returns
alone — telling someone their documents are incomplete on a case a reviewer is
already holding invites them to act on a case they must not touch.

Two rules are **delegated rather than restated**: the state question goes to the
transition table, and profile completeness goes to `evaluateOnboarding`. Two
definitions of "complete profile" is how a provider passes one screen and is
refused by the next. Terms use the same `provider_consent_policy_version`
setting the onboarding wizard writes.

---

## 5. What every command guarantees

| Property        | How                                                                      |
| --------------- | ------------------------------------------------------------------------ |
| ownership       | provider commands resolve the case from the authenticated user           |
| non-enumerating | "not yours" and "no such case" are the same 404, asserted field by field |
| self-review     | refused at the command **and** hidden in the read model                  |
| idempotence     | a replay returns 200 with `changed: false`, no second write              |
| staleness       | `expectedState` is a concurrency token; mismatch is 409                  |
| concurrency     | `updateMany` pinned to the observed state                                |
| atomicity       | state + decision + audit + outbox + notification in one transaction      |

**Losing the race is not automatically an error.** If the winner did the same
thing, it is an idempotent replay and the caller is told the truth — two tabs,
one click each, must not produce an error the provider cannot act on. Anything
else is a 409.

`submitOwnCase` takes **no case id**: a provider has one live case, so making
them supply its id buys nothing and lets them name somebody else's. It resolves
the non-terminal case and lets `submit()` judge it. Filtering to _submittable_
states instead was a real bug — it made the idempotent replay unreachable, so a
double-click 404'd on a case that plainly existed.

---

## 6. Records, events and notifications

- **Decisions.** Only `requestAction` writes a `VerificationDecision`; a
  reviewer looked and judged. `submit` and `assign` write none — nobody judged
  anything, and rows for them would pad the permanent record with entries that
  answer no question an auditor asks.
- **Audit.** All three write an audit event.
- **Outbox.** `verification.case.submitted` and
  `verification.case.action_required`, with a consumer shipped alongside —
  `OutboxWorker` dead-letters unclaimed types, so a producer without a consumer
  is worse than no producer.
- **Notification.** Only on `requestAction`, and deliberately generic: it says
  something needs attention and deep-links to the provider's own verification
  screen. The reviewer's note lives on the **case**, which is access-controlled
  and dies with the evidence. Notifications are listed, cached and pushed to
  devices.

Metric labels are bounded to the state name. A per-case label would turn the
metrics endpoint into a list of who is under review.

---

## 7. What is deliberately absent

`approve`, `reject`, `reverify`, `expire` and `revoke` have no command.

Approval in particular is atomic across the case, the work-access grant and the
provider's status (ADR 0013). Shipping half of it — a case that says VERIFIED
with no grant behind it — is worse than shipping none, because the case would
then lie about what the provider can do. **Sprint 9B.7 owns it.**

---

## 8. Residual risks

- **No reviewer queue.** Assignment works; nothing lists what is waiting.
  Reviewers currently need a case id.
- **No SLA timer.** Nothing escalates a case that sits in SUBMITTED or
  ACTION_REQUIRED. The outbox events are the seam for it.
- **Terms default to no requirement.** `requiredConsentVersion()` returns null
  when the setting is absent, so submission does not demand consent until an
  operator configures a version. That is deliberate — inventing an obligation
  from a fallback would block every submission on a missing settings row — but
  it does mean the control is off until switched on.
