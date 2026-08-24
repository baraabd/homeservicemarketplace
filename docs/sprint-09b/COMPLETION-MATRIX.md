# Sprint 9B — completion matrix

Built by auditing **source and executable tests**, not by trusting the previous
checkpoint report. An item is COMPLETE only when it is wired, authorized,
exercised at the HTTP/UI boundary and inside a CI gate. Existence of a class,
DTO, table or route is not completion.

## Corrections to the inherited checkpoint description

| Claim                                                         | Reality                                                         | Evidence                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 11 commits ahead                                              | **13**                                                          | `git rev-list --count origin/develop..HEAD` = 13 |
| Worktree dirty: seed.ts +22, five untracked `evidence-read.*` | **Clean** — committed in `3c915fc`                              | `git status --short` empty                       |
| Merge base `207dc1b`                                          | Confirmed                                                       | `git merge-base`                                 |
| 9A intact at `f0d2772`                                        | Confirmed                                                       | `git rev-parse`                                  |
| Four unrelated stashes                                        | Confirmed, untouched                                            | `git stash list`                                 |
| API 1836 passed / 89 skipped                                  | Confirmed, **and the 89 skips have now been run** — see Phase 7 | serial run: 1925 passed, 0 skipped               |

## THE decisive finding

Only **one** of the seven Sprint 9A tables is ever written by application code.

| Model                           | `create`/`update`/`upsert` sites in `apps/api/src` |
| ------------------------------- | -------------------------------------------------- |
| `verificationAccessLog`         | **1**                                              |
| `verificationCase`              | **0**                                              |
| `verificationDocument`          | **0**                                              |
| `verificationDecision`          | **0**                                              |
| `mediaAsset`                    | **0**                                              |
| `providerPortfolioItem`         | **0**                                              |
| `verificationRequirementPolicy` | **0**                                              |

The read paths, policies and authorization are real and well tested. **There is
no write path at all.** No code can create a case, attach a document, record a
decision, or issue a grant from evidence. Everything downstream of "provider
uploads a document" is therefore MISSING rather than partial, and the admin
evidence panel currently renders a case that nothing can create.

`verification:decide` is seeded but referenced by **0** code sites, for the same
reason: the admin actions do not exist yet.

## Matrix

### Phase 1 — restricted evidence pipeline

| Item                                                     | State        | Evidence                                                     |
| -------------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| Magic-byte / signature validation                        | **COMPLETE** | `file-signature.ts`, 33 tests                                |
| Narrowed allowlist (PDF/JPEG/PNG, no SVG)                | **COMPLETE** | same                                                         |
| Filename sanitisation (traversal, double ext, bidi)      | **COMPLETE** | same                                                         |
| Malware-scan port, fail-closed                           | **COMPLETE** | `malware-scanner.port.ts`, 16 tests                          |
| Deterministic EICAR test scanner                         | **COMPLETE** | same                                                         |
| Storage keys, hash, per-outcome retention                | **COMPLETE** | `evidence-keys.ts`, 23 tests                                 |
| Public/restricted boundary on `GET` **and** `PUT`        | **COMPLETE** | `media.controller.ts`; 10 HTTP-boundary tests                |
| Restricted read authorization (IDOR matrix)              | **COMPLETE** | `evidence-read.policy.ts`, 23 tests incl. full cross-product |
| Audited read (grant **and** denial rows)                 | **COMPLETE** | `evidence-read.service.ts`, 17 tests                         |
| Read route: no-store, nosniff, attachment, detected MIME | **COMPLETE** | `evidence-read.controller.ts`; boot-verified 401             |
| Per-request permission resolution                        | **COMPLETE** | controller resolves per call                                 |
| **Prepare upload endpoint**                              | **MISSING**  | no route, no `mediaAsset.create`                             |
| **Finalize upload (idempotent)**                         | **MISSING**  | as above                                                     |
| **Quarantine-first lifecycle wired to a real upload**    | **MISSING**  | scanner port exists; nothing calls it                        |
| **Replace / delete / resubmit**                          | **MISSING**  | —                                                            |
| **Rate limits on prepare/finalize/read**                 | **MISSING**  | no `@Throttle` on the evidence routes                        |
| **Retention sweep job**                                  | **MISSING**  | `retainUntilFor` exists; no scheduler                        |

### Phase 2 — portfolio

| Item                                                                        | State         |
| --------------------------------------------------------------------------- | ------------- |
| Schema (`ProviderPortfolioItem`)                                            | COMPLETE (9A) |
| Everything else — CRUD, ownership, moderation, limits, consent, cleanup, UI | **MISSING**   |

### Phase 3 — redacted preview

| Item                                      | State       | Evidence        |
| ----------------------------------------- | ----------- | --------------- |
| Design + forbidden-field list             | COMPLETE    | ADR 0011        |
| Endpoint, DTO, dedicated query            | **MISSING** | no route exists |
| Rate limiting / anti-scraping / telemetry | **MISSING** | —               |
| Privacy snapshot tests                    | **MISSING** | —               |

### Phase 4 — admin review and atomic decision

