# Sprint 9B.23 — Task 6: review, versioned terms, recovery, atomic submission

V2 Task 6 behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**.

**No schema change and no migration.** The submission machinery, the consent
columns, the policy snapshot and the audit event all already existed. This
sprint added one read-model, fixed two defects in what was already there, and
replaced the summary-card screen.

---

## 1. The inventory, and the one thing the brief assumed that does not exist

| Question                                             | Answer                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a 9B.15 server resolver to reuse?           | **No.** 9B.15 was never delivered. No `onboarding/hub` route, no `ProviderOnboardingHubView` anywhere in `apps/api/src` — re-verified here. |
| Does `submit()` already have optimistic concurrency? | Yes. `body.version !== draft.version` → 409.                                                                                                |
| Is there a policy snapshot?                          | Yes. `ProviderOnboardingSubmission` with `policyVersion` + `snapshot`.                                                                      |
| Does submitting grant anything?                      | No, and deliberately so: `verified`, `verificationState`, `standingState` untouched, no grant row, `status` → PENDING_REVIEW not ACTIVE.    |
| Is consent versioned?                                | Yes. `provider_consent_policy_version` (a PlatformSetting); stale versions already refused; `acceptedConsentVersion` + `consentAcceptedAt`. |
| Was the submission idempotent?                       | **No — see §3.** It looked idempotent and was not.                                                                                          |
| Was the audit trail complete?                        | **No — see §3.** It recorded three facts that were silently dropped.                                                                        |

The brief's first required item was "reuse the 9B.15 server resolver". There
was nothing to reuse, so the resolver was built here — over the rules that
already exist, not beside them.

---

## 2. The read-model

`GET /v1/me/provider/onboarding/review`. `buildReview` is a **pure function**
and restates nothing:

- every blocker is an issue `evaluateOnboarding()` produced;
- its owning step is the one `stepForField()` already chose;
- `canSubmit` is `issues.length === 0 && terms.accepted` — the policy's own
  verdict, **not** "the blocking group looks empty", which is the same
  statement one refactor away from being computed from a list the UI can
  influence.

The response carries `field` + `code` + `taskId`, **never prose**. A server
that sent the sentence would decide the app's language and make every copy
change a backend deploy. `STEP_TO_V2_TASK` maps the wizard's nine steps onto
the hub's six tasks and is **total**, with a test that fails if a rule gains a
field with no screen — a blocker the provider cannot be sent to is the
"disabled button that cannot say what to do" wearing a different hat.

Four groups, and the distinctions are load-bearing:

| Group        | Rendered as                           | Why                                                                 |
| ------------ | ------------------------------------- | ------------------------------------------------------------------- |
| **BLOCKING** | amber card + **Complete now** link    | the provider has something to do                                    |
| **WAITING**  | neutral, informational, **no action** | it is with someone else; a button here would be a lie               |
| **OPTIONAL** | neutral advice                        | amber would make a suggestion look like a requirement               |
| **COMPLETE** | tick + step label                     | a screen listing nine problems and no progress reads as a rejection |

`blockedReason` is the **first** blocker in policy order — "the exact next
action", singular. A screen that says "8 things are wrong" has told the
provider nothing they can act on this minute.

---

## 3. Two defects the tests found, both real

### Duplicate submissions were possible

The state check at the top of `submit()` is a **fast path, not a guard**. Two
simultaneous requests both read `DRAFT` before either writes, so both passed it
and both wrote a submission row **and** an audit event: one application handed
in twice, which is exactly what a double tap or a retried request produces.

The pre-submit state now sits in the `WHERE` clause of a conditional
`updateMany` — the idiom `withdraw()` already uses. Postgres serialises the two
updates on the row; the winner sees `count === 1` and writes the submission,
the loser sees `0` and returns the existing outcome. The claim **is** the
transition, so there is no window between claiming and transitioning.

Proven with concurrent requests against real Postgres: exactly one
`ProviderOnboardingSubmission` and exactly one `PROVIDER_ONBOARDING_SUBMITTED`
audit event.

### The audit trail was dropping its three most important fields

