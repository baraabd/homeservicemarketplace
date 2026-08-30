# Provider Onboarding V2 — release record

Sprint 9B.26. The operational record for the V2 onboarding surface built across
9B.16–9B.25.

**Production default: OFF.** `VITE_PROVIDER_ONBOARDING_V2` is not set in any
config in this repository, and every unrecognised value — missing, empty,
`"false"` — reads as off.

---

## 1. Architecture

V2 is a **presentation change**. It adds no domain rule, no capability and no
write path of its own.

```
V1 wizard  ─┐
            ├─► the SAME versioned draft ──► the SAME server policy
V2 tasks   ─┘        (ProviderOnboardingDraft.version)      (evaluateOnboarding)
```

Both surfaces call the same endpoints, write through the same optimistic
concurrency token, and are refused by the same guards. That is what makes the
rollback in §7 a flag flip rather than a migration.

| Piece                     | Owner                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Completeness rules        | `evaluateOnboarding()` — server, one copy                   |
| Step ownership of a field | `stepForField()` — server                                   |
| Review groups / blockers  | `buildReview()` — pure projection over the above            |
| Hub task list / progress  | `buildHub()` — the same policy, same STEP_TO_V2_TASK map    |
| Case transitions          | `case-transitions.ts` — one table, `offerableCaseActions`   |
| Marketplace access        | `ProviderCapabilitiesResponse` — a separate contract        |
| Autosave                  | `useOnboardingStepAutosave` — one hook, one status renderer |

---

## 2. The state axes, and why they stay apart

Five axes, never collapsed (ADR 0005):

| Axis                  | Answers                                | Set by                       |
| --------------------- | -------------------------------------- | ---------------------------- |
| Onboarding            | did they finish the form?              | the provider                 |
| Identity verification | did a reviewer accept their documents? | a reviewer                   |
| Work access           | may they take work **right now**?      | a grant                      |
| VIP                   | paid tier                              | billing — **grants nothing** |
| Featured              | editorial                              | ops — **grants nothing**     |

The two that get confused are verification and work access. A provider can be
verified and unable to work (grant revoked or expired), and the UI says so in
two different sentences — `VERIFIED_NO_ACCESS` says the documents stand and
more of them will not help; `REVERIFICATION_REQUIRED` says send fresh ones.
Before 9B.24 these were one state with one sentence, and it told the first group
to do something that could not have worked.

**Submitting grants nothing.** Asserted end-to-end: `verified`,
`verificationState` and `standingState` untouched, no grant row, legacy `status`
→ `PENDING_REVIEW` and never `ACTIVE`. The audit row records
`grantsWorkAccess: false` and `grantsVerifiedBadge: false` explicitly, so the
absence is stated rather than inferred.

---

## 3. Security and privacy boundaries

- **Evidence and portfolio media never cross.** Refused at write on the storage
  key (`assertPublishableKey`), filtered at read on `visibility`, and the public
  `/v1/media/files/*` route 404s any `verification/` key. Proven by forcing an
  `APPROVED` portfolio item onto a `RESTRICTED` asset in a real database.
- **The public projection is an allowlist type**, not a filter: it has nowhere
  to put a phone number, a coordinate, a storage key or an internal id.
- **Reviewer prose never reaches the provider** — a reason _code_ does.
- **A profile write cannot grant anything.** A patch carrying `verified` or
  `verificationState` is refused 400 by `forbidNonWhitelisted`, not silently
  dropped.
- **Coordinates are snapped**, never jittered — jitter averages out under
  repeated sampling; a 25 km grid cell does not.

---

## 4. Analytics

**None ships.** No provider-side event tracking exists in this codebase. There
is therefore nothing to allowlist and nothing to leak, and that is the honest
statement rather than a passed criterion. See 9B.25 §6.

---

## 5. Migration and compatibility