| Item                                                        | State        | Evidence                                                            |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| Frozen case transition table                                | **COMPLETE** | `case-transitions.ts`, 24 tests, 56-cell cross-product              |
| Server-supplied `availableActions` (read)                   | **COMPLETE** | `admin-verification-case.service.ts`                                |
| Self-review excluded at discovery                           | **COMPLETE** | same                                                                |
| Evidence panel renders real metadata                        | **COMPLETE** | inherited red test green, byte-identical                            |
| **Seven reviewer mutations**                                | **MISSING**  | no assign/requestAction/approve/reject/reverify/expire/revoke route |
| **Atomic approval → grant → audit → notification → outbox** | **MISSING**  | 0 writes to case/decision/grant-from-case                           |
| **Forced-failure rollback proof**                           | **MISSING**  | —                                                                   |
| **Concurrency / stale-version 409**                         | **MISSING**  | —                                                                   |
| **Admin queue filters, tabs, assignment**                   | **MISSING**  | —                                                                   |

### Phase 5 — capability policy everywhere

| Item                                       | State         | Evidence                                                                                                                                                                               |
| ------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ranks 6/7 armed behind flags               | COMPLETE (9A) | `provider-capability.service.ts`                                                                                                                                                       |
| Both flag positions tested                 | COMPLETE (9A) | capability spec                                                                                                                                                                        |
| Route inventory                            | **PARTIAL**   | 12 provider controllers found; **2 carry no capability guard**: `provider-categories.controller.ts`, `provider.controller.ts` — both need classification (may be legitimately ungated) |
| Legacy vs canonical alias parity           | **PARTIAL**   | parity asserted at service level (9A); not per-route at HTTP                                                                                                                           |
| **Flag-ON HTTP journey**                   | **MISSING**   | never run                                                                                                                                                                              |
| Suspension/revocation/expiry races at HTTP | **MISSING**   | —                                                                                                                                                                                      |

### Phase 6 — provider UX

| Item                                                                                                                                                 | State       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| Component audit with REUSE/EXTEND/CREATE                                                                                                             | COMPLETE    | `UX-UI-COMPONENT-AUDIT.md`, 17 decisions |
| Admin evidence panel (EN/AR, a11y, non-colour cues)                                                                                                  | COMPLETE    |
| EN/AR copy parity + Arabic-script assertions                                                                                                         | COMPLETE    | 14 tests                                 |
| Public-media import guardrail (module specifiers)                                                                                                    | COMPLETE    |
| **Provider evidence experience** — checklist, upload, progress, cancel, retry, offline, submit, ACTION_REQUIRED deep-link, resubmit, expiry, renewal | **MISSING** |
| **Portfolio UI**                                                                                                                                     | **MISSING** |
| **Playwright EN/AR/RTL journeys**                                                                                                                    | **MISSING** |

### Phase 7 — gates

| Gate                                         | State       | Evidence                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts build                              | **PASS**    | 0 errors                                                                                                                                                                                                                     |
| database typecheck / build                   | **PASS**    | 0 errors                                                                                                                                                                                                                     |
| **database generate**                        | **BLOCKED** | `EPERM` on `query_engine-windows.dll.node` — the user's Prisma Studio (running since 22 Aug) holds it. Client verified current: 50 models, 40 enums, grant has `source`/`caseId`. **Needs the user to close Prisma Studio.** |
| api lint / typecheck / build                 | **PASS**    | 0 / 0 / 0                                                                                                                                                                                                                    |
| **api test, DB+Redis gates ENABLED, serial** | **PASS**    | **1925 passed, 0 failed, 0 skipped**                                                                                                                                                                                         |
| api test, gates enabled, **parallel**        | **FLAKY**   | 1924 passed / **1 failed** — see below                                                                                                                                                                                       |
| web lint / typecheck / test / build          | **PASS**    | 676 passed, 0 failed                                                                                                                                                                                                         |
| Playwright                                   | **NOT RUN** |                                                                                                                                                                                                                              |
| Docker cold build / boot / SIGTERM           | **NOT RUN** |                                                                                                                                                                                                                              |
| Compose smoke                                | **NOT RUN** |                                                                                                                                                                                                                              |
| Flag-ON HTTP journey                         | **NOT RUN** |                                                                                                                                                                                                                              |
| Dependency / secret / container scans        | **NOT RUN** |                                                                                                                                                                                                                              |

#### The 89 skips, resolved

They were gated on `RUN_DB_INTEGRATION=1` / `RUN_REDIS_INTEGRATION=1`. Both were
run against the live local Postgres and Redis. **Zero skips remain**: 1925/1925
pass serially.

#### Pre-existing parallelism flake (surfaced, not introduced)

`test/integration/provider-lifecycle-backfill.integration.spec.ts` fails when the
full suite runs with default workers, and passes:

- in isolation — 18/18
- in the full suite with `--runInBand` — 1925/1925

It mutates shared `ProviderProfile` rows and races other DB-gated suites. It is
**not** touched by any 9B commit. CI masks it because GitHub runners allocate
fewer workers than this machine.

**Not** to be handled with reruns. The real fix is isolation — a per-worker
schema or a Postgres advisory lock serialising the DB-gated suites — and is
recorded here rather than papered over.

## Consequence for push authorisation

Push remains **BLOCKED**. Not on a technicality: the write half of the feature
does not exist, so the flag-ON journey the brief requires (upload → scan →
submit → approve → grant → work) has nothing to exercise.