`submit()` has recorded `newState`, `grantsWorkAccess` and
`grantsVerifiedBadge` since Sprint 8, with a comment saying the trail should
"say out loud what the transition did NOT do". None of the three was on
`ALLOWED_METADATA_KEYS`, so the sanitizer dropped all three and the event kept
only its `policyVersion`. **The comment described an intention, not the row.**

They are exactly what that allowlist is for — one enum-valued state and two
booleans, no free text — and they are the facts a reader needs six months later
to answer "did handing this application in grant anyone access?" without
inferring it from an absence.

---

## 4. Terms

Versioned already; this sprint made the version **visible and enforced at the
point of consent**.

- the review serves the **active** version and the locale's wording;
- `accepted` is `acceptedVersion === version` — **equality, never presence**, so
  a provider who agreed to v1 has not agreed to v2 and the tick does not
  survive the change;
- a stale acceptance produces a distinct code (`STALE_VERSION`) and its own
  sentence, rather than reading as "you never agreed";
- acceptance goes through the ordinary versioned `CONSENT` step — same write,
  same edit lock, same 409. There is deliberately **no** separate accept-terms
  endpoint: consent is a field of the application, and a second route would be
  a second way to write the same column.

The version the client sends is the one the **server just served**. A client
that chose its own could record agreement to wording it never displayed.

---

## 5. Readiness is refreshed immediately before submit

The review on screen may be minutes old — another tab could have edited the
draft, or an operator could have published new terms. So the submit handler
**re-fetches the review first** and submits the `draftVersion` that comes back.
Submitting the version that was rendered would hand the server a token it has
to reject, and the provider would see a 409 they did nothing to cause.

A 409 that still happens is surfaced as "reread and resubmit", not as a
failure.

---

## 6. The sticky container is `sticky`, not `fixed`

`position: fixed` is taken out of flow, so it sits **on top of** the last rows
and — on iOS — is shoved upward by the on-screen keyboard. That is precisely
the "covering content / fighting the keyboard" the task names.

`position: sticky` participates in layout: content scrolls under it only while
there is more to scroll, the last row stays reachable, and the keyboard pushes
the viewport rather than the bar. `padding-bottom: calc(0.75rem +
env(safe-area-inset-bottom, 0px))` keeps it clear of the home indicator.

Asserted in a **real browser**, because jsdom's CSS parser drops `calc()`
containing `env()` outright — React writes inline styles through the CSSOM, so
the attribute reads `bottom: 0px` and a passing unit assertion would only prove
jsdom discarded the rule.

---

## 7. Evidence

| Gate                                      | Result                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| api lint / typecheck / build              | pass                                                 |
| resolver unit spec                        | 19 passed                                            |
| **review + submit integration (real PG)** | **18 passed**                                        |
| wizard service spec                       | 94 passed (2 added for the conditional claim)        |
| api hermetic suite                        | 2932 passed, 0 failed                                |
| web lint                                  | 0 errors (32 pre-existing warnings)                  |
| web typecheck / production Rollup build   | pass                                                 |
| web unit                                  | **1319 passed / 94 files** (+30)                     |
| Playwright (this task, phone viewport)    | **15 passed**, 30 skipped as declared viewport gates |

### The local gated suite is NOT green, and it is not this branch

The full DB-gated API run fails ~6 suites on this machine — **and so does
unmodified `develop`**, which is 14/14 green in CI. Root-caused to a **~5s
host↔container clock skew**: `availableAt` is written with host time while the
claim query compares against Postgres' `now()`, so freshly enqueued rows are
not claimable for five seconds. The Windows time service reports
`Leap Indicator: 3 (not synchronized)` and `w32tm /resync` needs elevation.

Baseline after a Docker/WSL restart: `develop` = **3454/3456 passing in 158s**
(from 286s), failing only 2 timing-sensitive outbox tests — and a _different_
2 between runs.

CI is the authority for the full gate.

---

## 8. Not in scope

- **The 9B.15 hub endpoint.** Still missing, so the composed V2 journey still
  cannot run against a real API and every V2 Playwright spec stubs it. Building
  it remains the highest-value unblock in 9B.
- **A terms document store.** The version is the legal artefact and is
  recorded; the wording itself still lives outside the platform.