V2 introduces **no migration**. Drafts written by the V1 wizard are read by V2
directly, and this is now tested against a real database
(`onboarding-review-submit.integration.spec.ts`, "a legacy V1 draft opens in V2
without losing anything"):

- a legacy row — every V2-era field NULL — **serves a review rather than
  throwing**;
- the newly required fields appear as **blockers with a task id each**, so a
  legacy provider is mid-application rather than stuck;
- **every field V1 collected survives** — name, headline, bio, phone, city,
  radius;
- a V2 write **completes** the row rather than replacing it;
- the review reports **the same draft version V1 would**, so a provider bounced
  back to the wizard resumes exactly where they were.

---

## 6. Rollout cohorts

All four stages use mechanisms that already exist. None needs a deploy to
reverse.

| Stage              | Mechanism                                                          | Reversal        |
| ------------------ | ------------------------------------------------------------------ | --------------- |
| 1. Internal / test | `localStorage['hsm.ff.providerOnboardingV2'] = 'true'` per browser | clear the key   |
| 2. Limited market  | `VITE_PROVIDER_ONBOARDING_V2=true` on one regional deployment      | unset, redeploy |
| 3. Expanded        | same, more deployments                                             | same            |
| 4. GA              | flag on by default, V1 retained                                    | flip back       |

The per-browser override wins **in both directions**, so an internal tester can
opt out of a deployment that has it on, and a support engineer can reproduce a
provider's V2 view without changing anything server-side.

**Stage 1 needs no deploy at all**, which is why it is the right place to start.

---

## 7. Rollback

**Disable the flag. That is the whole procedure.**

No database rollback, no migration reversal, no data movement. Both surfaces
write the same versioned draft through the same endpoints, so a provider who
was mid-application in V2 continues in V1 at the same draft version — tested,
§5.

What rollback does **not** undo, by design: a submitted application stays
submitted, an accepted decision stays accepted, and the audit trail is
immutable. Rollback is a UX rollback.

---

## 8. Monitoring

Existing signals, no new ones:

- `provider.onboarding.wizard.submitted` / `.withdrawn` structured logs;
- `PROVIDER_ONBOARDING_SUBMITTED` audit events — now carrying `newState`,
  `previousState`, `grantsWorkAccess`, `grantsVerifiedBadge` (all four were
  silently dropped by the audit allowlist before 9B.23/9B.24);
- `marketplace.preview.served` — shape of the disclosure, deliberately no PII;
- outbox depth and dead-letter count for `request.available`.

**Watch first after enabling a cohort:** the ratio of `submitted` to
`withdrawn`, and 409 rates on `PATCH /onboarding/steps/*` — a spike in either
means the autosave conflict path is being hit more than a two-tab edge case
should produce.

---

## 9. Support playbook

| Report                                        | Likely cause                                                   | Action                                             |
| --------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| "It says my work was not saved"               | autosave conflict — another tab                                | reload; the server copy is authoritative           |
| "I am offline and it says keep the page open" | correct — pending edits are in memory only                     | keep the tab open; do not reload                   |
| "I finished everything and cannot submit"     | a blocker with no screen, or stale terms                       | read `blockedReason` from `GET /onboarding/review` |
| "I am verified but cannot work"               | grant expired or revoked — **not** a document problem          | check work-access grant; do not ask for documents  |
| "I want to fix something after submitting"    | withdraw is offered only from SUBMITTED / DOCUMENTS_REQUIRED   | withdraw preserves the draft and history           |
| Provider sees V1 unexpectedly                 | flag off for that deployment or overridden off in that browser | check `localStorage` first                         |

---

## 10. Known deferrals

Carried forward, each recorded where it was found:

1. ~~**The 9B.15 hub endpoint does not exist.**~~ **CLOSED.**
   `GET /v1/me/provider/onboarding/hub` is implemented and served, with unit
   coverage and integration tests that drive the real route over HTTP against
   real Postgres and the real guards. See §1.
   ~~**Still open:** no browser-level test drives the hub against a real API.~~
   **Also closed** — see §12.
2. **No automated accessibility checks** (no axe) — 9B.25 §6.
3. **No analytics** — §4.
4. **No code splitting**: one 1842 KB chunk, `leaflet` and `recharts` eager —
   9B.25 §5.
5. **Withdrawal shares the `PROVIDER_ONBOARDING_SUBMITTED` audit type**,
   distinguishable only by metadata — 9B.24 §4.
6. **No portfolio moderation workflow** — nothing writes `APPROVED`, so the
   public projection is always empty. Reported honestly on screen — 9B.22 §4.
7. **No public provider-profile route** — the projection exists, nothing serves
   it to customers — 9B.22.
8. **No SLA copy**, because no operational SLA data exists — 9B.24 §5.

---

## 11. Repository gate

**Neither `develop` nor `main` has branch protection.** No required status
checks, no required reviews, no admin enforcement. Every merge so far has been
green by choice, not by enforcement — a red PR can be merged today.

Reported, not changed: repository settings were not modified, and doing so needs
explicit authorization.

**Recommended before GA:** require the `CI gate` and `CodeQL` checks on
`develop` and `main`.

---

## 12. Browser-to-API coverage (Sprint 9B.27)

The release gap named in §10.1 is closed. `provider-onboarding-v2-real-api.spec.ts`
drives the journey with **no interception at all**:

```
Chromium → the built SPA (VITE_PROVIDER_ONBOARDING_V2=true baked in)
        → the real API (node dist/main.js)
             → real Postgres, real Redis, all 52 migrations, real guards
```

15 scenarios × 3 viewports (375 / 768 / 1440). It proves the flag in both
directions, that the hub renders **the state the server computed**, that a task
typed in the browser reaches Postgres and survives a reload, deep links, the
login return path through the real form and OTP screen, that review blockers
agree with hub statuses, that terms gate submission, that a submission
persists, and that the public projection carries no private field.

**Why this was worth building rather than deferring again.** The suite is what
found the two defects below; six sprints of stubbed specs found neither, and
could not have. A spec that fulfils the endpoint under test cannot fail when
that endpoint is missing — which is exactly what happened between 9B.16 and
9B.26, while `GET /onboarding/hub` returned 404 in every real deployment.

**Two defects it caught:**

1. **The consent deadlock.** `CONSENT` maps to `REVIEW_SUBMISSION`, and the
   hub blocked that task on any requirement it owned — including unaccepted
   terms. But terms are accepted **on the review screen**. A provider with all
   five collecting tasks complete saw five green rows, a locked sixth reading
   "Finish the tasks above first", and no way to submit. Fixed: only the five
   collecting tasks gate entry to review, and `nextAction` reports
   `COMPLETE_TASK: REVIEW_SUBMISSION` rather than a `SUBMIT` the server would
   refuse. The lying button is prevented where it lives — Submit stays disabled
   on the screen, beside the server's own `blockedReason`.

2. **A stale session after `POST /me/provider/upgrade`** — open, not fixed.
   `RolesGuard` reads roles from the access token; `upgrade` grants the
   provider role in the database without reissuing one. So a newly promoted
   provider gets **403 on every provider route until their session refreshes**.
   The harness reproduces it rather than hiding it (`registerProvider` refreshes
   explicitly, and says why). Worth fixing before rollout stage 2: the
   fresh-signup path is the one cohort most likely to hit it.

### Running it

Needs a real stack on isolated ports — a Postgres, a Redis, a mail catcher, the
API, and a preview build with the flag baked in:

```bash
# API on 4011 against isolated Postgres/Redis, SMTP → the mail catcher
# web:  vite build with VITE_PROVIDER_ONBOARDING_V2=true VITE_API_URL=…:4011
#       then vite preview on 4174
E2E_REAL_API=http://127.0.0.1:4011 \
E2E_MAILPIT=http://127.0.0.1:28025 \
E2E_BASE_URL=http://127.0.0.1:4174 \
  pnpm --filter @homeservicemarketplace/web exec playwright test \
    e2e/provider-onboarding-v2-real-api.spec.ts --workers=3
```

`playwright.config.ts` excludes the file by `testIgnore` when `E2E_REAL_API` is
unset, on the same reasoning as `auth-cookies.spec.ts`: an integration-critical
spec that silently skips is worse than one that is visibly absent.

**Two things the harness had to get right, both real constraints rather than
test plumbing:**

- **The seeded admin mailbox is shared.** A specialty is an _application_, not
  a grant — the review reports `AWAITING_REVIEW` until an admin approves it —
  so the harness signs in as an admin. Two workers signing in as the same admin
  produce two codes in one mailbox, and one worker verifies a challenge it does
  not own. Each worker takes its own seeded admin, by `TEST_PARALLEL_INDEX`.
- **Postgres advisory locks are cluster-wide, not per-database.** Running this
  stack and the API integration suite against the same Postgres _instance_ — even
  in different databases — makes the API's background sweeps contend with the
  suite's isolation locks, and suites time out at 120s in a different place each
  run. Give them separate instances, not separate databases.
