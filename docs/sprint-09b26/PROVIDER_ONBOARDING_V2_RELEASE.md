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

1. **The 9B.15 hub endpoint does not exist.** `GET /v1/me/provider/onboarding/hub`
   is called by the V2 client and has no server implementation. **Every V2
   Playwright spec stubs it.** This is the single largest gate on calling V2
   runtime-verified end to end, and it blocks rollout stage 2 onward.
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
