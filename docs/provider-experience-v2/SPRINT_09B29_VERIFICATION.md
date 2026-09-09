# Sprint 09B.29 — verification evidence

> **How to read this document.** It is written in the order the work happened,
> and conclusions that later turned out to be wrong are left in place with a
> **SUPERSEDED** marker and a pointer to what replaced them. Nothing has been
> deleted to make the record look tidier than the work was. Sections §2.1–§2.8
> stand as written. §2.9, §2.9a and §2.9d contain statements that are now
> known to be wrong; each is marked. §2.12 onward is the post-restart record.

## Phase 2 — provider upgrade, session synchronization, and 401/403 separation

> **SUPERSEDED — status as originally recorded.** The paragraph below described
> the state at the end of the pre-restart session. It is no longer the status.
> The current status is in **§2.16**.
>
> ~~Status: INCOMPLETE. Every functional layer is green; one required evidence
> layer (visual capture for prototype screens 0 and 1) is not passing because
> of an unresolved defect in the capture harness. Details in §2.9. Per the
> phase rule, Phase 2 is therefore not signed off and Phase 3 has not been
> started.~~

**Status: see §2.16.** The visual gate now passes for all four cases, the
accessibility gate exists and passes, and both were re-established from a cold
start after a host restart. What was described as "an unresolved defect in the
capture harness" was two separate real defects plus four implementation
defects; §2.12 and §2.13 record them.

---

### 2.1 Root causes, proven from source

| #   | Defect                                                                                                                                     | Location                        | Proof                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------- |
| D1  | `401` and `403` collapsed into one view state, so a valid session with a stale role claim was told "Your session has ended… sign in again" | `hub-view-state.ts:57` (before) | `hub-view-state.test.ts` — the old test _asserted_ the defect via `it.each([401, 403])` |
| D2  | Session-rotation failure swallowed by `try { await refreshSession() } catch {}`                                                            | `useProviderProfile.ts`         | code read; the comment justified the swallow                                            |
| D3  | Rotation never verified — a `200` from `/auth/refresh` counted as success even when the session still lacked `provider`                    | `useProviderProfile.ts`         | `classifyRecovery` now distinguishes the two                                            |
| D4  | Onboarding caches never invalidated after upgrade; invalidations un-awaited, so `mutateAsync` resolved before refetch                      | `useProviderProfile.ts`         | only `profile.root` and `['auth','me']` were touched                                    |
| D5  | No stale-role recovery at all — a reload, deep link or second device mid-transition stranded the provider                                  | —                               | no such code existed                                                                    |
| D6  | Prototype screens 0 and 1 absent, so a failed rotation was recorded but never shown                                                        | —                               | no such component existed                                                               |

The 401-scoped refresh interceptor in `lib/api.ts` was read and **left
unchanged**: it deliberately excludes `403` to avoid a privilege-escalation
retry loop, which is what the rule requires.

`docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md` §"Known gaps" records this
same defect as _"open, not fixed"_. This phase closes it.

### 2.2 Files changed

**Web — source**

- `src/app/features/provider-onboarding-v2/hub-view-state.ts` — new `FORBIDDEN` state; `401` and `403` map separately.
- `src/app/features/provider-onboarding-v2/session/stale-role-recovery.ts` — **new.** Pure policy: one-attempt cap, `RecoveryOutcome` narrowing, `refresh-failed` vs `role-missing`.
- `src/app/features/provider-onboarding-v2/session/useStaleRoleRecovery.ts` — **new.** Rotate → verify → invalidate, at most once per mount.
- `src/app/features/provider-onboarding-v2/components/ProviderActivationScreen.tsx` — **new.** Prototype screens 0 and 1.
- `src/app/features/provider-onboarding-v2/copy/activation-copy.ts` — **new.** EN/AR, prototype wording transcribed.
- `src/app/features/provider-onboarding-v2/components/OnboardingShell.tsx` — optional `progress` rule with `role="progressbar"`.
- `src/app/features/provider-onboarding-v2/components/OnboardingHubScreen.tsx` — FORBIDDEN branch wired to recovery.
- `src/app/features/provider-onboarding-v2/copy/onboarding-hub-copy.ts` — FORBIDDEN copy, EN/AR, never mentions signing in.
- `src/app/hooks/provider/useProviderProfile.ts` — rotation reported not swallowed, verified, deterministic awaited invalidation.
- `src/app/components/provider/ProviderApp.tsx` — `/provider/activate` route, outside workspace chrome, flag-gated.
- `src/styles/theme.css` — `--pv-hero-*` tokens for the prototype's activation gradient.

**Web — tests**

- `hub-view-state.test.ts` — 401/403 split, plus a guard that they can never re-collapse.
- `session/stale-role-recovery.test.ts` — **new**, 14 cases.
- `components/ProviderActivationScreen.test.tsx` — **new**, 13 cases across all nine required states.
- `components/OnboardingHubScreen.test.tsx` — 403 gets its own screen.
- `e2e/provider-activation-session.real-api.spec.ts` — **new**, 4 real-browser cases.
- `e2e/provider-activation-visual.real-api.spec.ts` — **new**, currently failing (§2.9).
- `playwright.config.ts` — both new real-API specs added to `testIgnore` when `E2E_REAL_API` is unset.

**API**

- `test/integration/provider-upgrade-session.integration.spec.ts` — **new**, 5 cases, real Postgres/Redis, no mocks.
- `tsconfig.phase2-e2e.json` — **new.** Isolated `outDir` so the E2E build cannot race a running `nest start --watch`.

**Infrastructure**

- `infra/docker/docker-compose.integration.yml` — **new.** Throwaway Postgres/Redis/Mailpit.
- `.gitignore` — ignores `dist-phase2-e2e`.

### 2.3 Isolated test infrastructure

| Fact               | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| Compose project    | `hsm-phase2-it`                                                                   |
| Compose file       | `infra/docker/docker-compose.integration.yml`                                     |
| Containers         | `hsm-phase2-it-postgres`, `hsm-phase2-it-redis`, `hsm-phase2-it-mailpit`          |
| Database           | `hsm_phase2_it` (user `hsm_it`)                                                   |
| Postgres storage   | **tmpfs** — no named volume, nothing to leak                                      |
| Redis persistence  | disabled (`--save '' --appendonly no`)                                            |
| Published ports    | **ephemeral**, assigned by Docker (this run: 51026 / 51027 / 55720 / 55721)       |
| Migrations applied | **52 of 52**, from an empty database (52 migration directories on disk)           |
| Tables created     | 53                                                                                |
| Seed               | repository `seed()` — roles, permissions, catalogue, deterministic dev identities |

**Proof it cannot touch the development database**

1. Different Postgres cluster. `pg_control_system()` system identifier — dev `7677716683704508450`, test `7682698227190632483`.
2. Different port (ephemeral vs 5432) _and_ different database name (`hsm_phase2_it` vs `homeservicemarketplace`).
3. `SELECT count(*) FROM pg_database WHERE datname LIKE '%phase2%'` on the dev server returns **0**.
4. `dotenv -e ../../.env` does **not** override an already-set `DATABASE_URL` — proven empirically with a sentinel value that survived the wrapper.
5. Dev containers: all 5 `running`, `RestartCount=0`, `StartedAt` unchanged (2026-09-06T08:42:08, before this session).
6. Dev data intact after the whole run: 53 tables, 9 users, 12 provider profiles.
7. Redis `FLUSHALL` was issued **only** against `hsm-phase2-it-redis`; `hsm-redis` (dev) reported `DBSIZE 0` throughout.
8. Git stash count 4 before and after.

**Two hazards found and avoided rather than discovered later**

- `apps/api/dist` is owned by a running `nest start --watch` (yours). Building the E2E artifact there would have raced it and swapped the binary under your dev server. A separate `outDir` removes the shared resource.
- Port 4174 was already held by a pre-existing `vite` process of yours; the preview moved to 4176 rather than displacing it. A process of yours was identified and spared at each step (`nest --watch` PID 35756 was nearly killed after being mistaken for my jest run — it was checked first).

### 2.4 Commands executed

```bash
# infrastructure
docker compose -p hsm-phase2-it -f infra/docker/docker-compose.integration.yml up -d
DATABASE_URL=… pnpm --filter @homeservicemarketplace/database generate
DATABASE_URL=… pnpm --filter @homeservicemarketplace/database migrate:deploy
DATABASE_URL=… pnpm --filter @homeservicemarketplace/database seed

# API integration (real Postgres + Redis)
DATABASE_URL=… REDIS_HOST=127.0.0.1 REDIS_PORT=… RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 \
  pnpm --filter @homeservicemarketplace/api exec jest --runTestsByPath \
    test/integration/provider-upgrade-session.integration.spec.ts --forceExit
DATABASE_URL=… … pnpm --filter @homeservicemarketplace/api exec jest --forceExit   # full suite

# real stack for the browser layer
pnpm --filter @homeservicemarketplace/api exec nest build --path tsconfig.phase2-e2e.json
node dist-phase2-e2e/main.js                      # API on 4011
VITE_PROVIDER_ONBOARDING_V2=true VITE_API_URL=http://127.0.0.1:4011 \
  pnpm --filter @homeservicemarketplace/web build
pnpm exec vite preview --host 127.0.0.1 --port 4176 --strictPort

E2E_REAL_API=http://127.0.0.1:4011 E2E_MAILPIT=http://127.0.0.1:55721 \
E2E_BASE_URL=http://127.0.0.1:4176 E2E_PREBUILT=1 \
  pnpm exec playwright test e2e/provider-activation-session.real-api.spec.ts \
    --project=chromium-mobile --workers=1

# static + regression
pnpm --filter @homeservicemarketplace/web typecheck | lint | test
pnpm --filter @homeservicemarketplace/api typecheck | lint
pnpm exec playwright test --shard=1..3/3 --workers=2      # default (stub) suite
```

### 2.5 Test counts

| Layer                           | Command                                |                                 Passed | Failed | Skipped | Duration   |
| ------------------------------- | -------------------------------------- | -------------------------------------: | -----: | ------: | ---------- |
| Web unit/component              | `web test`                             |                               **1532** |      0 |       0 | ~68 s      |
| Web typecheck                   | `web typecheck`                        |                                   pass |      — |       — | —          |
| Web lint                        | `web lint`                             | 0 errors, **35 warnings** (= baseline) |      — |       — | —          |
| API typecheck                   | `api typecheck`                        |                                   pass |      — |       — | —          |
| API lint                        | `api lint`                             |                             0 problems |      — |       — | —          |
| API full suite, gates **ON**    | `api jest`                             |                  **3582** (190 suites) |      0 |   **0** | 52.7 s     |
| — of which the new spec         | `provider-upgrade-session`             |                                      5 |      0 |       0 | 12.7 s     |
| Browser E2E, real API           | `provider-activation-session.real-api` |                                  **4** |      0 |       0 | 1.4 m      |
| Playwright default shard 1/3    | `--shard=1/3`                          |                                    233 |      0 |      31 | 5.8 m      |
| Playwright default shard 2/3    | `--shard=2/3`                          |                                    216 |      0 |      48 | 5.9 m      |
| Playwright default shard 3/3    | `--shard=3/3`                          |                                    247 |      0 |      17 | 6.9 m      |
| **Visual capture, screens 0/1** | `provider-activation-visual.real-api`  |                                      0 |  **2** |       0 | 1.1 m each |

Baselines for comparison: web unit was 102 files / 1500 tests; API was 2975
passed with **602 skipped** because the gates were off. Under the isolated stack
those 602 now run and pass — 3582 total, nothing skipped.

The 96 Playwright skips are pre-existing viewport/project conditionals, not
introduced here.

### 2.6 API status evidence

From the real-guard integration suite (no mocks anywhere in this layer):

| Step                            | Route                                | Session               | Status                                               |
| ------------------------------- | ------------------------------------ | --------------------- | ---------------------------------------------------- |
| authenticated non-provider      | `GET /v1/me/provider/profile`        | seeker                | **403**                                              |
| authenticated non-provider      | `GET /v1/me/provider/onboarding/hub` | seeker                | **403**                                              |
| anonymous                       | same two routes                      | none                  | **401**                                              |
| after `POST /upgrade`           | `GET …/onboarding/hub`               | **pre-upgrade token** | **403**                                              |
| after `POST /auth/refresh`      | `GET /v1/auth/me`                    | rotated               | 200, `roles` contains `provider`                     |
| after rotation                  | `GET /v1/me/provider/profile`        | rotated               | **200**, profile id matches the row                  |
| after rotation                  | `GET …/onboarding/hub`               | rotated               | **200**, 6 tasks, `progress.total` 6, `status` DRAFT |
| after rotation                  | `GET …/onboarding/draft`             | rotated               | **200**, `editable` true                             |
| control: refresh a non-provider | `GET …/onboarding/hub`               | rotated seeker        | **403** — rotation does not escalate                 |
| guard integrity                 | 3 provider routes                    | stranger / anonymous  | 403 / 401                                            |
| CSRF integrity                  | `POST /upgrade` without token        | valid session         | **403**                                              |
| idempotency                     | `POST /upgrade` twice                | same session          | one profile, one role row                            |

Browser layer, same transition through Chromium: `403` occurrences bounded
(assertion ≤ 4) and `/auth/refresh` calls bounded (assertion ≤ 3) — no loop. The
pre-upgrade cookie jar, replayed independently after the journey, still returns
**403**.

### 2.7 Reference hashes — unchanged

| File                                               | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `reference/provider-onboarding-prototype.html`     | `c5ceb93a1283da2e29904b50d4c8d11745d2ac2e866b9dca6b559235260725b9` |
| `reference/provider-onboarding-user-flow.svg`      | `694af15da8d5e06614d7afc83d1e513ade162cbde802746e933331b02cb87aa7` |
| `reference/provider-onboarding-user-flow.png`      | `fbbcaabb01a4d79c4157258a433251e7bf7068e366032be0e3516fab4a96f663` |
| `reference/provider-onboarding-delivery-readme.md` | `f765e326083b780ad1bba47ad2d6ba7272642211a30b3b8ab268b8a43c234790` |

Identical to the Phase 0 record in `SPRINT_09B29_BASELINE.md` §2.

### 2.8 Bugs the tests found in my own work

Recorded because each was caught by a gate rather than by inspection:

1. **React Query v5 awaits `onSuccess`.** Gating screen 1 on `upgrade.isSuccess` left the provider staring at the activation button for the entire rotation. Fixed by gating on the sync axis leaving `idle`.
2. **`exhausted` ≠ the only refusal.** Branching on it alone mislabelled every `role-missing` outcome as a failed refresh and offered a retry that could not help.
3. **Duplicated failure text.** The heading and the alert both rendered the same sentence, reading as two problems.
4. **The activation route ejected the provider mid-flow.** The upgrade seeds the profile cache immediately, so a `hasProfile` redirect fired between the upgrade and the rotation — landing them on the status screen. Caught by the browser journey, which asserted against the wrong page.
5. **`set-state-in-effect`.** The first recovery hook set state from an effect that depended on that state. Refactored onto a mutation rather than suppressed.

### 2.9a Root cause of the sign-in discrepancy — PROVEN

> **PARTIALLY SUPERSEDED.** The build-artifact collision described here is real
> and the `dist-realapi` split is the right fix; that part stands and is
> re-verified in §2.12. Two claims in this section are wrong:
>
> 1. _"With that in place the visual spec passes with its assertions
>    unchanged."_ It did not. Screen 0 passed; screen 1 failed at **0.09**
>    (en) and **0.08** (ar). §2.13 has the measurements and the repair.
> 2. The section is written as though the sign-in failure were the _only_
>    thing between the gate and a pass. It was not — see §2.13.
>
> The correction of the earlier `POST /v1/auth/login -> 200` attribution, made
> below, is itself correct and stands.

**It was a build-artifact collision, not a defect in the visual spec.**

An instrumented diagnostic (`_diagnostic-signin.real-api.spec.ts`, temporary)
ran the session spec's setup and the visual spec's setup back to back under
identical capture. Both failed **identically**, which eliminates every
spec-level difference that had been under suspicion — fixture ordering,
viewport, route timing, account reuse, OTP reuse, throttling, storage-state
leakage, CORS, worker identity.

The captured evidence showed the browser receiving
`net::ERR_CONNECTION_REFUSED` on the login request. The API was healthy and
answering `curl` on 4011 throughout, and the out-of-band Node registration in
the same test succeeded. So the browser was calling a **different address**.

Confirmed directly against the served bundle:

| Fact                                               | Value                                   |
| -------------------------------------------------- | --------------------------------------- |
| Served entry at the time of failure                | `index-CRsg2FPX.js`                     |
| Contains `127.0.0.1:4011` (isolated API)           | **0 occurrences**                       |
| Contains `127.0.0.1:4010` (Playwright default API) | 1 occurrence                            |
| `apps/web/dist/index.html` mtime                   | 12:10:37 — the last default-suite shard |

`playwright.config.ts`'s `webServer.command` runs `pnpm build` with
`VITE_API_URL: 'http://127.0.0.1:4010'` and `VITE_PROVIDER_ONBOARDING_V2: ''`.
The three default-suite shards therefore **overwrote `apps/web/dist`** — the
directory the real-API preview was serving. The visual spec's browser then
called `4010`, where nothing listens, and the login form rendered "Couldn't
sign in."

The `POST /v1/auth/login -> 200` entries cited in the previous report came from
the _earlier_ session-spec run, before the shards rebuilt. That was a
misattribution on my part.

**Fix:** the real-API bundle is built to its own `dist-realapi` and served from
there, so the two Playwright configurations no longer share an output
directory — the same remedy already applied to the API's `dist-phase2-e2e`.
With that in place the visual spec passes **with its assertions unchanged**.

A second, independent harness limit surfaced once the first was fixed:
`AUTH_REGISTER_THROTTLE_LIMIT` defaults to 5 per hour per IP, and every browser
journey registers a real account from loopback. It is raised for the isolated
test stack only. The throttle's own behaviour is covered by
`registration-throttle.integration.spec.ts` using synthetic `198.51.100.x`
identities, so raising it here cannot mask a regression.

**Consequence for consolidation: none is justified.** The rule permitted
consolidation only if the evidence proved the separate visual harness was the
defect. It proves the opposite. Both specs are kept; nothing was deleted, and
no assertion was moved into a passing test to obtain a green result.

### 2.9b The exit-code-127 background tasks — explained

Two background tasks that ran the isolated API reported `exit code 127`. That
code was produced by my own `Stop-Process -Force`, not by a missing command or a
failed boot: a controlled probe (`node -e "setInterval(...)"` started in the
background and force-killed) reproduces `exit code 127` exactly.

The API those tasks ran had already served the health check, the full
integration suite and the browser suite. Neither left anything behind — ports
4011 and 4176 are both free, and no `dist-phase2-e2e` or preview process
survives.

One correction to the previous report: a `vite preview` on 4176 **did** survive
the earlier teardown. My kill pattern (`*port 4176*`) did not match the actual
command line (`"--port" "4176"`). It has been identified by port ownership and
stopped.

### 2.9c Deterministic asset layer

`e2e/assets/vendor/` — 14 assets, each recorded in `manifest.json` with source
URL, kind, licence, byte count and SHA-256. Regenerated by
`node e2e/assets/vendor-prototype-assets.mjs`.

| Asset                                  | Version                                          | Licence     |
| -------------------------------------- | ------------------------------------------------ | ----------- |
| `lucide-1.17.0.umd.js`                 | 1.17.0 (exactly the version the prototype names) | ISC         |
| `floating-ui.core-1.7.3.umd.min.js`    | 1.7.3                                            | MIT         |
| `floating-ui.dom-1.7.4.umd.min.js`     | 1.7.4                                            | MIT         |
| 10 × Inter/Cairo `woff2` + `fonts.css` | from the app's own Google Fonts request          | SIL OFL 1.1 |

`serveVendoredAssets()` intercepts `unpkg.com`, `fonts.googleapis.com` and
`fonts.gstatic.com`, serves from disk, and **records anything not vendored so
the test fails** rather than capturing a fallback glyph. No capture touches the
network.

Three harness artefacts had to be neutralised for the comparison to mean
anything. Each is excluded on the same grounds — it is scaffolding, not design:

1. **The device bezel.** `.hsm-phone` is a 390px mock with a 28px radius and a
   drop shadow, beside a toolbar labelled "Prototype controls". The captured
   surface is `#hsm-phone-content`.
2. **The page gutter.** The wrapper's `body { padding: 1rem }` shrank the
   surface to 356px at a 390px viewport — a 34px error that would have been
   blamed on the implementation. The page is widened by the gutter and the
   resulting geometry is asserted (`.hsm-phone` = 390, surface = 388).
3. **The body font weight.** The generic wrapper sets
   `--font-weight-normal: 430`, so every reference paragraph rendered heavier
   than the product's 400 and broke lines at different words. The prototype file
   labels that block _"Internal implementation variables; not part of the agent
   contract"_.

Fonts are asserted usable before every capture: the specific weights are
requested with `document.fonts.load()` (an `@font-face` is registered but not
fetched until used, so `check()` alone reports false), then `fonts.ready` is
awaited and `check('16px Inter')` / `check('16px Cairo')` must both be true. A
silent Arial fallback fails the test.

Neither Inter nor Cairo is installed on this machine, which is why this matters:
without the vendored faces the reference would render in Arial and the
implementation in real Inter — a glyph-level difference on every screen with no
design cause. The reference's own delivery README asks for exactly this
("Ensure Cairo and Inter are available").

### 2.9d Visual gate — built, working, and not yet passing

> **SUPERSEDED IN ITS NUMBERS.** The four implementation defects listed in this
> section are real and their fixes stand. The **measured progress table below
> is wrong**: it records 0.03 (en) / 0.02 (ar) as the state at the end of the
> session, and the reproducible measurement — taken twice before any further
> change, once pre-restart and once post-restart, byte-identical both times —
> is **0.09 (en) / 0.08 (ar)**, and it applies to **screen 1 only**; screen 0
> was already passing. Those ratios were recorded from an intermediate run and
> were never re-measured after the last change of that session.
>
> The conclusion the section draws — that the residue was "a small vertical
> offset of the text blocks plus sub-pixel antialiasing" — is also wrong, and
> §2.13 shows why with a region breakdown: 98% of the differing pixels were
> **clustered**, not isolated text edges, and the largest single block was an
> entire sticky action bar the implementation never drew.
>
> The statement that "the threshold stays at 0.005 and the tests stay red until
> either the implementation matches or a specific deviation is approved" was
> honoured: the threshold was not moved, no snapshot was updated, and the
> implementation was changed until it matched. See §2.13.

`prototype-reference.spec.ts` captures screens 0 and 1 from the immutable
prototype in both languages and stores them under
`e2e/__screenshots__/reference/` (388×764). It doubles as a **drift guard**: a
second run compares the prototype against the stored reference, so a change to
the reference file, the pinned icon build or the vendored fonts fails there
rather than silently moving the target. All 4 pass, and pass again on a repeat
run without `--update-snapshots`.

`provider-activation-visual.real-api.spec.ts` renders the real implementation
through the real API under the same asset layer, viewport, locale and frozen
motion, and compares against those references at
`maxDiffPixelRatio <= 0.005`, emitting `-expected`, `-actual` and `-diff` PNGs.

**The gate found four real implementation defects against the approved design:**

| #   | Defect                                                                                                                                                                                   | Fix                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Primary action rendered inline in the content flow, not in the sticky bottom bar the prototype pins it to                                                                                | passed through `OnboardingShell`'s `footer`                         |
| 2   | Content area painted on the surface colour, flattening cards against their own background                                                                                                | `<main>` now uses `--pv-bg`                                         |
| 3   | Header title 15px in a short bar; the prototype's `.hsm-topbar` is 17px/1.45 in a 64px bar, and its grid has no column gap — the title sat 8px too far in on **every** onboarding screen | metrics transcribed; header is now a `44px minmax(0,1fr) 44px` grid |
| 4   | Line heights and radii off the prototype's values (lead 1.625 vs 1.75, heading 1.375 vs 1.35, panel radius 12 vs 14, primary button 44px vs 48px)                                        | aligned                                                             |

Measured progress, English / Arabic:

| After                                    | diff ratio (en) | diff ratio (ar) |
| ---------------------------------------- | --------------: | --------------: |
| gate first working                       |            0.15 |            0.14 |
| sticky action + background               |            0.07 |            0.06 |
| typography and radii                     |            0.06 |            0.05 |
| header grid, sticky padding, 48px button |            0.03 |            0.03 |
| harness font-weight neutralised          |        **0.03** |        **0.02** |

**Still above the 0.005 target.** The residue is a small vertical offset of the
text blocks plus sub-pixel antialiasing; line breaks now match the reference
exactly. This is the remaining long tail of exact-parity work, and it is **not**
being waved through: the threshold stays at 0.005 and the tests stay red until
either the implementation matches or a specific deviation is approved.

### 2.9 The outstanding blocker

> **SUPERSEDED — this blocker no longer exists, and its diagnosis was wrong.**
>
> The symptom recorded below (`signIn` times out waiting for `otp-input`, page
> shows "Couldn't sign in") was **not** a defect in the visual spec. It was the
> `apps/web/dist` collision root-caused in §2.9a: the default Playwright shards
> rebuilt `dist` with `VITE_API_URL=127.0.0.1:4010`, and the real-API preview
> was serving that directory. The section's own guess — "recorded as a harness
> defect rather than a product one, but it is not root-caused" — was correct to
> withhold a conclusion, and the conclusion turned out to be the build
> collision.
>
> The two sentences at the end of this section are also now wrong:
>
> - _"no visual artefact exists for prototype screens 0 and 1"_ — artefacts now
>   exist for all four cases, pass or fail (§2.13, `visual-parity.json`).
> - _"no automated accessibility scan has been run against them"_ — ten scans
>   have now been run (§2.14).
>
> The final paragraph, about the prototype-versus-implementation pixel diff not
> being built because the reference loads icons from `unpkg.com`, was already
> resolved by the vendored asset layer in §2.9c and should be read as history.

`e2e/provider-activation-visual.real-api.spec.ts` — **2 failed, 0 passed.**

Symptom: `signIn` times out waiting for `otp-input`; the page shows _"Couldn't
sign in. Please try again."_ while the API log records `POST /v1/auth/login` →
**200** for the same run.

Ruled out: registration/login throttling (Redis flushed immediately before;
`register` returns 202 and `verify-otp` 200 in the same test); the delayed
`/auth/refresh` route (moved to after sign-in, no change); Playwright fixture
ordering (`page` removed from `beforeEach` so init scripts apply, no change);
test count (reduced from 4 sessions to 2, no change).

The functionally equivalent journey in
`provider-activation-session.real-api.spec.ts` performs the same register →
sign-in → activate sequence and **passes**, which is why this is recorded as a
harness defect rather than a product one — but it is not root-caused, so it is
not being claimed as either.

**Consequence:** no visual artefact exists for prototype screens 0 and 1, and
no automated accessibility scan has been run against them. Two Phase 2 exit
criteria are therefore unmet.

Separately, and independently of this failure: the prototype-versus-
implementation **pixel diff** is not built. The reference loads its icon set
from `unpkg.com` at runtime, so a baseline captured with the network up and one
captured without it differ on every screen. Vendoring those assets is Phase 7
work (`SPRINT_09B29_BASELINE.md` §5.1).

### 2.10 Exit criteria (as assessed pre-restart)

> **SUPERSEDED by §2.16.** Kept because it records which gates had genuinely
> been measured at that point. The two rows marked FAIL / NOT RUN are the two
> this resumption closed.

| Criterion                                | Status                              |
| ---------------------------------------- | ----------------------------------- |
| web typecheck                            | **pass**                            |
| web lint, no new warnings                | **pass** (35 = baseline)            |
| web unit/component tests                 | **pass** (1532)                     |
| API typecheck and lint                   | **pass**                            |
| relevant API unit tests                  | **pass**                            |
| real Postgres/Redis integration tests    | **pass** (3582, 0 skipped)          |
| real-browser auth/upgrade E2E            | **pass** (4)                        |
| V2 reload and deep-link E2E              | **pass** (in the journey test)      |
| Arabic and English activation/sync tests | **pass** (component + browser)      |
| 401/403 differentiation tests            | **pass** (unit, component, API)     |
| no regression to Seeker or Admin         | **pass** (696 Playwright, 0 failed) |
| immutable reference hashes unchanged     | **pass**                            |
| **visual comparison, screens 0 and 1**   | **FAIL — §2.9**                     |
| **accessibility scan, screens 0 and 1**  | **NOT RUN — blocked by §2.9**       |

**Phase 2 is not complete. Phase 3 has not been started.**

### 2.11 Teardown

```bash
docker compose -p hsm-phase2-it -f infra/docker/docker-compose.integration.yml down -v
```

Scoped to the `hsm-phase2-it` project. It cannot reach the developer's `docker`
project, its `docker_*_data` volumes, or any container outside this file.

---

## 2.12 Post-restart baseline — the failure reproduced exactly

The host was restarted between sessions. Everything below was re-established
from a cold start; nothing in this section relies on a measurement taken before
it.

### 2.12.1 Recovered state, confirmed read-only before any change

| Fact                        | Expected                                         | Measured                               |
| --------------------------- | ------------------------------------------------ | -------------------------------------- |
| Branch                      | `fix/sprint-09b29-provider-onboarding-v2-parity` | same                                   |
| `HEAD`                      | `b4c6e25e412e5e26421f2848efee4c0739801044`       | same                                   |
| Upstream                    | none                                             | none (`fatal: no upstream configured`) |
| Sprint commit / push        | none                                             | none                                   |
| Tracked dirty paths         | 19                                               | **19**                                 |
| Staged R100 reference moves | 4                                                | **4**, all `R100`                      |
| Stashes                     | 4, intact                                        | **4**, unchanged                       |
| Untracked paths             | 41                                               | **38 files** — see below               |

The untracked count reconciles exactly rather than differing: `git status
--porcelain` collapses three directories (`e2e/__screenshots__/`,
`e2e/assets/`, `provider-onboarding-v2/session/`) that `-uall` expands.
38 files + 3 collapsed directory entries = 41. No work is missing.

**Reference immutability**, proven through git rather than by re-hashing alone:
for all four reference files, `git hash-object <worktree>` = `git rev-parse
:<path>` = `git rev-parse HEAD:<old path>`. Worktree, index and `HEAD` agree,
so the `git mv` moved bytes that have not changed since they were committed.
The SHA-256 values are unchanged from 2.7 and section 2 of the baseline.

### 2.12.2 The developer's stack was not touched

| Check                                           | Before                | After the whole run |
| ----------------------------------------------- | --------------------- | ------------------- |
| Dev Postgres system identifier                  | `7677716683704508450` | unchanged           |
| Dev tables / users                              | 53 / 9                | unchanged           |
| `pg_database LIKE '%phase2%'` on the dev server | 0                     | 0                   |
| Dev containers `RestartCount`                   | 0                     | 0                   |
| Stash count                                     | 4                     | 4                   |

The isolated stack's own Postgres reports system identifier
`7682830448810737699` — a different cluster, on an ephemeral port, with a
different database name, backed by tmpfs.

Processes belonging to the developer and deliberately left alone: `nest start
--watch` (PID 6936, which owns `apps/api/dist`), the `vite` dev server on 5173,
and three `prisma studio` processes. The E2E API is built to
`dist-phase2-e2e` and the E2E bundle to `dist-realapi` precisely so neither
shares an output directory with them.

### 2.12.3 Isolated stack, rebuilt from empty

```bash
docker compose -p hsm-phase2-it -f infra/docker/docker-compose.integration.yml down -v
docker compose -p hsm-phase2-it -f infra/docker/docker-compose.integration.yml up -d
```

The Compose project label was verified as `hsm-phase2-it` on all three
containers before recreating them.

| Step                               | Result                                           |
| ---------------------------------- | ------------------------------------------------ |
| Tables before migrating            | **0**                                            |
| Migration directories on disk      | 52                                               |
| `migrate:deploy`                   | `All migrations have been successfully applied.` |
| `_prisma_migrations` finished rows | **52**                                           |
| Tables after                       | **53**                                           |
| Seed                               | completed                                        |
| Ephemeral ports this run           | pg 61486, redis 61485, mailpit 61488 / 61487     |
| API readiness on 4011              | `{"ready":true, postgres: up, redis: up}`        |

`DATABASE_URL` was proven not to be overridden by the `dotenv -e ../../.env`
wrapper before any migration ran: the effective URL resolved to
`127.0.0.1:61486/hsm_phase2_it`.

### 2.12.4 The browser really is on the V2 bundle and the isolated API

The check that caught the original collision, repeated against the **served**
bundle rather than the built one:

| Fact                                                | Value                             |
| --------------------------------------------------- | --------------------------------- |
| Entry served by the preview on 4176                 | matches `dist-realapi/index.html` |
| Occurrences of `127.0.0.1:4011` (isolated API)      | **1**                             |
| Occurrences of `127.0.0.1:4010` (default suite API) | **0**                             |
| Occurrences of `localhost:4000` (dev API)           | **0**                             |
| `hsm.ff.providerOnboardingV2` present in the bundle | yes                               |
| `apps/web/dist` mtime during the run                | unchanged                         |

The flag is additionally seeded per-browser by the specs themselves through
`addInitScript`, and asserted at runtime by the progress-bar and shell `dir`
assertions each spec already carries.

### 2.12.5 Reference drift guard — the prototype still produces the references

```bash
pnpm exec playwright test e2e/prototype-reference.spec.ts \
  --project=chromium-mobile --workers=1        # NO --update-snapshots
```

**4 passed, 0 failed, 0 skipped (13.5 s).** The stored reference PNGs kept
their original mtimes, so nothing was regenerated. The immutable prototype, the
pinned lucide build and the vendored fonts still render exactly what the
implementation is measured against.

### 2.12.6 The failure, reproduced

```bash
pnpm exec playwright test e2e/provider-activation-visual.real-api.spec.ts \
  --project=chromium-mobile --workers=1        # NO --update-snapshots
```

| Case         | Result   | Differing pixels |    Ratio |
| ------------ | -------- | ---------------: | -------: |
| screen 0, en | **pass** |                — |        — |
| screen 0, ar | **pass** |                — |        — |
| screen 1, en | **fail** |           26,178 | **0.09** |
| screen 1, ar | **fail** |           22,049 | **0.08** |

Identical to the pre-restart numbers, and the `-actual` / `-expected` /
`-diff` PNGs came back byte-for-byte the same size. The failure is fully
deterministic, and it is **screen 1 only** — a fact 2.9d did not record.

---

## 2.13 Screen 1 parity — measured, root-caused, repaired

### 2.13.1 Where the differing pixels were, before any change

Measured with `node e2e/assets/diff-regions.mjs <expected> <actual>`, which
classifies every differing pixel by band and by neighbourhood. Its threshold
(channel-sum > 24) is stricter than Playwright's antialiasing-aware compare, so
it reports a higher ratio and never flatters the implementation.

| Region (y range)            |             English |              Arabic |
| --------------------------- | ------------------: | ------------------: |
| Header, 0–64                |               2,148 |               1,290 |
| Progress rule, 64–68        |               **0** |               **0** |
| Content, 68–685             |              25,470 |              16,005 |
| Sticky bar, 685–764         |          **17,020** |          **17,058** |
| **Total**                   | **44,638** (0.1506) | **34,353** (0.1159) |
| Bounding box                |     x0–387, y13–745 |     x0–387, y13–745 |
| Text-edge (isolated) pixels |          836 (1.9%) |        1,081 (3.1%) |
| Clustered pixels            |  **43,802 (98.1%)** |  **33,272 (96.9%)** |
| On a flat design fill       |               9,277 |               4,472 |

Two things follow immediately, and neither is compatible with calling this
antialiasing:

1. **98% of the difference is clustered**, not isolated. Glyph edges are thin
   and land in the isolated bucket; displaced and missing elements do not.
2. **The sticky band is the same size in both languages** — 17,020 and 17,058,
   a 38-pixel difference across a 356-pixel-wide control. Text differs between
   languages; chrome does not. Something language-independent was missing.

The worst rows name it: `y685:388` (a full-width row), `y679`–`y684`
descending (an upward drop shadow), and `y705`–`y709` at exactly 356 pixels —
the width of a button inside a 16px-padded bar.

### 2.13.2 Root causes

Computed styles were then compared element by element between the prototype and
the implementation, under the same fonts, viewport and frozen motion, by
`e2e/_diagnostic-visual.real-api.spec.ts`.

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                            | Fix                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | **Screen 1 has no sticky action bar.** The prototype pins `.hsm-sticky`, with a `Continue after sync` primary button, to the bottom of this screen exactly as it does on screen 0. The implementation rendered none.                                                                                                                                                                                                    | `sticky-bar` and `primary` reported `impl=ABSENT`; 17,020 / 17,058 px in the bottom 79 px           | `footer` passed to `OnboardingShell`                                                             |
| 2   | **All content sat 40 px low**, as a consequence of 1. The prototype's bar is `position: absolute`, so `.hsm-center` is the full 696 px and clears it with a 110 px bottom inset, centring in 558 px. With no bar the implementation's area was 696 px and its 31 px inset centred in 637 px.                                                                                                                            | `center` box ref 696 vs impl 617 after the fix, with padding-bottom 110 vs 31 — the same 558 px box | the bar's existence restores 617 px, and 28 / 31 reproduces 558 px                               |
| 3   | **The centre heading was bold; the reference is weight 500.** `.hsm-center h1` declares no weight and takes the prototype wrapper's `h1 { font-weight: var(--font-weight-medium) }`.                                                                                                                                                                                                                                    | `getComputedStyle` on the reference: `fontWeight: 500`, `lineHeight: 33.6px`                        | `fontWeight: 500`                                                                                |
| 4   | **The alert was the wrong component.** `ProviderNotice` differs from the prototype's `.hsm-alert` in six measured ways: a 1 px border it does not have, a 12 px gap instead of 10 px, an 18 px clock icon instead of a 16 px shield-check, a 600-weight title instead of 500, a 13 px body on the text colour instead of 14 px / 1.8 on the muted colour, and a forced start alignment instead of the inherited centre. | element-by-element dump                                                                             | new `OnboardingAlert` V2 primitive; `ProviderNotice` left untouched for the surfaces that use it |
| 5   | **Every icon was the wrong size.** The prototype's pinned lucide 1.17.0 build does not carry the requested size onto the `<svg>` it substitutes for the `<i>`, so `hsmIcon('refresh-cw',30)`, `hsmIcon('briefcase',26)` and `hsmIcon('x',20)` **all render at 16×16**. The implementation was drawing 30, 26 and 20.                                                                                                    | reference `centerIconSvg`, `heroIconSvg` and `topbarCloseSvg` all measured `16.0x16.0`              | `size={16}` on all three                                                                         |
| 6   | **The topbar subtitle was 3 px short**, pushing the title 2 px down on every screen that carries one. `.hsm-topbar p` sets a 12 px size and no line-height, so it inherits the wrapper's `line-height: 21px` — a length, which does not scale with the font — plus a 1 px top margin.                                                                                                                                   | ref `y=33.8 h=21 marginTop=1` vs impl `y=34.8 h=18 marginTop=0`                                     | `lineHeight: '21px'`, `marginTop: '1px'`                                                         |
| 7   | **Two muted colours were slate-500, not the design's muted token.** The close control and the subtitle rendered `#64748b`; `.hsm-icon-action` and `.hsm-topbar p` are `--hsm-muted` = `#475569` = `--pv-text-muted`.                                                                                                                                                                                                    | `color` differed on `topbar-close` and `topbar-subtitle`                                            | `text-pv-muted`                                                                                  |

### 2.13.3 One harness defect, and why fixing it is not masking

Screen 0's CTA and screen 1's sticky action occupy the **same rectangle**. The
click that advances from one screen to the other therefore left Playwright's
virtual mouse hovering the new button, and the capture came back with the
`:hover` accent `#1d4ed8` where the reference has the resting `#2563eb` — a
356×48 block, 17,088 pixels.

The pointer is now parked at (4, 120) before capturing: inside the surface,
outside the 20 px centre gutter, over nothing with a hover style.

This is not a masked region and not a relaxed assertion. The prototype is a
static document with no pointer over it, so its resting state is the state
under comparison; capturing a hover the design never specifies was measuring
the harness, not the product. Nothing is excluded from the comparison — the
full 388×764 surface is still compared, at the same threshold.

### 2.13.4 Result — all four cases, machine-readable

`toMatchSnapshot` remains the gate at `maxDiffPixelRatio <= 0.005`. The
threshold was not changed, no snapshot was regenerated, no region was masked or
blurred, and no assertion was removed.

Playwright writes `-expected` / `-actual` / `-diff` artefacts only when a
snapshot **fails**, which is the wrong way round for an acceptance gate — "2
passed" is a claim, not evidence. `e2e/visual-evidence.ts` therefore records
every case whatever the verdict, into
`apps/web/test-results/visual-evidence/`:

| Case                   | Differing px |   **Ratio** | Header | Progress | Content | Sticky | Text-edge | Clustered |
| ---------------------- | -----------: | ----------: | -----: | -------: | ------: | -----: | --------: | --------: |
| screen-0-activation-en |          148 | **0.00050** |     36 |        0 |     112 |      0 |        10 |       138 |
| screen-0-activation-ar |          154 | **0.00052** |     42 |        0 |     112 |      0 |        16 |       138 |
| screen-1-sync-en       |          180 | **0.00061** |     36 |        0 |     144 |      0 |        26 |       154 |
| screen-1-sync-ar       |          244 | **0.00082** |     40 |        0 |     145 |     59 |        90 |       154 |

Every case is at least **6× inside** the 0.005 threshold. Screen 0, which was
already passing, improved from 3,007 differing pixels to 148 — defects 5, 6 and
7 were present there too and were being absorbed by the threshold.

Artefacts written per case: `<name>-expected.png`, `<name>-actual.png`,
`<name>-diff.png`, plus `visual-parity.json` carrying the table above.

Progression, all measured on the same stricter metric:

| State                           | screen 1 en | screen 1 ar |
| ------------------------------- | ----------: | ----------: |
| As recovered (reproduced twice) |      44,638 |      34,353 |
| After all seven fixes           |     **180** |     **244** |

The rendered result was inspected, not merely generated: both languages were
opened and read for hierarchy, spacing, alignment, wrapping and action
prominence, and the Arabic capture was checked for mirrored header, RTL text
flow, right-anchored progress fill and an unclipped sticky action.

---

## 2.14 Accessibility — installed _and_ executed

2.9 recorded that no accessibility scan had been run. `@axe-core/playwright`
4.13.0 was present in `package.json`, `pnpm-lock.yaml` and `node_modules`, and
there was no `AxeBuilder` import anywhere in the repository. A dependency that
is installed and never imported is not a gate.

`e2e/provider-activation-a11y.real-api.spec.ts` is new: 6 tests, both
languages, against the real API in a real browser. No other accessibility
library was added and no unrelated dependency was changed — the only
`package.json` edit in this sprint remains the single `@axe-core/playwright`
line.

### 2.14.1 Automated layer — axe-core

Whole page. No rule disabled and no region excluded; an `.exclude()` around the
surface under test is a disabled rule wearing a disguise. Tags: `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. The gate is zero **critical or
serious** violations.

| Scenario                            | en violations / blocking | ar violations / blocking | passes (en / ar) |
| ----------------------------------- | -----------------------: | -----------------------: | ---------------: |
| screen 0 — activation idle          |                    0 / 0 |                    0 / 0 |          20 / 19 |
| screen 1 — synchronization pending  |                    0 / 0 |                    0 / 0 |          21 / 21 |
| screen 1 — successful sync (hub)    |                    0 / 0 |                    0 / 0 |          18 / 18 |
| screen 1 — refresh failure / retry  |                    0 / 0 |                    0 / 0 |          20 / 20 |
| screen 1 — role missing / FORBIDDEN |                    0 / 0 |                    0 / 0 |          20 / 20 |

**10 scans, 0 violations at any impact, 0 blocking.** Three scans reported one
`incomplete` item each — axe's "needs review" bucket, not a violation. They are
colour-contrast checks axe cannot resolve automatically, and 2.14.2 measures
contrast by hand instead of leaving it unanswered.

How the failure states are reached, without weakening anything: the account is
genuinely upgraded server-side every time, and only the **session rotation** is
intercepted — `POST /v1/auth/refresh` aborted for `refresh-failed`, and
`GET /v1/auth/me` answered with the real response minus the `provider` role for
`role-missing`. No guard is relaxed, no test-only endpoint exists, and the
server's own answer is unchanged.

### 2.14.2 Explicit layer — what axe cannot decide

38 recorded assertions, both languages. Axe can see that a control has a name;
it cannot see whether the focus order matches the reading order, whether a
retry button retries, or whether focus survives an async transition.

| Check                        | Result                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lang` and `dir`             | `html lang=en dir=ltr` / `html lang=ar dir=rtl`; shell `dir` matches on both screens                                                                         |
| Accessible names             | close = "Close and go back to profile" / «إغلاق والعودة إلى الملف الشخصي»; primary = "Activate provider account" / «تفعيل حساب المهني»; progressbar labelled |
| Focus order                  | `onboarding-v2-close` → `activation-cta` in both languages — the way out, then the action                                                                    |
| Visible focus                | `outline 2px solid rgb(37, 99, 235)` under `:focus-visible`                                                                                                  |
| Keyboard operation           | activation triggered with **Enter**, not a click                                                                                                             |
| No keyboard trap             | `BODY → BUTTON → BUTTON → BODY → BUTTON → BUTTON`; focus cycles, nothing sticks                                                                              |
| Target size                  | close 44×44, primary 356×48 — nothing under 44×44                                                                                                            |
| Editable text ≥ 16 px        | no editable controls on these two screens; the check runs and reports that, rather than passing silently                                                     |
| Contrast, interactive states | rest **5.17:1**, hover **6.70:1** (en) / **6.21:1** (ar) — both above 4.5:1 for 14 px text                                                                   |
| Live status announcement     | polite region carries "Syncing your permissions. This usually takes a moment." / «تتم مزامنة صلاحياتك…»                                                      |
| Unavailable action           | `aria-disabled=true`, `aria-describedby=activation-sync-status`, and still keyboard-focusable                                                                |
| Reduced motion               | `animation-name: none` on the spinner under `prefers-reduced-motion: reduce`                                                                                 |
| Focus management on failure  | focus moves to `activation-sync-error`, which is `role="alert"`                                                                                              |
| Retry accessibility          | name "Try again" / «حاول مرة أخرى», 44 px tall, inside the alert                                                                                             |
| Keyboard operation of retry  | **Enter** on the retry completed the synchronization and navigated                                                                                           |
| Role-missing refusal         | no retry offered; copy contains no sign-in wording in either language                                                                                        |
| Focus after async transition | not detached — **but see the gap below**                                                                                                                     |

**One honest gap.** After a successful synchronization the route changes to the
hub and focus returns to `document.body`. There is no stale or detached
reference, so this is not a WCAG failure and axe reports nothing — but the new
surface does not take focus, which means a screen-reader user is returned to
the top of the document rather than being told where they have arrived. The
assertion was originally written loosely enough to pass either way; it has been
rewritten to state what actually happens and to record
`withinNewSurface=false`. Moving focus into the hub belongs to the hub, which
is Phase 5. Carried as a residual risk rather than closed.

### 2.14.3 The design decision this screen forced

The prototype draws a `Continue after sync` primary action on screen 1, and the
state contract forbids navigating anywhere until the authoritative session has
been verified to carry the provider role. Those pull in opposite directions:
drawn as the prototype draws it, the control looks actionable; `disabled` would
remove it from the tab order, taking with it the only explanation of why it
cannot be used yet.

Resolved as `aria-disabled` rather than `disabled`: the control keeps the
approved appearance, stays keyboard-reachable, is programmatically announced as
unavailable, points at the live status region through `aria-describedby` for
the reason, and its handler refuses to navigate unless
`syncState.kind === 'recovered'`. The ordering rule is not weakened — the
button cannot bypass it — and the reason is reachable by the people most likely
to need it.

This is an interaction decision, not a visual one: the prototype is a static
click-through and specifies no behaviour for this control. It is recorded here
because a reader six months from now should find it rather than infer it.

---

## 2.15 Post-restart stability and full-gate verification

Every run below was executed **after** the host restart, against the isolated
stack rebuilt from empty in §2.12.3, on the working tree described in §2.12.1.
Pre-restart results are evidence history and are not reused as evidence here.

### 2.15.1 Static gates

| Gate          | Command                                               | Exit | Result                    |
| ------------- | ----------------------------------------------------- | ---: | ------------------------- |
| Web typecheck | `pnpm --filter @homeservicemarketplace/web typecheck` |    0 | pass                      |
| Web lint      | `pnpm --filter @homeservicemarketplace/web lint`      |    0 | **0 errors, 35 warnings** |
| API typecheck | `pnpm --filter @homeservicemarketplace/api typecheck` |    0 | pass                      |
| API lint      | `pnpm --filter @homeservicemarketplace/api lint`      |    0 | **0 problems**            |
| Whitespace    | `git diff --check`                                    |    0 | clean                     |

The 35 web warnings are the same 35 the Phase 0 baseline recorded, in files
this sprint does not touch. `git diff --check` prints one CRLF advisory for
`eslint.config.mjs`; that is the pre-existing `.gitattributes`/`core.autocrlf`
condition documented in `SPRINT_09B29_BASELINE.md` §3.1, not damaged whitespace.

**The lint gate was red on the tree as recovered, and §2.5 did not say so.**
The first post-restart run reported **4,146 problems (4,111 errors, 35
warnings)**. None were in product code:

| Source                                 | Errors | Why it was being linted                                                                                                                                       |
| -------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/dist-realapi/**`             |  4,034 | the real-API browser bundle. `**/dist/**` does not match `dist-realapi`, and the directory did not exist when the ignore list was written                     |
| `apps/web/e2e/assets/vendor/**`        |     75 | lucide and floating-ui, vendored byte-for-byte and pinned by SHA-256 — upstream builds this repository must not edit                                          |
| `apps/web/e2e/assets/diff-regions.mjs` |      2 | `document` and `Image` inside a `page.evaluate()` callback, which executes in Chromium. The browser-globals block covers `apps/web/**/*.{ts,tsx}`, not `.mjs` |

Both build outputs and the vendored directory are now in `eslint.config.mjs`'s
ignore list, and `apps/web/e2e/**/*.mjs` receives Node **and** browser globals.
Nothing in `src/` changed and no rule was disabled: generated artefacts and
third-party code are what an ignore list is for.

### 2.15.2 Browser gates

| Gate                     | Configuration                 | Exit | Passed | Failed | Skipped | Flaky | Duration |
| ------------------------ | ----------------------------- | ---: | -----: | -----: | ------: | ----: | -------- |
| Real-API E2E (6 specs)   | `--workers=1`                 |    0 | **41** |      0 |       0 |     0 | 10.0 m   |
| Default shard 1/3, run 1 | `--workers=2`                 |    0 |    237 |      0 |      31 |     0 | 3.6 m    |
| Default shard 1/3, run 2 | `--workers=2`                 |    0 |    237 |      0 |      31 |     0 | 4.1 m    |
| Default shard 1/3, run 3 | `--workers=2`                 |    0 |    237 |      0 |      31 |     0 | 3.7 m    |
| Full matrix shard 1/3    | `--workers=2`                 |    0 |    237 |      0 |      31 |     0 | 3.6 m    |
| Full matrix shard 2/3    | `--workers=2`                 |    0 |    220 |      0 |      48 |     0 | 3.5 m    |
| Full matrix shard 3/3    | `--workers=2`                 |    0 |    251 |      0 |      17 |     0 | 3.7 m    |
| Visual + a11y stability  | `--workers=1 --repeat-each=5` |    0 | **40** |      0 |       0 |     0 | 15.4 m   |
| Visual + a11y, CI config | `CI=1` (workers 2)            |    0 |  **8** |      0 |       0 |     0 | 2.6 m    |

Full matrix total: **708 passed, 0 failed, 96 skipped**. `retries: 0` is
configured, so a retry is impossible by construction rather than merely
unobserved, and the string `flaky` appears zero times in every log.

**Reconciled against the pre-restart baseline** (696 passed / 96 skipped):
the +12 is exactly `prototype-reference.spec.ts` — 4 tests × 3 projects — which
needs no API and therefore belongs in the default suite as the reference-drift
guard. The skip count is unchanged because `_diagnostic-visual.real-api.spec.ts`
is now in `testIgnore` and is **not collected at all** (0 occurrences in all
three shard logs) rather than collected-and-skipped, and it did not exist when
the baseline was measured. No test was lost and no skip was introduced.

### 2.15.3 A real-API failure that was mine, not the product's

The first complete real-API run reported **40 passed, 1 failed**:

```
auth-cookies.spec.ts:263 — cross-site: the browser withholds the session,
which is why the topology is constrained
Error: page.evaluate: TypeError: Failed to fetch
```

The test navigates to `http://localhost:4011/health/live`, then fetches
`http://127.0.0.1:4011/v1/auth/me` with `credentials: 'include'`, expecting
**401** — the browser withholding `SameSite` cookies across what it treats as
two sites. It never reached the assertion: `CORS_ORIGINS` on the isolated API
listed only the preview origin, so the cross-site request was refused at CORS
and `fetch` threw.

A defect in **my stack configuration**, not in the product and not in the test.
CI's own `browser-auth-e2e` job sets
`CORS_ORIGINS: http://localhost:4010,http://127.0.0.1:4010` — both hostnames on
the API's own port, precisely so this check can run — and I had not replicated
that for port 4011. The pre-restart session never ran this spec; §2.5 lists only
`provider-activation-session.real-api` under the browser layer.

Corrected to
`http://127.0.0.1:4176,http://localhost:4176,http://localhost:4011,http://127.0.0.1:4011`.
The API was restarted **by port ownership**: the listener on 4011 was confirmed
as `node dist-phase2-e2e/main.js` before being stopped, so the developer's
`nest start --watch`, `vite` dev server and three `prisma studio` processes were
untouched — the dev API still answered 200 on 4000 afterwards and every dev
container still reported `RestartCount=0`. `auth-cookies.spec.ts` then passed
**8 of 8**, the cross-site test reaching its assertion and getting its 401.

### 2.15.4 API gates

| Gate                     | Command                                                                               | Exit | Suites | Tests |   Passed | Failed | Pending |
| ------------------------ | ------------------------------------------------------------------------------------- | ---: | -----: | ----: | -------: | -----: | ------: |
| Session integration      | `jest --runTestsByPath test/integration/provider-upgrade-session.integration.spec.ts` |    0 |      1 |     5 |    **5** |      0 |       0 |
| Full API suite, gates ON | `jest` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1`                            |    0 |    190 |  3582 | **3582** |      0 |   **0** |

The zero pending count is the proof the gates were genuinely enabled: with them
off the baseline is 2975 passed and **602 skipped**. All 602 ran and passed.

The session integration spec is what re-proves two Phase 2 contract items at the
API layer post-restart: _"refuses provider routes to an authenticated
non-provider with 403, not 401"_ (401 ≠ 403), and _"rotating a genuine
non-provider session does NOT escalate it"_ plus _"does not weaken the guards it
just passed"_ (no stale-role refresh loop, no privilege escalation).

### 2.15.5 Supply-chain and integrity gates

| Gate                                 | Command                                     | Exit | Result                                                                                                                                 |
| ------------------------------------ | ------------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen lockfile                      | `pnpm install --frozen-lockfile`            |    0 | _"Lockfile is up to date, resolution step is skipped"_; `git hash-object pnpm-lock.yaml` byte-identical before and after (`1f1b5b33…`) |
| Production audit (the CI merge gate) | `pnpm audit --prod --audit-level high`      |    0 | **0 high, 0 critical**, 2 moderate                                                                                                     |
| Full audit (report-only in CI)       | `pnpm audit`                                |    — | 65 advisories, **all dev-only**, **0 tracing to `@axe-core/playwright`**                                                               |
| Reference hashes                     | `sha256sum` + `git hash-object`/`rev-parse` |    0 | all four **UNCHANGED**, worktree = index = HEAD                                                                                        |

The full-audit advisories are confined to `vite`, `eslint`, `jest`, `turbo`,
`@nestjs/cli`, `supertest`, `jsdom`, `@types/jest`, `@tailwindcss/vite` and
`eslint-plugin-react-hooks`. CI blocks only on the production tree, on the
reasoning quoted in `ci.yml` that blocking on dev-only advisories "trains
everyone to bypass the gate".

---

## 2.15.6 The web-unit incident — chronology, root cause, and fix

This is recorded in full because a single unexplained failure was allowed to
stand for eight runs on the strength of subsequent green results, which is
exactly the reasoning this project's rules forbid.

### The incident

| #     | Run                       | Command                                     |          Exit | Tests | Failures | Note                                                          |
| ----- | ------------------------- | ------------------------------------------- | ------------: | ----: | -------: | ------------------------------------------------------------- |
| 1     | original                  | `pnpm --filter …/web test 2>&1 \| tail -12` |  not captured |  1532 |    **4** | identities destroyed by the pipe; aggregate import time 800 s |
| 2–9   | ad-hoc, ×3, ×3, cold      | same command, varied                        |             0 |  1532 |        0 | eight consecutive clean runs                                  |
| 10    | canonical-1, telemetry on | `test:ci` + JUnit                           | (harness bug) |  1532 |    **2** | **reproduced**, identities captured                           |
| 11–13 | two files isolated ×3     | `vitest run <2 files>`                      |             0 |    40 |        0 | pass alone → contention-dependent                             |
| 14    | post-fix canonical-1      | `test:ci` + JUnit                           |             0 |  1532 |        0 | 127.9 s vs 196.2 s                                            |

**The lost output was my error.** Piping the runner to `tail -12` discarded the
failing-test identities and would also have reported the pipeline consumer's
exit status rather than the runner's. Every execution since writes complete
stdout/stderr and a JUnit report to a uniquely named artefact, and reads the
runner's own exit code from a redirect.

**A second harness defect, clearly separated from any test result.** The first
telemetry wrapper polled `HasExited` and read `ExitCode` without
`WaitForExit()`, so run 10 recorded `exitCode: null`; its failure count came
from the authoritative JUnit report. Fixed with `WaitForExit()` plus a `-999`
sentinel so a null can never read as success. Separately, the first PowerShell
matrix driver failed to parse (backtick line-continuations inside `-f` format
strings) and exited 1 **without executing a single test** — a harness-script
error, not a gate result.

### The reproduced identities

| File                                                | Assertion that timed out                                 | Duration |
| --------------------------------------------------- | -------------------------------------------------------- | -------- |
| `src/app/components/provider/ProviderApp.test.tsx`  | text `540` — the `completedJobs` stat on the profile tab | 5.76 s   |
| `src/app/components/provider/WalletScreen.test.tsx` | `/Available Balance\|الرصيد المتاح/i`                    | 14.84 s  |

### Failure mode, established rather than assumed

Neither is an assertion failure, worker crash, OOM, or process termination. The
Windows Event Log for the window shows **no** Error/Warning/Critical entries, no
Resource-Exhaustion-Detector (2004), and no application-error (1000). Both are
**async find timeouts** against the 5000 ms `asyncUtilTimeout` configured in
`src/test-setup.ts`.

### Root cause

`ProviderApp` loads every tab with `React.lazy(() => import('./screens/…'))`.
In a browser that is a fetch of an already-built chunk; under Vitest it is an
**on-demand ESM transform**, and its cost lands _inside_ whichever `findBy*`
window is open when the tab is clicked. `WalletScreen.test.tsx`'s own helper
already names the hazard:

> "the wallet is a code-split route, so the click starts a dynamic import and
> the screen arrives a tick later behind Suspense"

At the suite's own full worker concurrency — measured **19–21 node processes,
1.8–2.1 GB peak** — that transform exceeds the budget, and the test then reports
the product's content as missing when what actually timed out was the bundler.
The failing run's aggregate import time was **800 s against 151–165 s** in
passing runs.

**Aggravating environmental factor, measured not guessed.** The repository lives
under `Documents\`, a Windows Defender _Controlled Folder Access_ protected
location, and is **not excluded** while real-time protection is on. Event 1124
fires continuously against `node.exe` for this path, including at 23:12:05 and
23:12:08 — bracketing the failing run's 23:12:07 start. This inflates every
filesystem-bound operation in the workspace. Excluding the repository is a
security-posture decision for the repository owner and was **not** changed here.

### Attribution

Not a product defect and not caused by this sprint:

- `ProviderApp.test.tsx`, `WalletScreen.test.tsx`, `screens/WalletScreen.tsx`
  and `screens/ProviderProfileScreen.tsx` were all **unmodified** when the
  failure reproduced.
- `ProviderApp.tsx` is modified in this tree, but only by the `/provider/activate`
  route added in Phase 2; `git diff` on it touches **no** `lazy`, `Suspense` or
  `import()` line.
- Run in isolation the two files pass **3 of 3** (40 tests each). The failure
  requires the suite's own concurrency.

### The fix — test-only, and it conceals nothing

The code-split modules are awaited at module scope in the two affected test
files, moving the transform outside the assertion window:

```ts
await Promise.all([
  import('./screens/LiveJobsScreen'),
  import('./screens/MyBidsScreen'),
  import('./screens/ProviderProfileScreen'),
]); // ProviderApp.test.tsx

await import('./screens/WalletScreen'); // WalletScreen.test.tsx
```

Verified by inspection of the diff and of the surrounding configuration:

| Prohibited shortcut      | Status                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Timeout increased        | **No.** `vitest.config.ts` and `src/test-setup.ts` are unmodified; no per-call timeout changed        |
| Retry added              | **No.** Vitest has no retry configured                                                                |
| Test skipped or disabled | **No.** No `.skip`, `.only`, `.todo`, `xit` or `xdescribe` added; test count is 1532 before and after |
| Concurrency reduced      | **No.** `vitest.config.ts` unmodified; peak worker count is unchanged at 19–21                        |
| Production code changed  | **No.** `screens/` untouched; `ProviderApp.tsx`'s only diff is the Phase 2 route                      |

**Why preloading does not weaken what the test proves.** `React.lazy` stores a
thunk and calls it on first render _regardless of whether the module is already
resolved_: `lazy` initialises its status as pending and throws the thenable, so
React still suspends, `Suspense` still renders its fallback, and the component
still mounts only after the promise settles. The lazy-plus-Suspense integration
path is therefore still exercised exactly as before. What the test no longer
races is the **latency of a cold module transform**, which is a property of the
bundler and of the machine, not of the product. Every assertion is byte-for-byte
unchanged.

### Post-fix matrix

| #   | Configuration                             |  Exit |   Passed | Failed | Skipped | Duration | Peak MB | Peak procs |
| --- | ----------------------------------------- | ----: | -------: | -----: | ------: | -------: | ------: | ---------: |
| 1   | canonical sequential                      |     0 |     1532 |      0 |       0 |  127.9 s |    2024 |         19 |
| 2   | canonical sequential                      |     0 |     1532 |      0 |       0 |  153.2 s |    1996 |         19 |
| 3   | canonical sequential                      |     0 |     1532 |      0 |       0 |  122.3 s |    2145 |         21 |
| 4   | canonical sequential                      |     0 |     1532 |      0 |       0 |  103.8 s |    2026 |         19 |
| 5   | canonical sequential                      |     0 |     1532 |      0 |       0 |  112.6 s |    2036 |         19 |
| 6   | CI-equivalent (`CI=true`)                 |     0 |     1532 |      0 |       0 |   74.5 s |    2055 |         19 |
| 7   | CI-equivalent (`CI=true`)                 |     0 |     1532 |      0 |       0 |   74.5 s |    2039 |         20 |
| 8   | CI-equivalent (`CI=true`)                 |     0 |     1532 |      0 |       0 |   74.5 s |    2130 |         19 |
| 9   | cold cache (`node_modules/.vite` removed) |     0 |     1532 |      0 |       0 |   74.6 s |    1819 |         19 |
| —   | **final canonical gate**                  | **0** | **1532** |  **0** |   **0** |   94.3 s |    2145 |         19 |

Ten consecutive clean executions, zero retries, zero flaky classifications,
`errors: 0` throughout. Artefacts:
`gate-evidence/webunit-postfix-{canonical-1..5,ci-1..3,cold}-<UTC>.junit.xml`
and `webunit-FINAL-canonical-gate-<UTC>.junit.xml`.

### A pre-existing coverage gap this investigation surfaced

The browser-level behaviour of these code-split routes is **not** covered by
Playwright, and was not before this change either:

| Route                |                                          Browser navigations in `e2e/**` |
| -------------------- | -----------------------------------------------------------------------: |
| `/provider/jobs`     |                                                                        0 |
| `/provider/bids`     |                                                                        0 |
| `/provider/messages` |                                                                        0 |
| `/provider/wallet`   |                                                                        0 |
| `/provider/profile`  | 2 — and **both redirect to `/provider/activate`** before any chunk loads |

So no Playwright spec renders `LiveJobsScreen`, `MyBidsScreen`, `WalletScreen`
or `ProviderProfileScreen` in a real browser. This change removes no coverage —
the Vitest tests still exercise lazy + Suspense, as argued above — but the claim
"real chunk loading is proven in a browser" cannot be made for these four
screens. Recorded as a residual risk with a recommended follow-up rather than
presented as satisfied.

---

## 2.16 Phase 2 exit criteria — final

All evidence below is post-restart, on branch
`fix/sprint-09b29-provider-onboarding-v2-parity` at `HEAD b4c6e25`, with no
commit and no push. GitHub CI run #118 and CodeQL #96 belong to the previously
merged PR #71 and are **not** used as evidence for anything here.

| #   | Criterion                                                          | Evidence                                                                                                                                                                               | Status   |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Screen 0 visual parity, English ≤ 0.005                            | 148 px, **0.00050**                                                                                                                                                                    | **PASS** |
| 2   | Screen 0 visual parity, Arabic ≤ 0.005                             | 154 px, **0.00052**                                                                                                                                                                    | **PASS** |
| 3   | Screen 1 visual parity, English ≤ 0.005                            | 180 px, **0.00061**                                                                                                                                                                    | **PASS** |
| 4   | Screen 1 visual parity, Arabic ≤ 0.005                             | 244 px, **0.00082**                                                                                                                                                                    | **PASS** |
| 5   | Reference / actual / diff + machine-readable evidence for all four | `visual-parity.worker-*.json` + 12 PNGs, emitted pass or fail                                                                                                                          | **PASS** |
| 6   | Threshold unchanged, no snapshot regenerated, nothing masked       | `VISUAL = { maxDiffPixelRatio: 0.005 }`; reference PNG mtimes unchanged; no `--update-snapshots` in any run                                                                            | **PASS** |
| 7   | Axe accessibility, screens 0 and 1, both languages                 | 10 scans, **0 violations at any impact**, 0 blocking; no rule disabled, no region excluded                                                                                             | **PASS** |
| 8   | Explicit accessibility assertions axe cannot decide                | 38 assertions: lang/dir, names, focus order, visible focus, keyboard operation, retry, live region, no keyboard trap, 44×44, editable text, reduced motion, interactive-state contrast | **PASS** |
| 9   | Visual + a11y stability, serial                                    | `--workers=1 --repeat-each=5` → **40/40**, 0 retries, 0 flaky                                                                                                                          | **PASS** |
| 10  | Visual + a11y stability, CI worker config                          | `CI=1` → **8/8**, 0 retries, 0 flaky                                                                                                                                                   | **PASS** |
| 11  | Default Playwright shard, three consecutive runs                   | exit 0/0/0, 237 passed each, 31 skipped, 0 flaky                                                                                                                                       | **PASS** |
| 12  | Full Playwright matrix                                             | 3 shards, exit 0/0/0, **708 passed, 0 failed, 96 skipped**; +12 vs baseline reconciled to `prototype-reference.spec.ts`                                                                | **PASS** |
| 13  | Complete real-API browser journey                                  | 6 specs, **41 passed, 0 failed, 0 skipped, 0 flaky**                                                                                                                                   | **PASS** |
| 14  | API session integration                                            | 5/5, `success: true`                                                                                                                                                                   | **PASS** |
| 15  | 401 and 403 remain distinct                                        | API: 403 for authenticated non-provider, 401 anonymous; unit: `hub-view-state` split; browser: role-missing copy contains no sign-in wording, EN and AR                                | **PASS** |
| 16  | No stale-role refresh loop, no escalation                          | rotation of a non-provider session does not escalate; one-attempt cap; guards intact after rotation                                                                                    | **PASS** |
| 17  | Full API suite with DB and Redis gates enabled                     | 190 suites, **3582/3582**, **0 pending** (vs 602 skipped with gates off)                                                                                                               | **PASS** |
| 18  | Web unit / component suite                                         | **1532/1532**, ten consecutive clean executions post-fix, 0 retries, 0 flaky                                                                                                           | **PASS** |
| 19  | Web typecheck                                                      | exit 0                                                                                                                                                                                 | **PASS** |
| 20  | Web lint, no new warnings                                          | exit 0, **0 errors, 35 warnings** = baseline                                                                                                                                           | **PASS** |
| 21  | API typecheck and lint                                             | exit 0, 0 problems                                                                                                                                                                     | **PASS** |
| 22  | Frozen-lockfile verification                                       | exit 0, lockfile byte-identical before and after                                                                                                                                       | **PASS** |
| 23  | Production dependency audit                                        | exit 0, **0 high, 0 critical**                                                                                                                                                         | **PASS** |
| 24  | Immutable reference hashes unchanged                               | all four, worktree = index = HEAD, matching the Phase 0 record                                                                                                                         | **PASS** |
| 25  | Whitespace / diff hygiene                                          | `git diff --check` exit 0                                                                                                                                                              | **PASS** |
| 26  | Verification documentation carries current evidence                | §2.12–§2.16, with every superseded pre-restart statement marked rather than deleted                                                                                                    | **PASS** |

### Residual risks carried forward, not closed

1. **Focus is not moved into the hub after a successful synchronization.**
   It returns to `document.body`; there is no stale or detached reference, so
   axe reports nothing and it is not a WCAG failure, but a screen-reader user is
   returned to the top of the document rather than told where they arrived.
   Belongs to the hub, which is Phase 5. The assertion was rewritten to state
   what actually happens instead of passing either way (§2.14.2).
2. **The four code-split provider workspace screens have no browser-level
   coverage** (§2.15.6). Pre-existing; unchanged by this phase.
3. **Defender Controlled Folder Access audits every write into the repository**,
   inflating all filesystem-bound work. An environment/security-posture matter
   for the repository owner; deliberately not changed here.
4. **`_diagnostic-visual.real-api.spec.ts` is a measurement harness, not a
   product test.** It is excluded from the default run and is retained because
   Phase 5 needs the same element-by-element comparison for screens 2–17.

### Verdict

```text
Phase 2 entry gate: PASS
Phase 2 status: COMPLETE
Phase 3 authorized to start: YES
```

---

# Phase 3 — the pending-specialty moderation deadlock

Started 2026-09-07T22:19:02Z, on branch
`fix/sprint-09b29-provider-onboarding-v2-parity` at `HEAD b4c6e25`, with Phase 2
signed off (§2.16). No commit and no push.

## 3.1 The deadlock, stated precisely

A provider selects a service. The platform does not grant it: it records a
`PENDING ProviderCategoryApplication` for an administrator to decide.
`evaluateOnboarding` then reports `specialties: AWAITING_REVIEW`.

Sprint 9B.18 introduced that code so the copy would stop telling someone who
_had_ chosen a specialty that they had not. It fixed the wording and left the
consequence: the issue still counted against completeness, at five separate
decision sites. So the provider could not reach final review and could not
submit — and the administrative decision that would clear the issue is prompted
by the application arriving in the queue, which the block prevented.

Neither party can move. The provider cannot approve their own specialty; the
administrator has nothing to look at. That is a literal deadlock, not a
theoretical one, and the repository recorded it as correct behaviour in three
places:

- `onboarding-hub-resolver.ts`: _"it stays in `blockedTasks`, so
  `collectingComplete` is still false and REVIEW_SUBMISSION stays BLOCKED. That
  is correct — the application genuinely is not submittable yet."_
- `provider-onboarding-wizard.service.spec.ts`: _"AWAITING_REVIEW blocks
  submission exactly as hard."_
- `provider-onboarding-field.ts` (shared contract): _"It still blocks
  submission, because the canonical rule is that submission needs APPROVED
  specialties."_

The sprint mandate overrides that rule: pending specialty moderation may block
**activation and work access**, and must not block **final review or
submission**.

## 3.2 The five decision sites

`evaluateOnboarding()` is **not weakened**. It still raises `AWAITING_REVIEW`
exactly as before — asserted directly by a new policy test, and by an
integration assertion on `GET …/onboarding/draft`. What changed is who each
issue is addressed to.

New in `provider-onboarding.policy.ts`:

```ts
isProviderActionIssue(issue); // false only for AWAITING_REVIEW
providerActionIssues(issues); // their move; order preserved
moderationIssues(issues); // our move
```

| #   | Site                                     | Before                                             | After                                                                                  |
| --- | ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `isOnboardingComplete`                   | `evaluateOnboarding(c).length === 0`               | provider-action issues only                                                            |
| 2   | `onboarding-hub-resolver.buildHub`       | `collectingComplete = every(!blockedTasks.has(t))` | `…!providerActionTasks.has(t)`                                                         |
| 3   | `onboarding-review-resolver.buildReview` | `canSubmit = issues.length === 0 && terms`         | `canSubmit = actionable.length === 0 && terms`; BLOCKING carries only actionable items |
| 4   | `assessSubmissionReadiness`              | every issue → `ONBOARDING_INCOMPLETE`              | provider-action issues only                                                            |
| 5   | `ProviderOnboardingWizardService.submit` | 422 when `issues.length > 0`                       | 422 when `actionable.length > 0`; `details.missing` carries only actionable items      |

Two consequential adjustments in the hub, both following from the same rule:

- `progress.complete` now counts `WAITING` as well as `COMPLETE`. The number
  answers "how much of YOUR part is done", and a task whose only outstanding
  item is our approval is done as far as the provider is concerned. The task
  keeps its own `WAITING` status, so the moderation axis stays visible — the
  number and the status say different, both-true things.
- `nextAction` reads `providerActionTasks`, so an `AWAITING_REVIEW` issue that
  maps to REVIEW cannot turn `SUBMIT` into `COMPLETE_TASK` and send the provider
  to a screen with nothing to do on it.

The shared contract's doc comment is corrected to state the new rule and to
direct consumers at `providerActionIssues()` rather than `issues.length === 0`.

## 3.3 Three existing tests asserted the deadlock

They were rewritten to assert the corrected rule. This is the same situation as
defect D1 in §2.1 — a test that pins the defect — and it is recorded rather than
done quietly:

| Spec                                         | Was                                                                                       | Now                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `onboarding-hub-resolver.spec.ts`            | _"leaves an AWAITING_REVIEW task OUT of the completed count"_ (`progress.complete === 4`) | _"COUNTS an AWAITING_REVIEW task as the provider having done their part"_ (`5`) |
| `onboarding-hub-resolver.spec.ts`            | _"keeps REVIEW_SUBMISSION blocked while an approval is outstanding"_                      | _"OPENS REVIEW_SUBMISSION while an approval is outstanding"_                    |
| `provider-onboarding-wizard.service.spec.ts` | _"refuses when only a PENDING specialty application exists"_                              | _"ACCEPTS a submission whose only outstanding item is a PENDING specialty"_     |

Each rewritten test kept its guard, and a matching negative case was added
beside it, so the change cannot be mistaken for dropping the requirement:

- a task the provider _can_ fix is still uncounted and still blocks review;
- a submission with a real gap is still refused, and the refusal names only
  fields the provider can act on — never the moderation item;
- a provider who has chosen **nothing** still gets `specialties: REQUIRED` and
  is still blocked.

## 3.4 The real-database reproduction

`apps/api/test/integration/pending-specialty-deadlock.integration.spec.ts` —
new, **19 tests**, real Postgres, real controller, real guards, gated by
`RUN_DB_INTEGRATION=1`. `WORK_ACCESS_ENFORCED` is deliberately **on**: with it
off the work-access gate falls back to the legacy status and the suite would
prove nothing about the axis it exists to protect.

The fixture is the scenario: every provider-controlled field complete, **no**
granted `ProviderProfileServiceCategory`, and one `PENDING`
`ProviderCategoryApplication`.

| Mandate step                                 | Asserted                                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Provider-controlled fields complete       | fixture; `GET …/draft` reports no actionable issue                                                                                                                                                    |
| 2. Services create PENDING applications      | `ProviderCategoryApplication.status = 'PENDING'`                                                                                                                                                      |
| 3. Return to and reload the hub              | hub fetched twice; second read identical                                                                                                                                                              |
| 4. Provider input is complete                | `progress = { complete: 5, total: 6 }`                                                                                                                                                                |
| 5. Moderation visibly pending, separate axis | `SERVICES_EXPERIENCE.status = 'WAITING'`; review WAITING group carries `SPECIALTY_REVIEW`; draft still reports `specialties: AWAITING_REVIEW`                                                         |
| 6. `nextAction` skips completed input        | `{ kind: 'SUBMIT' }`                                                                                                                                                                                  |
| 7. Final review accessible                   | `REVIEW_SUBMISSION.status = 'AVAILABLE'`; `canSubmit === true`, `blockedReason === null`                                                                                                              |
| 8. Submission succeeds                       | `POST …/submit` → 200; application leaves DRAFT; exactly one submission row                                                                                                                           |
| 9. Activation/work access still restricted   | 0 granted categories, `verified === false`, `verificationState === 'UNVERIFIED'`, `status !== 'ACTIVE'`, **0 live work-access grants**; the application stays `PENDING` — submitting approves nothing |
| 10. All layers agree                         | policy, hub, review resolver and submit command asserted through the same HTTP surface; the frontend is covered separately (§3.5)                                                                     |

Two control groups guard the repair:

- **a provider who has chosen nothing** — `SERVICES_EXPERIENCE` is `AVAILABLE`,
  `REVIEW_SUBMISSION` is `BLOCKED`, submit returns 422 with `REQUIRED` and never
  `AWAITING_REVIEW`;
- **a real gap while moderation is pending** — `bio: null` still blocks review,
  `blockedReason.field === 'bio'`, and the moderation item is never listed as a
  blocker.

One assertion was corrected during the run rather than forced: the submit moves
this provider to `DOCUMENTS_REQUIRED`, not `SUBMITTED`, because the verification
flow wants evidence. Both are handed-in states that `hubStatusOf` maps to the
hub's `SUBMITTED`; pinning the exact value would have asserted an unrelated
policy. The test asserts what this suite is actually about — the application is
no longer `DRAFT` — plus the provider-facing consequence, that the hub reports
`status: SUBMITTED` and `nextAction: AWAIT_REVIEW`.

## 3.5 The frontend needed no change, and that was verified

The rule forbids duplicating server policy in the client, so the correct outcome
here is that nothing client-side had to move. Checked rather than assumed:

- `ReviewTaskScreen`'s own header: _"THIS SCREEN DECIDES NOTHING. It renders
  `groups` in the order the server sends them, disables the button on the
  server's `canSubmit`, and shows the server's `blockedReason` … a second copy
  here would be a second policy."_
- `AWAITING_REVIEW` appears in `apps/web/src` only inside **localised copy**
  keyed by `field:code` — never in a branch that decides anything.
- `nextAction` is read from the server response; `nextActionTaskId` and
  `nextActionLabel` are presentation mappers over it.

Proven end to end by the real-API browser suite below, which drives the hub,
review and submit surfaces against the Phase 3 server.

## 3.6 Phase 3 gate results

All post-change, against the isolated stack, with the API rebuilt to
`dist-phase2-e2e` and the preview restarted on the same bundle.

| Gate                         | Command                                                    | Exit | Result                                             |
| ---------------------------- | ---------------------------------------------------------- | ---: | -------------------------------------------------- |
| API typecheck                | `pnpm --filter …/api typecheck`                            |    0 | pass                                               |
| API lint                     | `pnpm --filter …/api lint`                                 |    0 | 0 problems                                         |
| Affected API suites          | `jest --runTestsByPath` ×5 specs                           |    0 | **209/209**                                        |
| Policy spec                  | `jest …/provider-onboarding.policy.spec.ts`                |    0 | **30/30**                                          |
| Review resolver spec         | `jest …/onboarding-review-resolver.spec.ts`                |    0 | **35/35**                                          |
| Submission readiness spec    | `jest …/submission-readiness.spec.ts`                      |    0 | **28/28**                                          |
| **New deadlock integration** | `jest …/pending-specialty-deadlock.integration.spec.ts`    |    0 | **19/19**                                          |
| Full API suite, gates ON     | `jest` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` |    0 | **191 suites, 3619/3619**, 0 failed, **0 pending** |
| Web typecheck                | `pnpm --filter …/web typecheck`                            |    0 | pass                                               |
| Web lint                     | `pnpm --filter …/web lint`                                 |    0 | **0 errors, 35 warnings** = baseline               |
| Web unit                     | `test:ci`                                                  |    0 | **1532/1532**                                      |
| Real-API browser E2E         | 6 specs, `--workers=1`                                     |    0 | **41 passed, 0 failed**                            |

The API suite grew from 190 suites / 3582 tests to **191 / 3619**: +1 suite and
+37 tests (19 integration, 18 net new unit tests). Nothing was skipped and
nothing became pending.

| Default Playwright matrix | 3 shards, `--workers=2` | 0 | **708 passed, 0 failed, 96 skipped** — identical to the Phase 2 baseline |

### 3.7 Constraints the mandate placed on this repair

| Constraint                                   | Evidence                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Do not auto-approve specialties              | the integration spec asserts the application is still `PENDING` after a successful submit, and that 0 categories were granted  |
| Do not weaken `evaluateOnboarding()`         | a policy test asserts it still raises `AWAITING_REVIEW`; an integration test asserts the same through `GET …/onboarding/draft` |
| Do not duplicate server policy in the client | no client change was needed; verified by inspection (§3.5) and by 41 passing real-API browser tests                            |
| Keep activation and work access restricted   | 0 live work-access grants, `verified === false`, `status !== 'ACTIVE'` after submit, with `WORK_ACCESS_ENFORCED=true`          |
| Keep the axes independent                    | onboarding completion, moderation, account standing and work access are asserted separately in the integration spec            |

**Phase 3 status at the time §3.1–3.7 were written: COMPLETE.** No commit, no
push.

> **SUPERSEDED — read §3.8 onward.** That verdict was correct for the Phase 3
> defined at the time (repair the deadlock, prove it against a real database).
> Phase 3 was subsequently widened to require end-to-end acceptance journeys
> A–E, an isolated stack of its own, real-browser verification and 21 gates.
> §3.2's heading ("the five decision sites") is also superseded: the exhaustive
> search found **eight**. Phase 3 is **not** complete until §3.8 says so.

---

# 3.8 Phase 3, widened — acceptance journeys

## 3.8.1 Why the journeys exist

§3.1–3.7 proved the deadlock was gone. They did not prove the repair was
_narrow_. The cheapest way to make a submission gate stop refusing is to make
it stop refusing everything, and no test in §3.6 would have noticed. The
journeys close that: A proves the gate opens where it should, B proves it stays
shut where it should, and C proves that only the canonical admin decision opens
the rest.

Every journey runs against `infra/docker/docker-compose.phase3.yml` — a
throwaway stack (`hsm-phase3-it`, database `hsm_phase3_it`, tmpfs Postgres,
ephemeral host ports) that shares no name, volume, database or fixed port with
the developer's stack or with Phase 2's. Phase 3 journeys create and revoke real
moderation and work-access rows; running them against the Phase 2 database
would contaminate Phase 2's evidence.

## 3.8.2 Journey A — a pending specialty permits submission

`apps/api/test/integration/phase3-journey-a-pending-submission.integration.spec.ts`
— **22/22, exit 0.**

Unlike `pending-specialty-deadlock.integration.spec.ts`, which seeds the PENDING
application with a direct write, Journey A never writes the state under test:
the profile is opened by the real `POST /v1/me/provider/upgrade`, every input
goes through the real step endpoints, the specialty is chosen through the real
SPECIALTIES step (which is what actually files the PENDING application), and the
application is handed in through the real `POST …/submit`. Direct database
access appears only in assertions.

Evidence gaps closed before sign-off:

| Gap                                    | Resolution                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Post-submit lifecycle asserted loosely | `toContain(['SUBMITTED','DOCUMENTS_REQUIRED'])` replaced with exact `onboardingState === 'DOCUMENTS_REQUIRED'` and `status === 'PENDING_REVIEW'`                                                             |
| Audit metadata unverified              | test 10b asserts `{newState:'DOCUMENTS_REQUIRED', grantsWorkAccess:false, grantsVerifiedBadge:false}`                                                                                                        |
| Outbox contract unstated               | test 10c asserts `outboxEvent.count() === 0`; the submit transaction has **zero** outbox references (grep count 0)                                                                                           |
| Stubbed auth described ambiguously     | a header block now states that `JwtAuthGuard`→`StubJwtGuard` and `CsrfGuard`/`RolesGuard`/`ProviderCapabilityGuard`→`PassGuard`, so the suite proves policy and service behaviour and **not** authentication |

## 3.8.3 Journey B — pending moderation denies work access

`apps/api/test/integration/phase3-journey-b-work-access-denied.integration.spec.ts`
— **28/28, exit 0**, twice consecutively.

### What is real here

Journey B deliberately does **not** override the guards whose behaviour it
asserts. `ProviderCapabilityGuard`, `ProviderCapabilityService` and `RolesGuard`
are the real classes; only `JwtAuthGuard` (replaced by a stub that throws
`UnauthorizedException` when anonymous, which is why the anonymous case asserts 401) and `CsrfGuard` are substituted. That limitation is disclosed in the file
header: this suite proves **authorisation**, not authentication.

The provider genuinely holds the `provider` role, assigned by the real upgrade
endpoint, and a test asserts it — otherwise the 403 would be a role refusal and
the suite would be proving a weaker claim than it appears to.

### What it asserts

| Claim                                                           | How                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous is 401, not 403                                       | both endpoints, both route families                                                                                                                                                                         |
| The submitted provider is 403 with exactly `{code:'FORBIDDEN'}` | list, create-bid **and** withdraw                                                                                                                                                                           |
| The refusal leaks no reason                                     | the body is checked against **every** `ProviderCapabilityDenialReason` value                                                                                                                                |
| The reason is available only on the provider's own endpoint     | `GET /v1/me/provider/capabilities` → `primaryReason` is exactly `VERIFICATION_REQUIRED`                                                                                                                     |
| The refusal is not a dead end                                   | the provider retains `VIEW_OWN_PROFILE`, `EDIT_OWN_PROFILE`, `COMPLETE_ONBOARDING`, `MANAGE_VERIFICATION`                                                                                                   |
| It is the capability guard refusing, not the role guard         | a roleless outsider gets the same 403 envelope but `NO_PROVIDER_PROFILE` and an empty allow-list                                                                                                            |
| The refusal is bounded                                          | 20 consecutive calls, all 403, no drift                                                                                                                                                                     |
| It has no side effect                                           | no bid, no grant, application still `PENDING`, lifecycle unchanged, request and timeline untouched, and a before/after snapshot of audit rows and outbox is byte-identical across a fresh burst of refusals |

### Both route families, deliberately

`provider-bids.controller.ts` mounts the same handlers at canonical
`/v1/provider/bids` and legacy `/v1/me/provider/bids`. Its own comment calls the
shim "the one an attacker would find first". Every refusal above is asserted on
**both**.

### The expected reason is VERIFICATION_REQUIRED, and why

Submission writes `onboardingState: 'DOCUMENTS_REQUIRED'`. That matches none of
rank 5's onboarding values (`DRAFT`/`NOT_STARTED`/`RETURNED`/`SUBMITTED`), so
the ladder falls through to rank 6 and answers `VERIFICATION_REQUIRED` — **not**
`AWAITING_REVIEW`, which belongs to the `SUBMITTED` lifecycle value this path
does not write.

### Sensitivity proof, and a real weakness it exposed

A suite that cannot fail proves nothing, so `ProviderCapabilityGuard` was
temporarily forced to allow (`const allowed = true || …`) and Journey B re-run.

**First mutation run: 10 failed / 17 passed.** But `created no bid` **passed**,
which it should not have. Investigation: the POST answered **500**, not 201,
because the `NotificationsService` stub declared `notify` while
`ProviderBidsService.submit` calls `createForUser` — inside its transaction. The
stub threw, the transaction rolled back, and no `Bid` row was ever written. The
control was inert: it would not have detected a real bypass.

Fixed by giving the stub the method the service actually calls, and by adding a
direct probe (`never entered the bid handler at all`) that records stub calls,
so "refused at the guard" is distinguished from "attempted and rolled back" —
two very different security claims.

**Second mutation run: 13 failed / 15 passed**, now including `created no bid`,
`never entered the bid handler at all` and `touched neither the request nor its
timeline`. The controls are live.

The guard was restored and verified byte-identical:
SHA-256 `5cb7d153bc5a3908286b2bcfe8828b479d50e5394b41652db713fb56941bda31`,
`diff` against the pre-mutation copy empty, `git status` clean for that path. No
git command was used to revert it.

### Client presentation

`OnboardingHubScreen.test.tsx` — **32/32, exit 0** — gained a
`a specialty still in moderation` block driven by the payload the API actually
returns for that state (SERVICES_EXPERIENCE `WAITING`, REVIEW_SUBMISSION
`AVAILABLE`, progress 5 of 6, nextAction `SUBMIT`). It asserts the waiting
specialty is **not** an openable row, is explained as the platform's work rather
than the provider's (asserted against the copy module, so rewording is free but
a mapping reversal fails), that the review task stays open, that the primary CTA
opens REVIEW_SUBMISSION rather than the waiting task, that the server's 5-of-6
count is shown, that no action-required banner appears, and that all of it holds
in Arabic.

The V2 client already separates 401 from 403 (`hub-view-state.ts` has a distinct
`FORBIDDEN` state, with existing tests asserting a 403 is never labelled a
session problem), so Journey B needed no production change on the client.

## 3.8.4 A defect found in my own earlier work

`pending-specialty-deadlock.integration.spec.ts` did not typecheck: its `task()`
helper returned `ProviderOnboardingHubTask | undefined` and five call sites
dereferenced it (`TS2532` ×5). `pnpm --filter …/api typecheck` was therefore
**red**, contradicting the §3.6 table.

Fixed by making the helper throw with the list of tasks that _were_ present,
rather than by adding `!` or `?.`: a hub that stopped emitting
`SERVICES_EXPERIENCE` would otherwise surface as a confusing `TypeError`, or —
with `?.` — as a silently passing assertion against `undefined`.

## 3.8.5 An unrelated audit gap, noted not fixed

`AuditEventType.PROVIDER_UPGRADE_REQUESTED` exists in the Prisma schema but has
**zero** writers in `apps/api/src` (verified by grep). Provider upgrade is
therefore not audited. Discovered while asserting Journey B's audit set; out of
scope for this sprint and left for its owning module rather than fixed
opportunistically.

## 3.8.6 Journey B gate results

| Gate                     | Command                                         | Exit | Result                                  |
| ------------------------ | ----------------------------------------------- | ---: | --------------------------------------- |
| API typecheck            | `tsc --noEmit -p tsconfig.json`                 |    0 | 0 errors                                |
| API lint                 | `eslint` on all touched API specs               |    0 | 0 problems                              |
| Journey B                | `jest --runTestsByPath …journey-b… --runInBand` |    0 | **28/28**                               |
| Journey B, repeat        | same, second consecutive run                    |    0 | **28/28**                               |
| Journey B, mutated guard | same, guard forced to allow                     |    1 | **13 failed / 15 passed** (sensitivity) |
| Web typecheck (app)      | `tsc --noEmit -p tsconfig.app.json`             |    0 | 0 errors                                |
| Web typecheck (root)     | `tsc --noEmit -p tsconfig.json`                 |    0 | 0 errors                                |
| Web lint                 | `eslint` on the touched web spec                |    0 | 0 problems                              |
| Hub screen presentation  | `vitest run OnboardingHubScreen.test.tsx`       |    0 | **32/32**                               |
| Isolated stack residue   | `psql` count on `hsm_phase3_it`                 |    0 | `bids=0 requests=0 j3b_users=0`         |

**Journey B status: COMPLETE.**

## 3.8.7 Journey C — the canonical admin approval

`apps/api/test/integration/phase3-journey-c-admin-approval.integration.spec.ts`
— **24/24, exit 0**, twice consecutively.

The endpoint is `POST /v1/admin/providers/:providerProfileId/approve`
(`AdminVerificationController`, guarded by `JwtAuthGuard` + `RolesGuard('admin')`

- `CsrfGuard`). Two independent candidates are built to `PENDING_REVIEW` through
  canonical operations only — the second exists so the concurrency race has a
  fresh subject that no direct write ever touched.

### What is real

`AdminVerificationService.transition` (the conditional UPDATE, the audit write
and the notification, in one transaction), `RolesGuard`,
`ProviderCapabilityGuard`/`Service`, `AdminVerificationCaseService`, and the
**real `SecurityEventsBus`** with a recording handler subscribed, so the
post-commit fan-out is observed rather than mocked.

### What is not

`JwtAuthGuard` and `CsrfGuard` are substituted as in Journey B. Additionally —
and this one is worth stating plainly — **the admin's role claim is supplied by
the harness.** `RolesGuard` reads `user.roles` off the request. The provider's
`provider` role in Journey B is traceable to the real upgrade endpoint that
assigns it; there is no in-scope canonical operation that makes someone an
admin. The suite therefore proves the endpoint _requires_ the admin role and
refuses without it — not how that role is granted.

### What it asserts

| Claim                        | How                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only an admin decides        | anonymous 401; the provider approving **themselves** 403; one provider approving another 403; and both candidates verified untouched afterwards                                                          |
| Unknown profile              | 404 `NOT_FOUND`                                                                                                                                                                                          |
| The decision lands           | status `ACTIVE`, `reviewedByUserId` = the admin, `reviewedAt` set, stale `rejectionReason` cleared                                                                                                       |
| Audited once, completely     | exactly one `ADMIN_PROVIDER_APPROVED` row, metadata `{providerProfileId, targetUserId, previousStatus:'PENDING_REVIEW', newStatus:'ACTIVE', note}`                                                       |
| Notified once                | exactly one notification to the provider                                                                                                                                                                 |
| Published once               | the real bus emitted exactly `{userId, providerProfileId, status:'ACTIVE'}`                                                                                                                              |
| Ownership isolation          | the second candidate is unchanged and has no audit row                                                                                                                                                   |
| Idempotency                  | a repeat approve is **409**, with no second audit row, notification or event                                                                                                                             |
| Concurrency                  | 6 simultaneous approvals of one candidate → exactly **one 200 and five 409**, no third outcome, one audit row, one notification                                                                          |
| Suspension outranks approval | after `suspend`, work is 403 and `primaryReason` **changes** to `PROVIDER_SUSPENDED`; only `APPEAL_DECISION` remains; `approve` from `SUSPENDED` is 409 (reinstatement is `reactivate`, a distinct verb) |

### The finding: approval alone does not open the marketplace

`decideIfInStatus` writes `status`, `reviewedAt`, `reviewedByUserId` and
`rejectionReason` — **and nothing else**. It does not touch `verificationState`
or `onboardingState`, and it creates no `ProviderWorkAccessGrant`.

So with `WORK_ACCESS_ENFORCED` and `VERIFICATION_ENFORCED` both armed, an
admin-approved provider is **still refused work**: the capability ladder reaches
rank 6 and stops at `VERIFICATION_REQUIRED`, because ACTIVE-but-unverified is
not a working provider. The suite asserts this exactly (403 on
`/v1/provider/bids`, `primaryReason === 'VERIFICATION_REQUIRED'`, zero grants,
`verified === false`) rather than assuming it.

This is the four-axis separation working as ADR 0005 specifies — approval,
moderation, verification and work access are four different decisions, and this
endpoint makes only the first. It is recorded here because it is also a
**rollout fact an operator must know**: under the armed flags, approving a
provider in the admin UI does not by itself let them bid. The grant is issued by
the verification-case pipeline, not by this endpoint.

The specialty application is likewise still `PENDING` after approval, and zero
categories were granted — approval is not moderation either.

### Sensitivity proof

`decideIfInStatus`'s conditional scoping (`status: { in: input.from }`) was
removed from the `updateMany` `where`, making the write unconditional, and
Journey C re-run.

**Result: 2 failed / 22 passed** — precisely `lets exactly one win` and
`produced exactly one audit row and one notification`.

That the _sequential_ idempotency case (`answers 409, not a second success`)
still passed is the correct and informative outcome: the service's read check
(`args.from.includes(existing.status)`) catches a repeat, while the conditional
UPDATE is what survives a race two reviewers can both read through. The mutation
isolates exactly the guarantee it removed.

Restored byte-identical: SHA-256
`213d97c98a6e0eae12398b5296110890a00abb1c43ab0acf34a1e189b7a88f7d`, `diff`
against the pre-mutation copy empty, `git status` clean for that path. No git
command was used to revert it.

### Journey C gate results

| Gate                            | Command                                         | Exit | Result                                 |
| ------------------------------- | ----------------------------------------------- | ---: | -------------------------------------- |
| API typecheck                   | `tsc --noEmit -p tsconfig.json`                 |    0 | 0 errors                               |
| API lint                        | `eslint` on the new spec                        |    0 | 0 problems                             |
| Journey C                       | `jest --runTestsByPath …journey-c… --runInBand` |    0 | **24/24**                              |
| Journey C, repeat               | same, second consecutive run                    |    0 | **24/24**                              |
| Journey C, mutated UPDATE       | same, conditional scoping removed               |    1 | **2 failed / 22 passed** (sensitivity) |
| **Journeys A + B + C together** | `jest --runTestsByPath` ×3 `--runInBand`        |    0 | **74/74, 3 suites**                    |
| Isolated stack residue          | `psql` on `hsm_phase3_it`                       |    0 | `j3c_users=0 grants=0`                 |

**Journey C status: COMPLETE.**

## 3.8.8 Journey D — a returned application must be correctable

`apps/api/test/integration/phase3-journey-d-returned-correction.integration.spec.ts`
— **16/16, exit 0** after the fix below; **5/16 before it.**

This is the only journey so far that found a defect. It is the same bug class as
the pending-specialty deadlock, in the rejection path.

### The defect

`AdminVerificationService.transition` moved the **legacy `status` axis only**.
`decideIfInStatus` wrote `status`, `reviewedAt`, `reviewedByUserId` and
`rejectionReason` — never `onboardingState`.

So after a reviewer rejected an application:

|                   | value                                                 | consequence   |
| ----------------- | ----------------------------------------------------- | ------------- |
| `status`          | `REJECTED`                                            | correct       |
| `onboardingState` | still `DOCUMENTS_REQUIRED`, written by the submission | **the fault** |

`lifecycleState` prefers the explicit axis and falls back to the legacy status
only when the axis is `NULL`. The axis was not null, so it never reported
`RETURNED`. Downstream:

- `assertEditable` refuses `SUBMITTED` and `DOCUMENTS_REQUIRED` → the provider's
  correction was answered **409 Conflict**, "Your application is being reviewed
  and cannot be edited";
- the submit claim accepts only `NULL | NOT_STARTED | DRAFT | RETURNED` → the
  resubmit matched **zero rows** and returned **200 with no effect**, a silent
  no-op, which is worse than a refusal;
- `hubStatusOf` rendered the hub as `SUBMITTED` with `nextAction: AWAIT_REVIEW`
  — the provider was told to wait for a decision that had already been made.

**Nothing in `apps/api/src` ever wrote `onboardingState = 'RETURNED'`**
(verified by grep). The value was read in five places and written in none, so
the one lifecycle state the design reserves for "your turn" was unreachable.

The schema had said what was intended all along:

> `RETURNED` — Sent back for changes. NOT a conduct decision — a returned
> applicant is in good standing and **may edit and resubmit**.

A second, coupled gap: `ProviderOnboardingSubmission.decidedAt`,
`decidedByUserId` and `decision` — described in the schema as "written once when
a reviewer acts" — were **never written by anything**, so the submission history
could not answer who decided an application or how.

### Process — test first, this time

The earlier process failure in this sprint (production policy changed before a
failing regression test existed) was not repeated. The order of record:

1. Journey D was written asserting the **intended** behaviour, and typechecked
   and linted clean (both exit 0) **before** any production file was touched.
2. It was run and the failure captured: **11 failed / 5 passed**, exit 1, with
   the exact assertions above — `ACTION_REQUIRED` vs `SUBMITTED`, `RETURNED` vs
   `DOCUMENTS_REQUIRED`, the 409 on the correction, one submission row instead
   of two, null decision fields.
3. Only then was the smallest fix implemented.

### The fix

Two files, at the owning layer:

`provider-profile.repository.ts`

- `decideIfInStatus` takes an optional `onboardingState` and writes it **in the
  same conditional `updateMany`**, so the two axes cannot disagree — there is no
  window in which one has moved and the other has not. Omitting it leaves the
  axis untouched, so no other caller changes behaviour.
- new `stampSubmissionDecision(providerProfileId, {decidedByUserId, decision},
tx)`, scoped to `decidedAt: null`.

`admin-verification.service.ts`

- `ONBOARDING_AXIS_FOR` — `ACTIVE → ACCEPTED`, `SUSPENDED → ACCEPTED`,
  `REJECTED → RETURNED`. This is deliberately the **same** ADR 0007 mapping that
  `onboardingFromLegacy` and `lifecycleState` already apply as a _fallback_;
  those read it when the axis is null, this one writes it, so new decisions stop
  producing rows that need the fallback at all.
- `transition` passes it, and stamps the decision onto the undecided submission
  in the same transaction.

`SUSPENDED → ACCEPTED` is the deliberate entry: suspension is a conduct
decision, and rewriting a suspended provider's onboarding axis would send them
back into the wizard to fix something the wizard cannot fix.

Scoping the stamp to **undecided** rows is what produces the historical
isolation Journey D asserts: a later suspension cannot re-stamp an application
that was already accepted, and a resubmission after a rejection is decided on
its own row rather than overwriting the one the reviewer actually read.

### A regression the fix surfaced, and how it was handled

The first implementation reached `tx.providerOnboardingSubmission` directly.
Six existing tests in `admin-verification.service.spec.ts` then failed with
`Cannot read properties of undefined` — that suite's `TransactionRunner` stub
invokes its callback with `undefined`.

The fix was **not** to null-guard the write, which would have silently skipped
it whenever `tx` was absent. It was routed through the repository instead, whose
`this.db(tx)` falls back to the client — the pattern the existing
`decideIfInStatus` call in the same method already relied on.

The unit suite was then extended rather than merely repaired: three new tests
assert the mapping at that layer (rejection → `RETURNED` + a `RETURNED` stamp,
approval → `ACCEPTED` + an `ACCEPTED` stamp, suspension → `ACCEPTED`). No
existing assertion was weakened or removed; the mock gained one method.

### What Journey D asserts

| Claim                             | How                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The rejection is recorded         | `REJECTED`, reason kept, one `ADMIN_PROVIDER_REJECTED` audit naming both parties, one notification                      |
| The provider is told it came back | hub `status === 'ACTION_REQUIRED'`, `nextAction` is not `AWAIT_REVIEW`, tasks present, `onboardingState === 'RETURNED'` |
| They can correct it               | the criticised field is editable (200, not 409) and the change persists                                                 |
| They can resubmit                 | `canSubmit`, submit 200, back to `PENDING_REVIEW` / `DOCUMENTS_REQUIRED`                                                |
| Stale reasons are cleared         | `rejectionReason` null after re-approval                                                                                |
| History is preserved              | two submission rows; row 0 keeps the snapshot as reviewed and does **not** contain the correction; row 1 does           |
| The decision is attributable      | row 0 carries `decidedAt`, `decidedByUserId = admin`, `decision = 'RETURNED'`                                           |
| Isolation                         | an untouched neighbour is still `PENDING_REVIEW`, one submission, `decidedAt` null                                      |
| Decisions cannot be replayed      | reject-from-ACTIVE is a real audited transition; reject-from-REJECTED is 409                                            |

### Journey D gate results

| Gate                         | Command                                                                | Exit | Result                                             |
| ---------------------------- | ---------------------------------------------------------------------- | ---: | -------------------------------------------------- |
| Journey D **before** the fix | `jest --runTestsByPath …journey-d…`                                    |    1 | **11 failed / 5 passed** (regression evidence)     |
| Journey D **after** the fix  | same                                                                   |    0 | **16/16**                                          |
| API typecheck                | `tsc --noEmit -p tsconfig.json`                                        |    0 | 0 errors                                           |
| API lint                     | `eslint "src/**/*.ts"`                                                 |    0 | 0 problems                                         |
| Changed-file lint            | `eslint` on all 5 changed files                                        |    0 | 0 problems                                         |
| Admin unit specs             | `jest` ×2 specs                                                        |    0 | **34/34** (was 31; +3 new)                         |
| **Full API suite, gates ON** | `jest --runInBand` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` |    0 | **197 suites, 3771/3771**, 0 failed, **0 skipped** |
| **Journeys A + B + C + D**   | `jest --runTestsByPath` ×4, twice                                      |    0 | **90/90** both runs                                |

The API suite moved from the §3.6 baseline of 191 suites / 3619 tests to **197 /
3771**: +6 suites and +152 tests. Nothing was skipped and nothing became
pending.

**Journey D status: COMPLETE**, including a production fix delivered test-first.

## 3.8.9 Journey E — concurrency, ownership and input trust

`apps/api/test/integration/phase3-journey-e-concurrency-and-ownership.integration.spec.ts`
— **27/27, exit 0**, twice consecutively. No production change was needed.

Journeys A–D established what the lifecycle does. E asks whether it holds up
when the client misbehaves — a stale tab, a double-tapped button, two accounts,
a payload reaching for a column it must not set, and a read that should never be
a write. These are the failure modes that corrupt state rather than erroring,
so they do not show up on a happy path.

| Area               | Claim                                                                                                                                                                                                                                                                  | Result |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Stale version      | a write on an old version is **409**, carries `expectedVersion`/`receivedVersion` so the client knows what to reload, is not applied, and **does not burn a version** — a rejected write that advanced the counter would invalidate every other open tab for nothing   | pass   |
| Racing step writes | 5 identical PATCHes on one version → exactly **one 200 and four 409**, no third outcome, exactly one racer on the record                                                                                                                                               | pass   |
| Racing submits     | 5 concurrent submits → **all 200**, because submission is idempotent by construction rather than conflict-based (the losers get the application's real state, not an error they cannot act on) — and exactly **one** submission row, **one** audit, one lifecycle move | pass   |
| Ownership          | each provider sees only their own application; one provider's write never reaches the other's profile; the two draft version counters are independent                                                                                                                  | pass   |
| Mass assignment    | `status`, `verified`, `onboardingState`, `verificationState`, `standingState`, `userId`, `providerProfileId` each rejected **400** on step writes **and** on submit — and, the assertion that matters, **none of them applied**; no version burned                     | pass   |
| GET is not a write | 9 reads across draft/hub/review leave status, both `updatedAt` timestamps, the draft version, the submission count and the audit count identical; the same read answers the same thing twice                                                                           | pass   |

### The positive control

Journey E passed on its first run, which is exactly when a suite deserves
suspicion. The read-only assertion is the vulnerable one: if the snapshot
happened to capture nothing that ever moves, it would pass for free and read
like coverage.

So the suite contains its own control — `has a snapshot that actually detects a
write` performs one real step write and asserts the snapshot **changes**, with
`draftVersion` incremented and `draftUpdatedAt` moved. The non-mutation test is
only meaningful because that one passes alongside it.

`updatedAt` is `@updatedAt`, so a read that touched the row for any reason — a
lazy backfill, a "seen at" stamp, an autovivified draft — would move it. It is
in the snapshot precisely because that is the kind of write nobody intends.

### Journey E gate results

| Gate                         | Command                                                                | Exit | Result                                             |
| ---------------------------- | ---------------------------------------------------------------------- | ---: | -------------------------------------------------- |
| API typecheck                | `tsc --noEmit -p tsconfig.json`                                        |    0 | 0 errors                                           |
| API lint                     | `eslint` on the new spec                                               |    0 | 0 problems                                         |
| Journey E                    | `jest --runTestsByPath …journey-e… --runInBand` ×2                     |    0 | **27/27** both runs                                |
| **Full API suite, gates ON** | `jest --runInBand` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` |    0 | **198 suites, 3798/3798**, 0 failed, **0 skipped** |

## 3.8.10 Journeys A–E — combined position

|     | Journey                               |   Tests | Production change    |
| --- | ------------------------------------- | ------: | -------------------- |
| A   | pending specialty permits submission  |      22 | none                 |
| B   | pending moderation denies work access |      28 | none                 |
| C   | canonical admin approval              |      24 | none                 |
| D   | returned application is correctable   |      16 | **yes** — see §3.8.8 |
| E   | concurrency, ownership, input trust   |      27 | none                 |
|     | **total**                             | **117** |                      |

The API suite has moved from the §3.6 baseline of **191 suites / 3619 tests** to
**198 / 3798**: +7 suites, +179 tests. Nothing skipped, nothing pending.

One defect was found and fixed, test-first, with the failing run captured before
any production file was touched. Two suites were proved sensitive by mutation
(B and C) and one by an in-suite positive control (E); both mutated production
files were restored byte-identical and verified by SHA-256, `diff` and
`git status`.

**Remaining for Phase 3:** see §3.9 onward.

---

# 3.9 Journey C reopened — the complete canonical activation journey

## 3.9.1 Why the first Journey C was insufficient

§3.8.7's Journey C passed 24/24, and its own evidence is the reason it is not
enough. After `POST /v1/admin/providers/:id/approve` it recorded: specialty
still `PENDING`, verification incomplete, **no** `ProviderWorkAccessGrant`,
protected marketplace endpoints still **403**. It proved one axis moved. It did
not prove a provider can ever become operational.

The transition from "pending moderation" to "authorised to work" was therefore
unproven. What follows is the read-only call-chain audit that establishes who
owns each axis, and then the corrected journey that drives every one of them
through real endpoints.

## 3.9.2 Call-chain audit — the canonical transition table

Established by reading the controllers, services, guards and policy files. No
single endpoint owns activation; the four-axis model is real and enforced.

| #   | Concern                                                        | Canonical operation                                                                                 | Guards                                                                                              | What it writes                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Onboarding submission                                          | `POST /v1/me/provider/onboarding/submit`                                                            | `JwtAuthGuard` + `CsrfGuard`                                                                        | `onboardingState=DOCUMENTS_REQUIRED`, `status=PENDING_REVIEW`, one `ProviderOnboardingSubmission`, audit `PROVIDER_ONBOARDING_SUBMITTED`. **No outbox event.**                                                                                                                                                                               |
| 2   | Provider application approval (**status axis only**)           | `POST /v1/admin/providers/:providerProfileId/approve`                                               | `JwtAuthGuard` + `RolesGuard('admin')` + `CsrfGuard`                                                | `status=ACTIVE`, `reviewedAt/By`, `rejectionReason=null`, **`onboardingState=ACCEPTED`** (added in §3.8.8), submission decision stamp, audit `ADMIN_PROVIDER_APPROVED`, notification, `SecurityEventsBus.emitProviderStatusChanged` post-commit. **No grant, no verification, no category.**                                                 |
| 3   | Specialty / category moderation                                | `PATCH /v1/admin/category-applications/:applicationId/review` `{action:'APPROVE'\|'REJECT'}`        | `JwtAuthGuard` + `RolesGuard('admin')` + `CsrfGuard`                                                | On APPROVE: `ProviderProfileServiceCategory` join row (idempotent, `skipDuplicates`) **written first**, then `status=APPROVED`, then audit `ADMIN_CATEGORY_APPLICATION_APPROVED` — all in one transaction. Re-review → **409** (`'This application has already been reviewed.'`).                                                            |
| 4   | Verification case creation                                     | `POST /v1/me/provider/verification/case`                                                            | `JwtAuthGuard` + `ProviderCapabilityGuard` + `@RequireCapability(ManageVerification)` + `CsrfGuard` | Creates or **resumes** a case; refuses `MULTIPLE_ACTIVE_CASES` and `ALREADY_VERIFIED`. Requirements resolved from `VerificationRequirementPolicy`; `resolveRequirements` **throws** rather than resolving to an empty set, so "no policy in force" can never read as "verified with no evidence".                                            |
| 5   | Evidence supply                                                | `POST …/evidence/prepare` → `PUT …/evidence/:assetId/content` → `POST …/evidence/:assetId/finalize` | same as #4                                                                                          | Media asset + `VerificationDocument`, `scanState=PENDING`.                                                                                                                                                                                                                                                                                   |
| 6   | Evidence clearance                                             | `EvidenceScanService.scanPending()` (the scan sweep job)                                            | system actor                                                                                        | `scanState=CLEAN\|INFECTED\|SCAN_FAILED`. **Writes CLEAN only when the adapter reports `isRealScanner === true`**, so a misconfigured adapter cannot launder a verdict.                                                                                                                                                                      |
| 7   | Case submission                                                | `POST /v1/me/provider/verification/case/submit`                                                     | same as #4                                                                                          | `DRAFT\|ACTION_REQUIRED → SUBMITTED`. Readiness recomputed server-side; blockers `MISSING_EVIDENCE`, `EVIDENCE_NOT_CLEAN`, `ONBOARDING_INCOMPLETE`, `TERMS_NOT_ACCEPTED`, `WRONG_STATE`.                                                                                                                                                     |
| 8   | **Verification approval + verified state + work-access grant** | `POST /v1/admin/verification/cases/:caseId/approve`                                                 | `JwtAuthGuard` + **`PermissionsGuard`** + `@Permissions('verification:decide')` + `CsrfGuard`       | ONE transaction: case `→VERIFIED`, `VerificationDecision`, **`profileUpdate {verificationState:'VERIFIED', verified:true}`**, **`grant {open: window}`**, audit `VERIFICATION_CASE_APPROVED`, outbox `VERIFICATION_CASE_APPROVED`, provider notification. Replay-safe: an already-`VERIFIED` case returns a replay rather than acting twice. |
| 9   | Capability recomputation                                       | none — `ProviderCapabilityService.for()`                                                            | —                                                                                                   | **No cache and no recompute step.** Every guard call re-derives the ladder from three reads. There is nothing to invalidate, which is why no axis change needs a fan-out to stay correct.                                                                                                                                                    |
| 10  | Access withdrawal                                              | `POST …/cases/:caseId/revoke` \| `/reverify`; `POST /v1/admin/providers/:id/suspend`                | as #8 / #2                                                                                          | revoke/reverify close the grant and move the case to `EXPIRED`; suspend moves the **standing** axis only and leaves the grant and the verified history intact — rank 3 denies above rank 7.                                                                                                                                                  |

**Authorisation is not uniform, and that matters.** #2 and #3 are gated by the
`admin` _role_; #8 is gated by the `verification:decide` _permission_, whose
controller comment is explicit: "Guarded by `verification:decide` rather than by
'is an admin': every admin …". The seed grants that permission to `admin`
today (`ROLE_PERMISSIONS.admin = PERMISSIONS.map(p => p.key)`), and the isolated
stack confirms it, but they are different gates and the journey exercises both.

### Consequences the audit settles

- **No endpoint owns activation.** Work access requires #1, #3 and #8. #2 —
  the operation the first Journey C tested — is neither sufficient nor even
  strictly necessary for the grant; it moves the standing/onboarding axes.
- **The grant is issued only by #8**, from `computeGrantWindow` off a single
  clock read shared by the decision row, the grant start and the grant expiry.
- **Rank 6 cannot be satisfied by an admin approval.** Only #8 writes
  `verificationState = VERIFIED`.
- So §3.8.7's finding stands and is now explained: approving a provider in the
  admin UI does not let them bid, and never could — the verification case is the
  only issuer.

## 3.9.3 The corrected Journey C

`apps/api/test/integration/phase3-journey-c-activation.integration.spec.ts`
— **46/46, exit 0**, and stable across repeated runs.

`phase3-journey-c-admin-approval.integration.spec.ts` is **retained** as focused
evidence for axis 2 alone (idempotency, concurrency and ownership of the
provider-status decision). It is no longer presented as the activation journey.

### Six stages, every transition through a real endpoint

| Stage | What it drives                                                                 | Key assertions                                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | the state after submission                                                     | onboarding submitted; specialty `PENDING`; verification incomplete; **0 grants**; `/v1/provider/bids` **403** with `VERIFICATION_REQUIRED`                                                                                                                                                                                  |
| 1     | `POST /v1/admin/providers/:id/approve`                                         | status→`ACTIVE`, onboarding→`ACCEPTED`; specialty **still PENDING**; **not** verified; **still 0 grants**; **still 403**                                                                                                                                                                                                    |
| 2     | `PATCH /v1/admin/category-applications/:id/review`                             | non-admin 403, anonymous 401, unknown id 404; approves the right application; **exactly one** join row; **exactly one** audit; the other provider's application untouched; repeat → **409**; 6-way race → **one 200, five 409**; **still 403 and still 0 grants**                                                           |
| 3     | case create → prepare → PUT content → finalize → `scanPending()` → case submit | submit refused `MISSING_EVIDENCE` before evidence, then `EVIDENCE_NOT_CLEAN` before scanning; the sweep reports `{examined:1, cleared:1, quarantined:0, rejected:0, failed:0, skipped:0}` and the document moves `PENDING → CLEAN`; case → `SUBMITTED`; **still 403**                                                       |
| 4     | `POST /v1/admin/verification/cases/:id/approve`                                | provider (no `verification:decide`) **403**, anonymous 401; admin succeeds; case→`VERIFIED`; one `VerificationDecision`; `verificationState=VERIFIED`, `verified=true`; **exactly one live grant** carrying `caseId`; one audit; one outbox `verification.case.approved`; **replay adds nothing**                           |
| 5     | the same endpoints as Stage 0                                                  | list **200**; `primaryReason` **null**; `VIEW_MARKETPLACE` + `SUBMIT_BID` allowed; **a real bid is created** (201) against a genuinely biddable request; the seeker was notified and one request-timeline event written — proof the handler ran; no duplicate grant/category/audit/outbox; the second provider is still 403 |
| 6     | `suspend` then `reactivate`                                                    | work returns to **403** with `PROVIDER_SUSPENDED`; the category decision, the `VERIFIED` case, `verified=true` and the grant all **survive**; onboarding stays `ACCEPTED`; reactivation restores **200**; **no second grant is minted**                                                                                     |

### The defect Journey C found: concurrent specialty moderation

Stage 2's race failed on first run: **six simultaneous approvals returned five
200s and one 409.**

`AdminCategoryApplicationsService.review` guarded double-review with a
service-layer **read** (`if (existing.status !== 'PENDING') throw CONFLICT`)
followed by an **unconditional** `updateStatus`. At READ COMMITTED every
concurrent reviewer reads `PENDING` and proceeds. The unique constraint plus
`skipDuplicates` kept the join table to one row, so the damage was not a
duplicate category — it was the **audit trail**: one decision recorded as six
`ADMIN_CATEGORY_APPLICATION_APPROVED` events, attributed to whoever raced.

The repository's own comment had described the arrangement plainly — "A
double-review guard lives in the service layer" — which is exactly the shape
`ProviderProfileRepository.decideIfInStatus` had already been fixed away from
for the provider-status axis.

**Process:** the failing assertion was captured **before** any production change
(46-test run, 45 passed / 1 failed, exit 1).

**Fix**, mirroring `decideIfInStatus`:

- `ProviderCategoryApplicationRepository.decideIfPending(id, status, tx)` — an
  `updateMany` scoped to `status: 'PENDING'`, returning the row count.
- `AdminCategoryApplicationsService.review` uses it for both APPROVE and
  REJECT, treats `count === 0` as the same 409, and re-reads the row for its
  response. The pre-existing read is kept, and its role is now stated in the
  code: it owns the 404 and the human-readable message, **not** the guarantee.
  The loser's transaction rolls back, so the join row belongs to the winner.

Result: **one 200 and five 409**, one join row, one audit row.

The unit suite was extended rather than merely repaired — its mock gained a
faithful `decideIfPending` (moves only from `PENDING`, reports the count), the
two collaborator assertions were updated to the new method, and a new test
asserts a lost race is a 409 that records **nothing**. 13 → **14 tests**.

### A test-isolation defect this also exposed

The first full-suite run after Journey C landed failed **3** suites: Journey A,
Journey B and the pre-existing `outbox.integration.spec.ts`, all reporting 9
unexpected outbox rows.

Two separate faults, both mine, both fixed:

1. **Journey C leaked.** Its cleanup deleted outbox rows matching
   `aggregateId IN (caseIds, profileIds)`. The evidence-scan event is keyed by
   the **media asset** id, so nine rows survived. Cleanup now snapshots the
   outbox ids that existed before the suite ran and deletes exactly the
   difference — a rule a new event type keyed off something else cannot defeat.
2. **Journeys A and B asserted a whole-table outbox count of zero.** That is a
   claim about the database, not about the operation, and it was only ever true
   because nothing else emitted events. Both are now scoped to their own
   provider's aggregates. Neither assertion was weakened: A still pins that
   submission emits nothing, B still pins that a refusal changes nothing.

### Journey C gate results

| Gate                                     | Command                                                                | Exit | Result                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---: | -------------------------------------------------------- |
| Journey C **before** the concurrency fix | `jest --runTestsByPath …journey-c-activation…`                         |    1 | **45 passed / 1 failed** (regression evidence)           |
| Journey C **after**                      | same                                                                   |    0 | **46/46**                                                |
| API typecheck                            | `tsc --noEmit -p tsconfig.json`                                        |    0 | 0 errors                                                 |
| API src lint                             | `eslint "src/**/*.ts"`                                                 |    0 | 0 problems                                               |
| **API test lint**                        | `eslint "test/**/*.ts" --max-warnings=0`                               |    0 | 0 problems                                               |
| Category-applications unit               | `jest …admin-category-applications.service.spec.ts`                    |    0 | **14/14** (was 13)                                       |
| **All six journey suites**               | `jest --runTestsByPath` ×6, twice                                      |    0 | **163/163** both runs                                    |
| **Full API suite, gates ON**             | `jest --runInBand` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` |    0 | **199 suites, 3845/3845**, 0 skipped                     |
| Isolated-stack residue                   | `psql` on `hsm_phase3_it`                                              |    0 | `outbox=0 grants=0 cases=0 assets=0 bids=0 j3ca_users=0` |

**Journey C status: ACCEPTED as the complete activation journey**, with one
production defect found and fixed test-first.

---

# 3.10 Semantic audit of the Journey D production change

`apps/api/test/integration/phase3-submission-stamping-audit.integration.spec.ts`
— **12/12, exit 0** after the fixes below; **8 passed / 4 failed** before them.

§3.8.8 changed three things. `ONBOARDING_AXIS_FOR` and `decideIfInStatus` are
constrained by a conditional UPDATE and were exercised by Journey D.
`stampSubmissionDecision` was not, and the audit found **two real defects** in
it — both of the kind that corrupt a permanent record quietly.

## 3.10.1 Defect 1 — one decision stamped every undecided submission

`stampSubmissionDecision` was an `updateMany` over
`{ providerProfileId, decidedAt: null }`.

More than one undecided submission is reachable through ordinary use, with no
direct writes at all: **submit → withdraw → submit** leaves two, because
`withdraw` returns the profile to DRAFT and the next `submit` creates a second
row without touching the first.

A single approval then stamped **both** rows `ACCEPTED`, with the same
`decidedAt` and the same reviewer — including the withdrawn attempt that nobody
ever reviewed. Captured failing: `decided(rows)` had length 2, expected 1.

**Fix.** `stampSubmissionDecision` now selects the **most recent** undecided
submission (`orderBy: { submittedAt: 'desc' }`) and updates that row alone,
keeping `decidedAt: null` in the UPDATE predicate so two concurrent decisions
cannot both write it. Returns 0 or 1.

## 3.10.2 Defect 2 — conduct decisions decided applications

The stamp was driven by `ONBOARDING_AXIS_FOR[args.to]`. That mapping answers
`ACCEPTED` for **`suspend` and `reactivate`** as well as for `approve`, because
a suspended provider's application really was accepted and rewriting their axis
would send them back into the wizard.

So a suspension stamped any still-undecided application with a verdict, a date
and a reviewer — from an operator making a conduct decision who had never read
it. `approve` and `reactivate` both move status to ACTIVE, so no mapping keyed
on the target status can tell them apart.

**Fix.** A separate, explicit `stampsSubmissionAs` on the transition args, set
**only** by `approve` (`'ACCEPTED'`) and `reject` (`'RETURNED'`) and omitted by
`suspend` and `reactivate`. The axis mapping is unchanged, so §3.8.8's deadlock
fix stands — a test asserts that suspension still leaves `onboardingState` at
`ACCEPTED`.

## 3.10.3 A test of mine that was wrong

The first draft asserted that six concurrent approve/reject calls yield exactly
one 200. They yielded two, and **the product was right**:
`ADMIN_PROVIDER_TRANSITIONS.reject` includes `ACTIVE` by design — "a provider
approved in error must be stoppable" — so approve-then-reject is a legitimate
sequence.

The assertion was replaced with the invariant that actually matters: a later
decision **never overwrites** a verdict already recorded on a submission. The
application was accepted on the day it was accepted; the rejection that follows
is a decision about the provider, not a retroactive edit of the paperwork. The
profile moves; the submission's stamp does not.

## 3.10.4 Reconciling the "reject-from-ACTIVE" wording

§3.8.8's Journey D test was titled _"refuses to reject an already-approved
application twice over"_, which reads as though rejection from ACTIVE were
refused. It is not, and the test never asserted that — it asserted that the
second rejection **succeeds** as a real audited transition and that a _third_,
from REJECTED, is 409.

The published table is now asserted directly, and separately driven end to end:

| From           | approve | reject  | suspend | reactivate |
| -------------- | :-----: | :-----: | :-----: | :--------: |
| DRAFT          |   409   |   200   |   409   |    409     |
| PENDING_REVIEW | **200** |   200   |   409   |    409     |
| ACTIVE         |   409   | **200** | **200** |    409     |
| SUSPENDED      |   409   |   200   |   409   |  **200**   |
| REJECTED       |   409   |   409   |   409   |    409     |

## 3.10.5 What the audit asserts

| Claim                                                                                                                 | Result                              |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| reject stamps the current undecided submission as `RETURNED`, by this admin                                           | pass                                |
| approve stamps it as `ACCEPTED`                                                                                       | pass                                |
| a decided submission is never rewritten when a corrected application is approved (row 0 identical to the millisecond) | pass                                |
| with two undecided submissions, a decision stamps **exactly one** — the latest                                        | pass _(was failing)_                |
| suspension does not decide an undecided submission                                                                    | pass _(was failing)_                |
| reactivation does not decide an undecided submission                                                                  | pass _(was failing)_                |
| suspension does not alter an already recorded decision                                                                | pass                                |
| suspension still moves the onboarding axis to `ACCEPTED`                                                              | pass                                |
| six simultaneous approvals → one 200, rest 409, one stamp                                                             | pass                                |
| a later legal decision never overwrites an existing verdict                                                           | pass _(replaced a wrong assertion)_ |
| the documented transition matrix matches the running endpoints                                                        | pass                                |

## 3.10.6 Audit gate results

| Gate                            | Command                                                                | Exit | Result                                    |
| ------------------------------- | ---------------------------------------------------------------------- | ---: | ----------------------------------------- |
| Audit spec **before** the fixes | `jest …submission-stamping-audit…`                                     |    1 | **8 passed / 4 failed**                   |
| Audit spec **after**            | same                                                                   |    0 | **12/12**                                 |
| API typecheck                   | `tsc --noEmit -p tsconfig.json`                                        |    0 | 0 errors                                  |
| API src lint                    | `eslint "src/**/*.ts"`                                                 |    0 | 0 problems                                |
| API test lint                   | `eslint "test/**/*.ts" --max-warnings=0`                               |    0 | 0 problems                                |
| Admin verification unit         | included below                                                         |    0 | +2 tests (conduct decisions do not stamp) |
| **Full API suite, gates ON**    | `jest --runInBand` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` |    0 | **200 suites, 3859/3859**, 0 skipped      |

**Section 2 status: COMPLETE**, two production defects found and fixed
test-first.

---

# 3.11 The V1 `awaitingReview` presentation

V2's hub was already correct (§3.8.3). V1 — what a provider sees with
`VITE_PROVIDER_ONBOARDING_V2=false` — was not: the server had moved pending
specialty moderation out of `missing` and onto `awaitingReview`, and V1 rendered
neither. The provider was simply not told.

## 3.11.1 The change — additive, and server-driven

`wizard-copy.ts` gained `moderationTitle` / `moderationBody` in EN and AR:

> **We are checking your services** — You do not need to do anything. This does
> not delay your application — you can send it now.
>
> **نراجع الخدمات التي اخترتها** — لا حاجة إلى أي إجراء منك. هذا لا يؤخّر طلبك — يمكنك إرساله الآن.

`ProviderOnboardingWizard.tsx` renders `view.awaitingReview` as a **blue,
`role="status"` block**, and three properties are deliberate:

- it is **not** in the amber `missing` list;
- it is **not** conditioned on `view.complete`, because the two axes are
  independent — the provider's part can be finished while a specialty is still
  with us, which is exactly the state the old build got wrong;
- it contains **no control**, so there is nothing to press that could send
  someone back into a specialty form on which every field is already filled in.

No policy is duplicated: the component renders the server's `awaitingReview`
array and its own copy. It does not decide what is pending.

## 3.11.2 Tests

`ProviderOnboardingWizard.test.tsx` — **49/49** (was 42), a new
`V1 — a specialty still awaiting moderation` block driven by the shared
`pendingModerationDraftFixture` (the exact shape the server produces:
`complete: true`, `missing: []`, the issue on `awaitingReview`):

| Claim                                    | How                                                   |
| ---------------------------------------- | ----------------------------------------------------- |
| shown as its own status block            | `wizard-awaiting-review`, `role="status"`             |
| not in the provider-action list          | `wizard-missing` is absent entirely                   |
| nothing for them to do                   | copy asserted, and the block carries no `amber` class |
| does not block submission                | every "Send application" control is enabled           |
| does not send them back to redo the form | no button and no link inside the block                |
| the rest of V1 is preserved              | the submit control is still present                   |
| Arabic                                   | the AR strings render, and the EN string does not     |

## 3.11.3 Two web-unit failures, same cause as §2.15.6

The full web suite then failed 2/1556 —
`ProviderApp.routing.test.tsx` ("Available Balance") and
`ProviderStatusState.test.tsx`. Both **passed in isolation** and failed only
under full-suite concurrency, which is the signature of the incident §2.15.6
already root-caused: `React.lazy`'s on-demand ESM transform landing inside a
`findBy*` window and exceeding the 5s `asyncUtilTimeout`.

The first pass fixed `ProviderApp.test.tsx` and `WalletScreen.test.tsx` and
missed these two. The same fix was applied — `await import(...)` of the five
code-split screens at module scope, moving the transform outside the assertion
window.

**Nothing was concealed:** no timeout raised, no test skipped, concurrency
untouched, no retry added. Not a regression from this section's change — neither
file touches the onboarding wizard.

## 3.11.4 Section 3 gate results

| Gate                    | Command                                        | Exit | Result                               |
| ----------------------- | ---------------------------------------------- | ---: | ------------------------------------ |
| Web typecheck (app)     | `tsc --noEmit -p tsconfig.app.json`            |    0 | 0 errors                             |
| Web typecheck (root)    | `tsc --noEmit -p tsconfig.json`                |    0 | 0 errors                             |
| Web lint                | `pnpm --filter …/web lint`                     |    0 | **0 errors, 35 warnings** = baseline |
| V1 wizard spec          | `vitest run ProviderOnboardingWizard.test.tsx` |    0 | **49/49** (was 42)                   |
| **Full web unit suite** | `pnpm --filter …/web test:ci`, twice           |    0 | **105 files, 1556/1556** both runs   |

**Section 3 status: COMPLETE.** The flag-OFF _runtime_ proof (a real V1 build
with `VITE_PROVIDER_ONBOARDING_V2=false`) belongs to Section 4 and is **not yet
done**.

---

# 3.12 Section 4 — real-browser acceptance

## 3.12.1 The isolated stack, verified before use

| Fact                        | Value                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Compose project             | `hsm-phase3-it`                                                      |
| Database                    | `hsm_phase3_it`, user `hsm_p3`                                       |
| Postgres system identifier  | `7683028416377532451`                                                |
| Published ports (ephemeral) | postgres `56934`, mailpit smtp `56935` / http `56936`, redis `56937` |

Developer-owned containers present and untouched throughout:
`hsm-postgres`, `hsm-redis`, `hsm-mongo`, `hsm-mailpit`, `docker-api-1`, and the
Phase 2 stack `hsm-phase2-it-*`.

Two processes of mine from Phase 2 were found holding ports 4011
(`node dist-phase2-e2e/main.js`) and 4176 (`vite preview --outDir dist-realapi`).
Both were identified by command line and **left running** — Phase 2 is accepted
evidence — and Phase 3 took fresh ports instead.

## 3.12.2 Three build outputs, none overwriting another

| Artifact   | Built with                                                                                               | Output                     | Served on        |
| ---------- | -------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------- |
| API        | `nest build --path tsconfig.phase3-e2e.json`                                                             | `apps/api/dist-phase3-e2e` | `127.0.0.1:4012` |
| Web **V2** | `VITE_API_URL=http://127.0.0.1:4012 VITE_PROVIDER_ONBOARDING_V2=true vite build --outDir dist-phase3-v2` | `apps/web/dist-phase3-v2`  | `127.0.0.1:4177` |
| Web **V1** | same, `VITE_PROVIDER_ONBOARDING_V2=false`                                                                | `apps/web/dist-phase3-v1`  | `127.0.0.1:4178` |

`tsconfig.phase3-e2e.json` is new: three separate owners of an API build output
now exist (`dist` = the developer's watcher, `dist-phase2-e2e` = the Phase 2 API
still serving on 4011, `dist-phase3-e2e` = this one), and rebuilding into
Phase 2's would have invalidated an accepted gate. All three new outputs are
gitignored.

### Bundle hashes and the build-time flag, proved

| Bundle           | files | sha256 (content-addressed over the whole tree)                     |
| ---------------- | ----: | ------------------------------------------------------------------ |
| `dist-phase3-v2` |     9 | `2650bd142e3da91121aaaf1cc94b76f4793db698bfceea75a66e1e583a6c190d` |
| `dist-phase3-v1` |     9 | `c31ba29303482b6c1d55a73f358fb2041124690b4a8340c95914987bd24eaff0` |

The flag is proved from the **shipped JavaScript**, not from the environment
that produced it. `isProviderOnboardingV2Enabled()` ends in
`isTruthy(import.meta.env.VITE_PROVIDER_ONBOARDING_V2)`, which vite replaces at
build time with a literal. Inspecting the chunk that contains the override key
`hsm.ff.providerOnboardingV2`:

| Bundle           | entry chunk         | inlined literal |
| ---------------- | ------------------- | --------------- |
| `dist-phase3-v2` | `index-zVcnWiFv.js` | `("true")`      |
| `dist-phase3-v1` | `index-DI2hfD9g.js` | `("false")`     |

Both bundles carry `127.0.0.1:4012` as the API origin. Each preview serves its
own entry chunk (`curl` on 4177 → `index-zVcnWiFv.js`, on 4178 →
`index-DI2hfD9g.js`), so neither preview can be serving the other's bundle.
**No `localStorage` override is used anywhere in the flag proof.**

## 3.12.3 A production defect the browser layer found — the scan sweep had no caller

`EvidenceScanService.scanPending` is the only thing that moves restricted
evidence off `PENDING`. It was registered in `ProviderVerificationModule` and
exported — and **called by nothing in production**. Its only caller was its own
unit spec (verified by grep across `apps`, `packages` and `infra`).

Consequences in a running system:

- a provider uploads identity evidence and it is stored;
- nothing ever judges it, so `scanState` stays `PENDING` forever;
- `POST …/verification/case/submit` stays blocked on `EVIDENCE_NOT_CLEAN`;
- no verification case can be approved, so **no `ProviderWorkAccessGrant` is
  ever issued and no provider can ever be activated.**

Phase 3's integration Journey C did not catch this: it calls `scanPending()`
directly, which an in-process test can do and a deployed process never did.
Only driving the real API surfaced it. The repository already had the pattern
(`VerificationExpiryJob`, `OutboxCleanupJob`) — the adapter was simply missing.

**Process:** `evidence-scan.job.spec.ts` was written first and captured failing
(`Cannot find module './evidence-scan.job'`, exit 1) before any production file
was created.

**Fix** — the narrowest thing that works, shaped exactly like its two siblings:

- `EvidenceScanJob` — unref'd `setTimeout` chain, public `runOnce`, config flag,
  and a `.catch().finally(reschedule)` so a failed pass cannot silently stop the
  sweep for the process lifetime. No new scheduling dependency.
- `EVIDENCE_SCAN_WORKER_ENABLED` (default **false**), `EVIDENCE_SCAN_INTERVAL_MS`
  (60s), `EVIDENCE_SCAN_BATCH_SIZE` (25) in `env.schema.ts`.
- Registered unconditionally in the module, deciding for itself whether to
  schedule — the same reasoning as `VerificationExpiryJob`, so wiring does not
  depend on config read order.

Default OFF is safe for the same reason it is for the expiry sweep: the read
path serves `CLEAN` only and the service refuses to write `CLEAN` unless the
adapter reports `isRealScanner`. Off costs availability, never trust.

`evidence-scan.job.spec.ts` — **6/6**. Full API suite after the change:
**201 suites, 3865/3865, exit 0** (+1 suite, +6 tests; no regressions).

## 3.12.4 The chain is now reachable in a running API

`apps/web/e2e/phase3-activation-chain.real-api.spec.ts` — **8/8, exit 0.**

This is the counterpart to the integration Journey C, and it exists because the
two prove different things: the integration suite proves the chain is
**correct**, this one proves it is **reachable**. It registers a genuine account
(register → OTP from the isolated Mailpit → verify → upgrade → session refresh),
drives every step over real HTTP with real cookies and real CSRF, uploads real
PNG bytes, and then **waits for the deployed API to clear them on its own** —
nothing in the spec calls the scanner.

| Stage                   | Assertion                                                                                            | Result |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| submit                  | `canSubmit` true with a pending specialty; submit 200                                                | pass   |
| before any decision     | `/v1/provider/bids` **403**, `primaryReason=VERIFICATION_REQUIRED`                                   | pass   |
| provider approval alone | still **403**, still `VERIFICATION_REQUIRED`                                                         | pass   |
| specialty moderation    | still **403** — a granted trade is not work access                                                   | pass   |
| **evidence**            | the running API moves it to `CLEAN` unaided                                                          | pass   |
| case submit + approve   | both accepted                                                                                        | pass   |
| after activation        | the same endpoint returns **200**; `primaryReason` null; `VIEW_MARKETPLACE` and `SUBMIT_BID` allowed | pass   |
| suspend / reactivate    | 403 with `PROVIDER_SUSPENDED`, then 200 again                                                        | pass   |

### An ordering fact this established (see also §3.12.6)

Specialty moderation must precede the verification case. The case readiness
policy recomputes `evaluateOnboarding`, which raises a **provider-action**
`serviceCategories` issue while the provider holds no _granted_ trade. A pending
specialty is enough to submit the **onboarding** application — that is Phase 3's
repair — but not to ask for identity verification against a trade nobody has
approved. The canonical order is therefore: onboarding submit → provider
approval → specialty moderation → verification case → grant.

## 3.12.6 The V2 browser journey

`apps/web/e2e/phase3-v2-journey.real-api.spec.ts` — **10/10, exit 0**, and
**10/10 twice more under the CI worker configuration** (`CI=1`).

No `page.route` anywhere, and — the point of the second bundle — **no
`localStorage` flag seeding**. Every other V2 spec calls `seedFlag()`; this one
must not, because the artifact under test is the one whose build baked the flag
in. Viewport 390×844, the size the V2 rule names.

| #   | Proved through the visible UI                                                                                                                      | Where     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | genuine register → OTP from the isolated Mailpit → verify → upgrade → authoritative session refresh                                                | test 1    |
| 2   | no stale-role 403 loop after the refresh (zero 403s on the onboarding surface)                                                                     | test 1    |
| 3   | a task write is acknowledged by the server (PATCH observed 200 on the wire) **before** "Saved" appears                                             | test 2    |
| 4   | persistence across task→hub→task, hard reload, back/forward, and a real sign-out + form-and-OTP sign-in                                            | tests 2-3 |
| 5   | the pending specialty is a non-openable WAITING row explained as ours                                                                              | test 4    |
| 6   | it is absent from provider-action work; REVIEW stays actionable                                                                                    | test 4    |
| 7   | submission available and **succeeds** (200) with moderation pending                                                                                | test 5    |
| 8   | the axes stay separate: the review screen stops offering submission and says the application is with us; the hub shows SUBMITTED with no task list | test 5    |
| 9   | work refused before activation, with **no** sign-in redirect and **no** session-expiry copy                                                        | test 6    |
| 10  | no 403 retry storm (≤3 calls) and no refresh loop (≤1)                                                                                             | test 6    |
| 11  | the canonical admin chain over authenticated HTTP + CSRF                                                                                           | test 7    |
| 12  | the same work surface then **renders** — not a redirect to the activation gate — and the API serves this browser's own session 200                 | test 8    |
| 13  | suspension returns it to 403                                                                                                                       | test 9    |
| 14  | reactivation restores it, with no second grant                                                                                                     | test 9    |

Arabic runs the same journey end to end on a second provider: RTL on the
document and the shell, the CTA asserted against a **code-point-constructed**
literal (U+0625 U+0631 …) so a visually-reversed source string cannot pass, the
reversed form asserted absent from the whole page, Arabic copy asserted present
and the English fallback asserted absent.

**Axe: 15 scans across EN and AR, 0 violations of any impact, 0 blocking.**
17 named screenshots in `apps/web/e2e/__artifacts__/phase3-v2/`.

## 3.12.7 A serious accessibility defect the browser gate found

The first run that reached the activated workspace failed axe with **8 serious
color-contrast violations**. All were real WCAG 2.2 AA failures on shipped
provider surfaces, at 10-11px where the large-text allowance does not apply:

| Element                   | Measured | Required |
| ------------------------- | -------: | -------: |
| language toggle, active   |   2.15:1 |    4.5:1 |
| language toggle, inactive |   2.34:1 |    4.5:1 |
| "Welcome back" label      |   2.63:1 |    4.5:1 |
| bids empty-state subtitle |   2.51:1 |    4.5:1 |
| bottom-nav labels ×4      |   2.56:1 |    4.5:1 |
| rejected-bid chip         |   3.91:1 |    4.5:1 |

The failing axe assertion was the regression test, captured before any
production change. The axe helper was also extended to report the **node,
measured ratio and colours** rather than a bare rule name — a report that says
"8 nodes" is not actionable.

Fixed, then re-run: **0 violations**.

## 3.12.8 The fix was then corrected for the design rule

The first fix introduced raw hex literals (`#B45309`, `#475569`) into component
code, which the V2 rule forbids: "Use semantic design tokens; no one-off hex,
spacing, radius, or shadow values in screen components." Renaming a hex into a
TypeScript constant is not a token.

The token layer already carried the right vocabulary, so most of the fix became
consumption rather than invention:

| Surface                          | Now consumes                                                        |  Light |        Dark |
| -------------------------------- | ------------------------------------------------------------------- | -----: | ----------: |
| bottom-nav inactive label + icon | `text-pv-muted`                                                     | 7.58:1 | theme-aware |
| bottom-nav active label + icon   | `text-pv-accent`                                                    | 5.17:1 | theme-aware |
| "Welcome back"                   | `text-pv-muted`                                                     | 7.58:1 | theme-aware |
| bids secondary text              | `text-pv-muted`                                                     | 7.24:1 | theme-aware |
| rejected chip                    | `text-pv-danger`                                                    | 5.31:1 | theme-aware |
| V1 moderation block              | `text-pv-waiting` / `bg-pv-waiting-bg` / `border-pv-waiting-border` | 7.07:1 |      8.02:1 |

Two genuinely new tokens were added for the language toggle, which is **shared
chrome** and therefore deliberately not `--pv-*` — a provider-namespaced token
would misstate its scope:

```css
--lang-toggle-active: #b45309; /* dark: #fbbf24 */
--lang-toggle-inactive: #475569; /* dark: #cbd5e1 */
```

exposed as `--color-lang-toggle-*` so components use `text-lang-toggle-active`.
Inline one-off `fontSize`/`fontWeight` on the lines this sprint touched were
replaced with scale utilities (`text-[10px]`, `text-xs`, `font-bold`). Hex now
appears only in `theme.css` token definitions and in explanatory comments.

Both bundles were rebuilt, both flag literals and the API origin re-proved, and
both journeys re-run. No threshold was lowered and no snapshot was updated.

## 3.12.9 The V1 flag-OFF browser journey

`apps/web/e2e/phase3-v1-flag-off.real-api.spec.ts` — **5/5, exit 0**, and
**5/5 twice under CI configuration**, against `127.0.0.1:4178`.

| Claim                                                                                           | Result |
| ----------------------------------------------------------------------------------------------- | ------ |
| the served bundle has the flag compiled **off**, with the localStorage override asserted `null` | pass   |
| `/provider/onboarding` redirects away; no V2 shell, no hub task list                            | pass   |
| the Sprint 8 wizard renders (identified by vocabulary only it has)                              | pass   |
| `awaitingReview` renders as its own `role="status"` block with the moderation copy              | pass   |
| it contains **no** provider action — the amber `wizard-missing` list is absent entirely         | pass   |
| submission stays enabled and **succeeds** (200) with moderation pending                         | pass   |
| the server agrees: `missing: []`, `awaitingReview` populated                                    | pass   |
| data survives navigation, hard reload and a real sign-out/sign-in                               | pass   |
| Arabic renders RTL with Arabic copy and no English fallback                                     | pass   |
| no horizontal overflow                                                                          | pass   |
| **axe: 0 violations, 0 blocking**                                                               | pass   |

Screenshots in `apps/web/e2e/__artifacts__/phase3-v1/`.

Three defects were found in the journey specs themselves and fixed as such —
never by weakening a gate:

1. navigating to the protected route **before** login had settled (the app
   returns to the destination on its own; the spec now waits for it, which also
   became the deep-link-recovery assertion);
2. asserting a hub row after the CTA had navigated to the review screen, and a
   test id belonging to a different branch of that screen;
3. reusing a **submitted** account for the persistence test — once an
   application is in, the wizard is correctly no longer editable, so persistence
   now owns a dedicated draft account.

## 3.12.10 One transport failure, instrumented rather than dismissed

One CI-configuration run failed with a single
`Failed to load resource: net::ERR_CONNECTION_RESET`, in a run that also took
6.3 min against a normal 1.8 min. The API had **not** restarted (uptime
continuous), logged no error, and answered every request; both previews stayed
up. The evidence points to machine contention on this workstation.

It is recorded rather than omitted, and the harness was improved so a
recurrence is diagnosable rather than guessed at: `page.on('requestfailed')` now
captures the **URL, Chromium's own reason and the resource type**, and that list
is asserted empty _before_ the console check, because the console line for the
same event carries less information.

Four subsequent CI-configuration runs of that spec (two before the token work,
two after) were clean, as were both V1 CI runs. No retry was added, no timeout
raised, and nothing was reclassified as flaky.

## 3.12.11 Two mistakes of mine against the isolated stack

Both are recorded because both cost a re-run, and neither is a product fault.

**1. `--shadow-database-url` pointed at the database itself.** Running
`prisma migrate diff --from-migrations … --shadow-database-url <hsm_phase3_it>`
wiped `hsm_phase3_it`: Prisma resets the shadow database by design, and I gave
it the live one. Every table emptied — roles, permissions, users, categories,
policies — and the next suite failed with "Provider role is not configured. Run
the database seed."

Recovered by rebuilding the schema from migrations and re-seeding
(`DROP SCHEMA public CASCADE` → `prisma migrate deploy` → seed), verified at
**52 migrations applied, 3 roles, 11 permissions, 6 categories, 1 policy**, with
`verification:decide` again granted to `admin`. The isolated stack is disposable
by construction, which is the only reason this was cheap. A shadow database must
be a separate throwaway database, never the one under test.

**2. My own API competed for the outbox.** The full API suite failed
`outbox.integration.spec.ts` — "four workers drain a backlog with every event
handled exactly once" saw 106 of 120 processed and 14 DEAD, with
`No handler registered for event type "test.parallel"`. The Phase 3 API was
running against the same isolated database, and its OutboxWorker polls every
2 s; it claimed the test's events and correctly dead-lettered types it has no
handler for. The test assumes exclusive ownership of the outbox table.

Stopping only the Phase 3 API and re-running gave **201 suites, 3867/3867,
exit 0**. The Phase 2 API on 4011 was checked before and after and never
touched.

---

# 3.13 EvidenceScanJob — operational contract

Every claim below is asserted by a test, not by inspection.
`evidence-scan.job.spec.ts` (8 tests) and `evidence-scan.service.spec.ts` /
`scanner-selection.spec.ts` (37 more) run green: **45/45, exit 0**.

| #   | Requirement                                                                  | How it holds                                                                                                                                                                                                                     | Asserted by                                                                                                                    |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | overlapping passes in one process are impossible                             | the next timer is armed in `.finally()`, so a pass slower than its interval delays the next rather than running two                                                                                                              | `never runs two passes at once, however slow a pass is` — a pass is held open across five intervals and max-in-flight stays 1  |
| 2   | shutdown leaves no referenced timer or handle                                | `onModuleDestroy` sets `stopped` and clears the timer; the timer is `unref`'d so it cannot hold the process open                                                                                                                 | `holds no handle that could keep the process alive` (asserts `timer.hasRef() === false`) and `stops on shutdown`               |
| 3   | a failed pass does not stop scheduling                                       | `.catch()` logs and `.finally()` reschedules, so a rejection never escapes into the timer                                                                                                                                        | `keeps sweeping after a failed pass` — pass 1 throws, pass 2 still runs                                                        |
| 4   | two API instances cannot create duplicate decisions, audits or outbox events | the write is a conditional `updateMany` scoped to the state the worker OBSERVED; `count !== 1` returns early, so the loser writes no audit and enqueues no event. The outbox `dedupeKey` is `evidence.scanned:<assetId>:<state>` | `claims the row conditionally, so a racing worker cannot double-write` and `counts a lost race as skipped rather than cleared` |
| 5   | production refuses the test scanner                                          | `resolveScannerSelection` throws when `driver === 'test'` and the process believes it is production — a boot failure, not a degraded start                                                                                       | `REFUSES the deterministic test scanner` (production block)                                                                    |
| 6   | enabling the worker without a real scanner fails safely                      | `UnconfiguredMalwareScanner` reports `isRealScanner: false` and returns `UNAVAILABLE`; `decideScanWrite` makes `isRealScanner` a precondition of CLEAN, so the sweep examines everything and clears nothing                      | `never produces CLEAN when the adapter is not a real scanner`                                                                  |

Item 6 is the important asymmetry: arming the worker with no scanner is
**inert**, not dangerous. It denies verification; it cannot grant it.

## 3.13.1 Canonical environment documentation

`.env.example` previously documented **none** of the evidence or scanner
variables — including `EVIDENCE_MAX_BYTES`, which is **required** and without
which the API refuses to boot. A clone following that file could not start the
API at all. Now documented, with the safe default and the reason:

```bash
EVIDENCE_MAX_BYTES=10485760          # REQUIRED — the API will not boot without it
EVIDENCE_SCANNER_DRIVER=none         # none | clamav | test (test THROWS in production)
EVIDENCE_SCAN_WORKER_ENABLED=false
EVIDENCE_SCAN_INTERVAL_MS=60000
EVIDENCE_SCAN_BATCH_SIZE=25
VERIFICATION_EXPIRY_WORKER_ENABLED=false
WORK_ACCESS_ENFORCED=false
VERIFICATION_ENFORCED=false
```

`docs/deployment.md` §6 adds the operator-facing half: the chain and what gates
each link, the required production settings, the three failure modes and which
direction each fails in, and why the sweep is safe on every replica.

## 3.13.2 ROLLOUT BLOCKER — production does not enable this

This repository contains **no committed production deployment configuration**:
no `vercel.json`, `render.yaml`, `fly.toml`, Kubernetes manifests or Terraform.
`infra/docker/docker-compose.yml` is the only committed stack and it is
`NODE_ENV=development` with none of the variables above set.

So there is **nowhere that enables `EVIDENCE_SCAN_WORKER_ENABLED` with a real
scanner**, and therefore no environment in which a provider can complete
verification and be granted work access.

The isolated Phase 3 stack proves the chain works — but it does so with
`EVIDENCE_SCANNER_DRIVER=test`, the sanctioned non-production adapter that
`resolveScannerSelection` refuses to load in production. **That is deliberately
not evidence of production deployability.**

Recorded as a rollout blocker in `docs/deployment.md` §6.4. Until a production
configuration exists and sets §6.2, the provider onboarding and verification
journey is **verified but not deployable**.

---

# 3.14 Section 5 — the final gate matrix

Run against the final source state, after the semantic-token correction.

| #   | Gate                           | Command                                  |  Exit | Result                                                                                                                                                                    |
| --- | ------------------------------ | ---------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | contracts format               | `prettier --check` on changed files      |     0 | clean (see §3.14.2)                                                                                                                                                       |
| 2   | contracts typecheck            | `tsc --noEmit`                           |     0 | 0 errors                                                                                                                                                                  |
| 3   | contracts build                | `pnpm --filter …/contracts build`        |     0 | pass                                                                                                                                                                      |
| 4a  | prisma validate                | `prisma validate`                        |     0 | valid                                                                                                                                                                     |
| 4b  | migration drift                | `prisma migrate diff --exit-code`        |     0 | no drift                                                                                                                                                                  |
| 4c  | prisma generate                | `prisma generate`                        | **1** | **blocked — see §3.14.1**                                                                                                                                                 |
| 5   | API typecheck                  | `tsc --noEmit -p tsconfig.json`          |     0 | 0 errors                                                                                                                                                                  |
| 6   | API source lint                | `eslint "src/**/*.ts"`                   |     0 | 0 problems                                                                                                                                                                |
| 7   | API integration-test lint      | `eslint "test/**/*.ts" --max-warnings=0` |     0 | 0 problems                                                                                                                                                                |
| 8   | web app typecheck              | `tsc --noEmit -p tsconfig.app.json`      |     0 | 0 errors                                                                                                                                                                  |
| 9   | web root typecheck             | `tsc --noEmit -p tsconfig.json`          |     0 | 0 errors                                                                                                                                                                  |
| 10  | web lint                       | `eslint .`                               |     0 | **0 errors, 35 warnings** = baseline                                                                                                                                      |
| 11  | EvidenceScanJob + scanner      | `jest` ×3 specs                          |     0 | **45/45**                                                                                                                                                                 |
| 12  | Phase 3 journeys + audit       | `jest --runTestsByPath` ×7               |     0 | **175/175**                                                                                                                                                               |
| 13  | full API suite, DB+Redis       | `jest --runInBand`                       |     0 | **201 suites, 3867/3867**, 0 skipped                                                                                                                                      |
| 14  | full web unit suite            | `pnpm --filter …/web test:ci`            |     0 | **105 files, 1556/1556**                                                                                                                                                  |
| 15  | V2 real-browser EN/AR          | serial + CI ×3                           |     0 | **10/10** each                                                                                                                                                            |
| 16  | V1 real-browser flag-OFF EN/AR | serial + CI ×3                           |     0 | **5/5** each                                                                                                                                                              |
| 17  | full Playwright matrix         | 3 shards, `--workers=2`                  |     0 | **708 passed, 96 skipped, 0 failed** — identical to the Phase 2 baseline                                                                                                  |
| 18  | production builds              | contracts + api + web                    |     0 | all pass                                                                                                                                                                  |
| 19  | frozen-lockfile install        | `pnpm install --frozen-lockfile`         |     0 | pass                                                                                                                                                                      |
| 20  | production audit               | `pnpm audit --prod --audit-level high`   |     0 | 2 moderate, 0 high/critical — CI's own threshold                                                                                                                          |
| 21a | `git diff --check`             | —                                        |     0 | clean                                                                                                                                                                     |
| 21b | stash count                    | `git stash list`                         |     — | **4**, unchanged                                                                                                                                                          |
| 21c | reference hashes               | `sha256sum`                              |     — | **all four unchanged**                                                                                                                                                    |
| 21d | changed-file inventory         | —                                        |     — | §3.14.4                                                                                                                                                                   |
| —   | secret scan                    | grep over new files                      |     0 | only test-only literals (`*-test-secret`, `@itest.local`), matching the existing suite convention                                                                         |
| —   | compose smoke                  | **not run**                              |     — | drives the DEVELOPER-owned compose project; its inputs (`docker-compose.yml`, Dockerfiles, `compose-smoke.sh`, migrations) are untouched by Phase 3, so it must run in CI |

## 3.14.1 Why `prisma generate` could not complete

`EPERM: operation not permitted, rename … query_engine-windows.dll.node`.

The engine DLL is held open by processes this work is explicitly forbidden to
stop: the developer's `pnpm --filter …/web dev`, their Prisma/database
processes, and the **Phase 2** API (`dist-phase2-e2e/main.js`, PID 33188) whose
state is accepted evidence. Tearing down the Phase 3 stack did not release it,
because none of the holders is Phase 3-owned.

This is an environment constraint on Windows, not a code condition:

- `prisma validate` passes;
- `migrate diff --exit-code` reports **no drift**;
- `git diff HEAD -- packages/database/prisma/` is **empty** — Phase 3 added no
  model, field, enum or migration;
- therefore the committed generated client is already correct, and the full API
  suite (3867 tests, including every new Phase 3 model interaction) passes
  against it.

`prisma generate` must be run in CI, where nothing holds the DLL.

## 3.14.2 A note on `pnpm format:check`

The repository-wide `pnpm format:check` reports **747** files needing
formatting. That is pre-existing debt across the whole tree: **0** of those are
in the Phase 3 build outputs, and every file this sprint authored or edited is
Prettier-clean (verified file-by-file).

Files that were already modified in the recovered working tree but which Phase 3
did not edit — `UX_UI_DESIGN_SYSTEM.md`, `submission-readiness.spec.ts`,
`provider-onboarding-wizard.service.ts` — were deliberately **left alone**:
reformatting them would rewrite work this sprint does not own.

## 3.14.3 Two defects the full matrix caught in my own work

Both were found only because the default (stubbed) matrix was run, and both were
fixed rather than suppressed.

1. **`phase3-activation-chain.real-api.spec.ts` ran in the stubbed matrix.**
   It has no `test.skip` guard — it is API-only, so there is no page to skip on
   — and with `E2E_REAL_API` unset it failed in all three shards. Added to
   `testIgnore` alongside every other real-API spec, together with the two
   browser journeys. Adding a skip instead would have made it silently do
   nothing, which the config's own comment argues against.

2. **The V1 wizard crashed when `awaitingReview` was absent.**
   The moderation block read `view.awaitingReview.length`, and the Playwright
   stub fixtures did not send the field — so the whole wizard white-screened and
   `provider-onboarding.spec.ts` could not reach "Review & submit". Two fixes:
   the component now reads `view.awaitingReview?.length ?? 0`, because a client
   can talk to an older API for the length of a rolling deploy and a missing
   field must degrade rather than crash; and the stub fixtures now send
   `awaitingReview: []`, closing exactly the fixture-drift this repository has
   already been bitten by once.

One further failure — `ERR_FILE_NOT_FOUND` loading the approved prototype in
`prototype-reference.spec.ts` — did **not** reproduce on re-run (shard 1: 237
passed, exit 0). Three sibling tests loading the same file passed in the same
run, and all four reference files were verified byte-identical to their recorded
SHA-256 hashes immediately afterwards. Recorded as a transient concurrent
`file://` read on Windows, not a reference-integrity problem.

## 3.14.4 Changed-file inventory

**New (40):** the `EvidenceScanJob` and its spec; seven Phase 3 integration
suites plus the earlier deadlock/journey specs; `tsconfig.phase3-e2e.json`;
`infra/docker/docker-compose.phase3.yml`; four e2e files
(`phase3-activation.ts`, `phase3-activation-chain`, `phase3-v2-journey`,
`phase3-v1-flag-off`); plus the activation-screen and test-support files
carried in from earlier phases.

**Modified, production code (13):**

| File                                          | Change                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `provider-profile.repository.ts`              | `decideIfInStatus` writes the onboarding axis; new `stampSubmissionDecision` (exactly one row, race-safe) |
| `provider-category-application.repository.ts` | new `decideIfPending` conditional claim                                                                   |
| `admin-category-applications.service.ts`      | the claim replaces read-then-write                                                                        |
| `admin-verification.service.ts`               | `ONBOARDING_AXIS_FOR`; `stampsSubmissionAs` separated from the axis                                       |
| `evidence-scan.job.ts` (new)                  | the sweep's missing scheduled caller                                                                      |
| `env.schema.ts`                               | three `EVIDENCE_SCAN_*` variables                                                                         |
| `provider-verification.module.ts`             | registers the job                                                                                         |
| `ProviderApp.tsx`                             | nav contrast via `text-pv-muted` / `text-pv-accent`                                                       |
| `MyBidsScreen.tsx`                            | contrast via `text-pv-muted` / `text-pv-danger`                                                           |
| `LanguageContext.tsx`                         | contrast via the new `--lang-toggle-*` tokens                                                             |
| `ProviderOnboardingWizard.tsx`                | V1 moderation status block; defensive `awaitingReview` read                                               |
| `wizard-copy.ts`                              | EN/AR moderation copy                                                                                     |
| `theme.css`                                   | two new semantic tokens + their `@theme inline` mapping                                                   |

**Modified, configuration and docs (8):** `.env.example`, `.gitignore`,
`eslint.config.mjs`, `playwright.config.ts`, `docs/deployment.md`, this file,
plus the contracts response types carried from earlier phases.

**Modified, tests (many):** unit specs extended alongside each production
change; the V1 e2e stub fixtures corrected.

## 3.15 Teardown

| Step                                        | Result                                          |
| ------------------------------------------- | ----------------------------------------------- |
| Phase 3 API (4012) stopped                  | PID 13068 — port closed                         |
| Phase 3 V2 preview (4177) stopped           | PIDs 16684, 16800 — port closed                 |
| Phase 3 V1 preview (4178) stopped           | PIDs 30244, 20564 — port closed                 |
| `docker compose -p hsm-phase3-it … down -v` | containers, volumes and network **all removed** |
| Phase 3 containers remaining                | none                                            |
| Phase 3 volumes remaining                   | none                                            |
| Phase 3 network remaining                   | none                                            |

**Untouched, verified after teardown:** `hsm-postgres`, `hsm-redis`,
`hsm-mongo`, `hsm-mailpit`, `docker-api-1`, and the whole Phase 2 stack
(`hsm-phase2-it-postgres`, `-redis`, `-mailpit`) — all still _Up 30 hours
(healthy)_. The developer's `web dev` process and the Phase 2 API (4011 → 200)
and preview (4176 → 200) were confirmed serving after teardown.

Four stashes intact. All four immutable reference files byte-identical to the
hashes recorded at the start of this session.

## 3.16 Phase 3 verdict

**Not complete.** No Phase 3 work item is failing — every journey, audit, unit,
integration, browser and matrix gate is green — but three criteria cannot be
called green here, and one is a genuine product-level gap:

1. **ROLLOUT BLOCKER — production cannot run this journey.** No committed
   production deployment configuration exists anywhere in the repository, so
   nothing enables `EVIDENCE_SCAN_WORKER_ENABLED` with a real scanner. Without
   it, uploaded evidence is never scanned, no verification case can be approved,
   and no provider is ever granted work access. The isolated stack proves the
   chain only because it uses the sanctioned **test** scanner, which
   `resolveScannerSelection` refuses to load in production. Recorded in
   `docs/deployment.md` §6.4.
2. **`prisma generate` (gate 4c)** — blocked by file locks held by processes
   that must not be stopped (§3.14.1). Schema and migrations are unchanged, so
   the committed client is correct; the gate must be closed in CI.
3. **Compose smoke** — deliberately not run locally, because it drives the
   developer-owned compose project. Its inputs are untouched by Phase 3; it must
   be closed in CI.

Nothing has been committed, pushed, or opened as a PR, and Phase 4 has not been
started.

---

# 4 Phase 3 closure

Everything above was produced before the closure task. This section records the
seven ordered steps that close Phase 3, and it **supersedes the verdict in
§3.16**: two of the three blockers named there are now closed with evidence, and
the third is restated honestly as a product-level rollout gap rather than a gate
failure.

## 4.1 Step 1 — working-tree reconciliation

Audited read-only first, then reconciled.

| Fact                                      | Value                                            |
| ----------------------------------------- | ------------------------------------------------ |
| Branch                                    | `fix/sprint-09b29-provider-onboarding-v2-parity` |
| Base commit                               | `b4c6e25`                                        |
| Tracked files modified                    | 53                                               |
| Staged renames (the four reference files) | 4                                                |
| Untracked candidates before               | 86                                               |
| Untracked candidates after                | 63                                               |
| `git diff --check`                        | clean                                            |
| Stashes                                   | 4, all preserved                                 |
| Reference-file SHA-256                    | all four unchanged                               |

The 23 files removed from the candidate set were **generated evidence**, not
work: `apps/web/e2e/__artifacts__/` (screenshots and axe reports rewritten by
every run) and `visual-diagnostic.{json,txt}`. Both are now ignored.

Deliberately **kept tracked**, against the same instinct:

- `apps/web/e2e/__screenshots__/` — these are `toMatchSnapshot` **baselines**.
  Ignoring them would leave the visual gate with nothing to compare against.
- `apps/web/e2e/assets/vendor/` — third-party builds (lucide, floating-ui, the
  font stylesheet and ten `woff2` faces) vendored byte-for-byte so the reference
  capture is deterministic. Each is recorded with its SHA-256 in
  `manifest.json`, and `eslint.config.mjs` ignores the directory rather than
  linting code this repository must not edit.

No log, database dump, key, `.env`, OTP or test-result file is staged. The only
credential-shaped literals in the diff are the seeded **development** accounts
in `apps/web/e2e/real-api.ts`, which are pre-existing at `b4c6e25`; this
sprint's only change to that file is an `export` keyword.

One file was normalised: `provider-onboarding-wizard.service.ts` carried CRLF on
disk, which `.gitattributes` (`* text=auto eol=lf`) says the working tree must
not. Converting it changed no content — the diff stat is identical either side.

## 4.2 Step 2 — conflict C5, the duplicated Claude rule

Two copies existed:

| Path                                                                | Bytes | Lines | Tracked?                                          | Loaded by the agent? |
| ------------------------------------------------------------------- | ----: | ----: | ------------------------------------------------- | -------------------- |
| `.claude/rules/provider-onboarding-v2.md`                           |  3962 |    73 | **no** — `.gitignore` ignored `.claude/` entirely | **yes**              |
| `docs/provider-experience-v2/provider-onboarding-v2-claude-rule.md` |  3962 |    73 | yes                                               | no                   |

Byte-for-byte they differed only in YAML quote style — drift had already
started, and the copy under version control was the one nobody's session reads.

Resolution: keep the path the agent actually loads, and put _that_ under version
control. `.gitignore` gained a deliberately narrow exception —

```gitignore
.claude/*
!.claude/rules/
.claude/rules/*
!.claude/rules/*.md
```

— because git cannot re-include a child of an excluded directory, so each level
is re-excluded in turn. Verified afterwards that `.claude/settings.local.json`
and `.claude/scheduled_tasks.lock` are **still ignored**, i.e. no broad ignored
directory became tracked. The `docs/` duplicate was removed with `git rm`, and
`CLAUDE_VSCODE_EXECUTION_GUIDE.md` and `SPRINT_09B29_BASELINE.md` now point at
the canonical path.

**Canonical:** `.claude/rules/provider-onboarding-v2.md`, SHA-256
`a1185140d002ced0e63473ee9eeafe22d5c253b02a8cc85c59fb5856d2b30baa`.

## 4.3 Step 3 — Prisma generation, closed in a disposable clean room

§3.14.1 could not close `prisma generate`: on Windows the generator writes
`query_engine-windows.dll.node.tmp...` and renames it over the live file, and
the rename fails with `EPERM` while any process has the current one mapped.
Three user-owned processes did. Stopping them was not an option.

So generation was proved somewhere that has no such processes: a copy of the
tree in the system temp directory, excluding `node_modules`, `.git`, every
`dist*`, every `.env` and the generated client, installed with **its own pnpm
store** and no secrets.

| Clean-room step                  | Result                                           |
| -------------------------------- | ------------------------------------------------ |
| `pnpm install --frozen-lockfile` | exit 0 (9m05s)                                   |
| `prisma validate`                | exit 0                                           |
| **`prisma generate`**            | **exit 0 — "Generated Prisma Client (v5.22.0)"** |
| `database` build                 | exit 0                                           |
| `contracts` build                | exit 0                                           |
| API typecheck                    | exit 0                                           |
| API build                        | exit 0                                           |

The clean room and its store were then removed. No developer process,
container, volume, port or database was touched.

This is a **Windows file-locking artefact, not a schema failure** — and the
distinction is checkable rather than asserted: `prisma validate` passes on the
same schema in the working tree, and `git status` shows this sprint changed
neither `schema.prisma` nor any migration.

## 4.4 Step 4 — production-like scanner smoke

The isolated Phase 3 stack proves the activation chain with
`EVIDENCE_SCANNER_DRIVER=test`, the deterministic adapter that
`resolveScannerSelection` **refuses to load in production**. That proves the
chain and deliberately proves nothing about deployability.

`infra/docker/docker-compose.prod-smoke.yml` and
`scripts/ci/prod-scanner-smoke.sh` close that gap locally. What it is **not**: a
hosting configuration. This repository declares no production platform, and
inventing Render, Fly, Vercel, Kubernetes or Terraform configuration would be
fabricating a deployment target that does not exist.

Isolation: its own Compose project (`hsm-prodsmoke`), every service renamed, and
`ports: !override` on every one of them — without `!override` Compose _merges_
port lists and the base file's `5432:5432` would have stayed published,
colliding head-on with the developer's Postgres.

Re-run at the final source state, cold (`build --no-cache`):

| #   | Assertion                                                                          | Result |
| --- | ---------------------------------------------------------------------------------- | ------ |
| 1   | images built from current source                                                   | PASS   |
| 2   | `EVIDENCE_SCANNER_DRIVER=test` in production — **boot refused, naming the reason** | PASS   |
| 3   | a real driver with no `CLAMAV_HOST` — **boot refused, naming the missing setting** | PASS   |
| 4   | migrations applied to an empty database                                            | PASS   |
| 5   | readiness 200                                                                      | PASS   |
| 6   | running with `NODE_ENV=production`                                                 | PASS   |
| 7   | no demo accounts seeded in production mode                                         | PASS   |
| 8   | `EvidenceScanJob` armed                                                            | PASS   |
| 9   | **real `clamd` reports a valid PNG clean**                                         | PASS   |
| 10  | **real `clamd` detects EICAR — unsafe input is never cleared**                     | PASS   |
| 11  | an idle sweep writes nothing (no audit churn)                                      | PASS   |
| 12  | no duplicate outbox event for any dedupe key                                       | PASS   |
| 13  | no containers left behind                                                          | PASS   |
| 14  | no volumes left behind                                                             | PASS   |

`SMOKE_EXIT=0`. The test scanner is used **nowhere** in this configuration.

Three things this does and does not establish, kept apart on purpose:

- **Deployment-ready code** — established. The image boots under production
  settings, refuses the unsafe scanner, and scans real bytes with a real daemon.
- **An actual production deployment** — _not_ established. Nothing here is
  deployed anywhere.
- **Operator-supplied values** — still required: real secrets, a real clamd
  endpoint, TLS (this smoke sets `COOKIE_SECURE=false` because it speaks plain
  HTTP on loopback, and that line must never be copied into a real environment).

## 4.5 Step 5 — the exact CI-equivalent local gates

`.github/workflows/ci.yml` and `.github/workflows/reusable-verify.yml` were read
and their commands run verbatim, each with its own preserved exit code.

### The formatting ambiguity, resolved

**CI does not gate on Prettier.** The only matches for `prettier|format` in the
workflow files are `docker inspect --format`, `format: cyclonedx-json` and
`format: table` — no `format:check` step exists in any job. So the 747-file
repo-wide report is _documentation debt, not a merge gate_, and reformatting 747
files nobody touched would be a large unreviewable diff that fixes no failing
check. `.gitattributes` records that most of that number was once CRLF false
positives on this very machine, and the one CRLF file still in the tree was
normalised (§4.1).

What _was_ done, since the repository's declared style is Prettier even though
no job enforces it: every file in the proposed commit was checked, and the **21
of this sprint's own files** that differed were formatted. Two were deliberately
left alone:

- `.claude/rules/provider-onboarding-v2.md` — the canonical rule. Its bytes are
  the contract and its SHA-256 is recorded in §4.2; Prettier would rewrite its
  YAML quote style, which is the exact drift dimension C5 was about.
- `docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md` — an approved design
  source the rule forbids changing, and already modified by earlier work this
  closure task does not own.

This corrects §3.14.2, which claimed the sprint's files were already
Prettier-clean. They were not; they are now. The remaining repo-wide debt is
untouched and stays documented as debt.

### Results

| #   | Gate (exact command)                                                         | Result                                                                |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `pnpm install --frozen-lockfile`                                             | exit 0 — "Lockfile is up to date, resolution step is skipped"         |
| 2   | install does not rewrite `pnpm-lock.yaml`                                    | confirmed                                                             |
| 3   | `pnpm --filter contracts build`                                              | exit 0                                                                |
| 4   | `pnpm --filter database prisma:validate`                                     | exit 0                                                                |
| 5   | `pnpm --filter database generate`                                            | **EPERM on the Windows DLL rename** — closed in the clean room (§4.3) |
| 6   | `pnpm --filter database typecheck`                                           | exit 0                                                                |
| 7   | `pnpm --filter database build`                                               | exit 0                                                                |
| 8   | `pnpm --filter api lint`                                                     | exit 0                                                                |
| 8b  | `eslint "test/**/*.ts"` (beyond CI: integration-test lint)                   | exit 0                                                                |
| 9   | `pnpm --filter api typecheck`                                                | exit 0                                                                |
| 10  | `pnpm --filter api build`                                                    | exit 0                                                                |
| 11  | `pnpm --filter web lint`                                                     | exit 0 — 0 errors, 35 warnings                                        |
| 12  | `pnpm --filter web typecheck`                                                | exit 0                                                                |
| 13  | `pnpm --filter web test:ci`                                                  | exit 0 — **105 files, 1556 tests, 0 failures**                        |
| 14  | `pnpm --filter web build`                                                    | exit 0                                                                |
| 15  | migrations vs `schema.prisma` (real shadow DB)                               | "This is an empty migration" — they agree                             |
| 16  | `pnpm --filter database migrate:deploy`                                      | exit 0                                                                |
| 17  | `pnpm --filter database seed`                                                | exit 0                                                                |
| 18  | `pnpm --filter database verify:migrations`                                   | **ALL CHECKS PASSED**                                                 |
| 19  | `pnpm --filter api test` with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1` | exit 0 — **201 suites, 3867 tests, 0 failures**                       |
| 20  | Playwright full matrix, 3 shards                                             | exit 0 x3 — **708 passed, 96 skipped, 0 failed**                      |
| 21  | auth cookie contract (real browser + real API)                               | exit 0 — 8 passed                                                     |
| 22  | V2 real-API browser journey (flag-ON bundle, 4177)                           | exit 0 — 30 passed                                                    |
| 23  | V1 flag-OFF browser journey (flag-OFF bundle, 4178)                          | exit 0 — 15 passed                                                    |
| 24  | activation chain against the running API                                     | exit 0 — 24 passed                                                    |
| 25  | `pnpm audit --prod --audit-level high`                                       | exit 0 after the fix below                                            |
| 26  | gitleaks secret scan                                                         | **no leaks found** (399 commits, 11.1 MB)                             |
| 27  | production-like Docker smoke                                                 | `SMOKE_EXIT=0`, 14/14 (§4.4)                                          |
| 28  | `git diff --check`                                                           | exit 0                                                                |

The 35 web lint warnings are **all pre-existing**: three sit in files this diff
touches, and all three are on lines the diff did not add
(`ProviderApp.tsx:87`, `ProviderOnboardingWizard.tsx:484`,
`LanguageContext.tsx:103`).

Services for the DB/Redis gates were **disposable containers on ephemeral
ports** (`hsm-s5-it-postgres`, `hsm-s5-it-redis`, `hsm-s5-mailpit`), removed
afterwards. The developer's stack and the Phase 2 stack were never addressed.

### Defect 1 — my own suites broke a documented isolation invariant

The first full DB-gated run failed **1 test of 3867**:

```text
FAIL test/integration/marketplace-preview.integration.spec.ts
  - walking every page yields ONE cell for listings that share one
    Expected: 1
    Received: 2
```

`test/support/db-isolation.ts` states the contract in as many words: the
marketplace preview is a **global reader** — `{ status: 'OPEN_FOR_BIDS',
deletedAt: null }` with no ownership scope, because that is the production
surface — so it takes the `serviceRequests` advisory lock **exclusive**, and
_"every suite that creates, updates or deletes a ServiceRequest takes it
shared"_.

`phase3-journey-b-work-access-denied` and `phase3-journey-c-activation` each
create a real `OPEN_FOR_BIDS` request and took only `providerLifecycle`. One
foreign row is one extra cell, which is precisely the inscrutable
`Expected 1, Received 2` the lock exists to prevent — the suite's own comment
predicts this failure by name.

The failure was captured first, then both suites were brought into compliance:
the lock is taken **shared** and **last** (the canonical order is
`providerLifecycle -> outbox -> workAccessGrants -> serviceRequests`; two suites
taking two locks in opposite orders deadlock, and a deadlocked CI job presents
as a hang) and released **first**, after cleanup.

- Targeted rerun of the global reader beside both journeys: **3 suites, 112
  tests, 0 failures.**
- Full rerun: **201 suites, 3867 tests, 0 failures.**

Nothing was skipped, retried, timed out longer or serialised to obtain this.

### Defect 2 — four HIGH advisories in the shipped dependency tree

`pnpm audit --prod --audit-level high` is the merge gate whose passing condition
is literally _zero high, zero critical in the shipped tree_. It failed:

| Package      | Installed | Advisory                                                      | Patched  |
| ------------ | --------- | ------------------------------------------------------------- | -------- |
| `nodemailer` | 9.0.5     | GHSA-2x7j-588g-ccc2                                           | >= 9.1.0 |
| `multer`     | 2.2.0     | GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 | >= 2.3.0 |

Neither is a regression from this sprint — no production dependency was added —
but the gate is a gate, and lowering `--audit-level` was not an option.

- **nodemailer**: already declared `^9.0.1`, so `pnpm update nodemailer -r`
  resolves 9.1.1 **inside the existing range**. No manifest change.
- **multer**: reached only through `@nestjs/platform-express`, which pins
  `2.2.0` even at its latest major. A `pnpm.overrides` entry is the only route,
  and the repository already uses exactly that pattern for `ws`:

  ```json
  "overrides": {
    "ws@>=8.0.0 <8.21.0": "^8.21.3",
    "multer@<2.3.0": "^2.3.0"
  }
  ```

  Verified by resolution, not by hope: resolving `multer` _from
  `@nestjs/platform-express`_ returns **2.3.0**.

Re-run: `pnpm audit --prod --audit-level high` exit **0** (2 moderate remain,
below the gate). Every gate the change could touch was re-run afterwards —
frozen-lockfile install, API typecheck, API build, and the **full** DB/Redis
suite (201 suites / 3867 tests, exit 0) — and the production Docker smoke was
rebuilt cold from the new tree.

### An environment trap worth recording

The first Playwright shard failed 21 tests with the wizard white-screening on
`Cannot read properties of undefined (reading 'length')`. The stack resolved,
through the minified bundle, to the **V2** hub reading `n.tasks.length` — the V2
hub, in a suite that stubs the V1 contract.

Cause: `apps/web/.env` is a **developer-local, untracked** file, dated well
before this sprint, that sets `VITE_PROVIDER_ONBOARDING_V2=true`. Vite loads it
at build time, so a plain local `pnpm --filter web build` produces a _flag-ON_
bundle, while CI — a clean checkout with no such file — produces a flag-OFF one.
The suite was therefore never testing what CI tests.

Rebuilt with the flag passed explicitly (shell env overrides the `.env` file),
and the artefact re-inspected rather than the environment trusted: the entry
chunk inlines `("false")`. All three shards then passed. The same cause explains
the `prototype-reference` screen-0 failure noted in §3.14.3 — it did not recur
against the correct bundle.

The developer's `.env` was **not** modified, renamed or deleted.

### Bundle identity for the two browser journeys

| Bundle                  | entry chunk         | inlined flag literal | tree SHA-256                                                       |
| ----------------------- | ------------------- | -------------------- | ------------------------------------------------------------------ |
| `dist-phase3-v2` (4177) | `index-6cQGp7qy.js` | `"true"`             | `246a753cbabb3d35d8bed57e81c9764bf86e7894d90ff518bead773a56fdb102` |
| `dist-phase3-v1` (4178) | `index-DNV5WEZn.js` | `"false"`            | `05e509631bb2aa60a4c9b10d10a4cb368b49149837008ce2b4e1710cb2c5a540` |

`curl` on each preview returns its own entry chunk, so neither can be serving
the other's bundle. No `localStorage` override is used anywhere in the flag
proof. (These hashes supersede §3.12.2's, which predate the accessibility fix in
§3.12.8; the CSS chunk `index-N9EU5Eht.css` is identical to the one the plain
`dist` build produces, confirming both bundles come from the current source.)

## 4.6 Step 5 teardown

| Item                                                      | Result                                 |
| --------------------------------------------------------- | -------------------------------------- |
| Phase 3 API (4012), previews (4177, 4178)                 | stopped; ports closed                  |
| Auth-contract API (4010)                                  | stopped; port closed                   |
| `docker compose -f docker-compose.phase3.yml down -v`     | containers, volume and network removed |
| `hsm-s5-it-postgres`, `hsm-s5-it-redis`, `hsm-s5-mailpit` | removed                                |
| `hsm-prodsmoke-*`                                         | removed by the smoke's own teardown    |

**Untouched and verified afterwards:** `hsm-postgres`, `hsm-redis`, `hsm-mongo`,
`hsm-mailpit`, `docker-api-1` (health 200), and the whole Phase 2 stack
(`hsm-phase2-it-*`, API 4011 health 200, preview 4176 → 200). The developer's
Vite dev server is still listening on 5173. Four stashes intact.

# 5 Phase 3 publication

§4 closed the seven local steps. Nothing in it had been **published**: at the
start of this session the remote was `develop` `563cfe73` with no 9B.29 branch,
commit, PR or verification document, and even the sprint's base commit `b4c6e25`
was unpushed. This section records the recovery audit that established that, the
two defects the pre-commit review found, the gates re-run against the final
source, and the publication itself.

## 5.1 Recovery audit — read-only, before anything was touched

No `reset`, `clean`, `checkout`, `stash`, `commit` or formatting ran until the
inventory below had been taken and compared with §4.

| Fact                          | Value                                            |
| ----------------------------- | ------------------------------------------------ |
| Branch                        | `fix/sprint-09b29-provider-onboarding-v2-parity` |
| HEAD                          | `b4c6e25` — local only, no tracking ref          |
| `origin/develop`              | `563cfe73`                                       |
| 9B.29 refs on the remote      | **none**                                         |
| Tracked modified              | 55                                               |
| Staged (1 delete + 4 renames) | 5                                                |
| Untracked, not ignored        | 72                                               |
| `git diff --check`            | exit 0                                           |
| Stashes                       | 4, all intact                                    |

**Everything §4 recorded survived.** Each checkable claim was re-measured rather
than assumed:

| §4 claim                                      | Recorded          | Measured                                             |
| --------------------------------------------- | ----------------- | ---------------------------------------------------- |
| Untracked candidates after reconciliation     | 63                | 63¹                                                  |
| Staged renames                                | 4                 | 4                                                    |
| Stashes                                       | 4                 | 4                                                    |
| Canonical rule SHA-256                        | `a1185140…b30baa` | `a1185140…b30baa`                                    |
| `.claude/rules/*.md` un-ignored, rest ignored | required          | confirmed by `git check-ignore`                      |
| Prototype reference SHA-256                   | `c5ceb93a…725b9`  | `c5ceb93a…725b9`                                     |
| `multer` override / `nodemailer` bump         | present           | lockfile resolves `multer@2.3.0`, `nodemailer@9.1.1` |

Two deltas against §4, both explained and neither a loss of work:

- **53 → 55 tracked-modified.** `package.json` and `pnpm-lock.yaml`, changed
  after §4.1's audit by the §4.5 dependency fix.
- **63 → 72 untracked.** Nine files, all of them §5.2's first defect.

¹ after excluding those nine.

## 5.2 Two defects the pre-commit review found

### Defect 3 — real evidence media sat outside the ignore rule

`.gitignore` carried `apps/api/.restricted-uploads/` under a comment stating
that the store "has never been tracked, and one `git add -A` is all it would
take. Ignored so that stays true."

That sentence was false. `LocalDiskRestrictedStorageAdapter.rootDir()` resolves
`join(process.cwd(), '.restricted-uploads')`, so the store follows the process,
not the package — `apps/api/` under `nest start`, but the **repository root**
under the isolated Phase 3 stack, which runs `node dist-phase3-e2e/main.js` from
there. Nine real verification images — identity evidence, the exact class of
file the rule exists to keep out of git — were sitting un-ignored at the root,
one `git add -A` from being published to a public repository.

The pattern is now unanchored (`.restricted-uploads/`), so it matches the store
at any depth and the comment is true in every launch configuration. Verified
with `git check-ignore` at both paths, and `git ls-files` confirms nothing under
either has ever been tracked. Untracked-and-not-ignored returned to 63, which is
the §4.1 figure.

### Defect 4 — `pnpm format` would have rewritten the files whose bytes are the contract

Four groups of files in this sprint are byte-exact by design:

| File                                       | Why its bytes matter                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `apps/web/e2e/assets/vendor/**` (15 files) | SHA-256 recorded in `manifest.json`; the deterministic visual gate compares against them |
| `docs/…/reference/**`                      | the drift guard hash in §2.7                                                             |
| `.claude/rules/provider-onboarding-v2.md`  | the C5 canonical hash in §4.2                                                            |
| `docs/…/UX_UI_DESIGN_SYSTEM.md`            | an approved design source the rule forbids changing                                      |

§4.5 protected them by _deciding not to run Prettier over them_ — a decision
recorded in prose, which nothing enforces. `.prettierignore` listed none of
them, so the root `format` script would rewrite all four groups, and the husky
`lint-staged` hook, which runs `prettier --write` on staged `*.md` and `*.json`,
would have rewritten the canonical rule and the vendor manifest **during the
very commit that publishes them** — silently invalidating the C5 hash this
sprint exists to have fixed.

They are now in `.prettierignore`, so the guarantee is enforced by the tool
rather than by remembering. With them excluded, all **103** of the sprint's
formattable files pass `prettier --check` — the §4.5 claim, now true by
construction instead of by exception.

## 5.3 Clean room, re-run against the final source

§4.3's clean room ran **before** the §4.5 dependency fix, so its
`prisma generate` evidence described a tree that no longer existed. It was
re-run from scratch on the tree being committed.

Method unchanged: the working tree copied to a disposable directory excluding
`node_modules`, `.git`, every `dist*`, the generated client and **every `.env`**,
with its own pnpm store. Exclusions verified after the copy rather than assumed
(no `.env` present, no `node_modules`, no pre-existing client). CI's own stub
`DATABASE_URL=postgresql://ci:ci@localhost:5432/ci_db` — the literal value in
`reusable-verify.yml` — was written, because the `database` scripts wrap
`dotenv -e ../../.env`.

| Gate                             | Result                                           |
| -------------------------------- | ------------------------------------------------ |
| `pnpm install --frozen-lockfile` | **exit 0**, 535 s                                |
| lockfile unmodified by install   | confirmed byte-identical                         |
| `prisma:validate`                | exit 0                                           |
| **`prisma generate`**            | **exit 0 — "Generated Prisma Client (v5.22.0)"** |
| `database typecheck`             | exit 0                                           |
| `database build`                 | exit 0                                           |
| `contracts build`                | exit 0                                           |
| `api typecheck`                  | exit 0                                           |
| `api build`                      | exit 0                                           |
| `web typecheck`                  | exit 0                                           |

This confirms §4.3's diagnosis on the current tree: gate 5's `EPERM` is a
Windows DLL-rename artefact of the developer's own running processes, not a
schema or lockfile failure.

**Three false starts, recorded because each was a real environment trap:**

1. `robocopy /E` — Git Bash rewrote the bare switch into the path `E:/`.
2. Setting `MSYS_NO_PATHCONV=1` globally to fix (1) then broke `pnpm` itself:
   the shim's own `/c/nvm4w/...` self-reference stopped being converted, and
   node died with `MODULE_NOT_FOUND` on `C:\c\nvm4w\...\corepack\dist\pnpm.js`.
   The guard now scopes to the single `robocopy` subshell.
3. Overriding `PNPM_HOME` to isolate the store pointed corepack at an empty
   directory, with the same symptom. Only `npm_config_store_dir` needs
   overriding, and that is what isolates the store.

## 5.4 Production-like scanner smoke, re-run in this session

Re-run cold (`build --no-cache`) against the source being published, rather than
relying on §4.4's record. Its own Compose project, ephemeral ports, tmpfs
Postgres.

| #     | Assertion                                                                          | Result |
| ----- | ---------------------------------------------------------------------------------- | ------ |
| 1     | images built from current source                                                   | PASS   |
| 5     | `EVIDENCE_SCANNER_DRIVER=test` in production — **boot refused, naming the reason** | PASS   |
| 6     | a real driver with no `CLAMAV_HOST` — **boot refused, naming the missing setting** | PASS   |
| 2–4   | migrations applied to an empty database; readiness 200; `NODE_ENV=production`      | PASS   |
| 3     | no demo accounts seeded in production mode                                         | PASS   |
| 7     | `EvidenceScanJob` armed                                                            | PASS   |
| 8     | **real `clamd` reports a valid PNG clean**                                         | PASS   |
| 9     | **real `clamd` detects EICAR — unsafe input is never cleared**                     | PASS   |
| 10–11 | an idle sweep writes nothing; no duplicate outbox event for any dedupe key         | PASS   |
| 12    | no containers and no volumes left behind                                           | PASS   |

`SMOKE_EXIT=0`, 14 of 14. The deterministic test scanner is used **nowhere** in
this configuration.

Afterwards: `hsm-prodsmoke-*` containers **0**, volumes **0**. The developer's
stack (`hsm-postgres`, `hsm-redis`, `hsm-mongo`, `hsm-mailpit`, `docker-api-1`)
was healthy before and after, and the four stashes are intact.

## 5.5 Local gates re-run against the published tree

Only the two ignore files changed after §4.5, and neither can alter compiled
output or test behaviour. The fast gates were nonetheless re-run in this session
rather than inherited from the record.

| Gate                                 | Result                                          |
| ------------------------------------ | ----------------------------------------------- |
| `api lint`                           | exit 0                                          |
| `api typecheck` (clean room)         | exit 0                                          |
| `api build` (clean room)             | exit 0                                          |
| `web lint`                           | exit 0 — **0 errors, 35 warnings** (= baseline) |
| `web typecheck` (clean room)         | exit 0                                          |
| `web test:ci`                        | exit 0 — **105 files, 1556 tests, 0 failures**  |
| `contracts build` (clean room)       | exit 0                                          |
| `database` validate/generate/build   | exit 0 (§5.3)                                   |
| `prettier --check`, 103 sprint files | **all pass** (§5.2 defect 4)                    |
| production scanner smoke             | `SMOKE_EXIT=0`, 14/14 (§5.4)                    |
| `git diff --check`                   | exit 0                                          |

The 35 web lint warnings are the pre-existing baseline; three sit in files this
diff touches and all three are on lines the diff did not add.

**Deliberately not re-run locally, and why.** The DB/Redis integration suite
(201 suites / 3867 tests), the full Playwright matrix (708 passed / 96 skipped),
the two flag-split browser journeys and the Docker image gate all passed in
§4.5 and are unaffected by an ignore-file change. Rebuilding the isolated stacks
to repeat them would take hours to re-prove a null delta, and **CI runs every
one of them on the pull request** — which is the evidence this phase is required
to produce anyway. Their verdict is the PR's checks, not this section's.

## 5.6 Branch divergence, established before publishing

`fix/sprint-09b29-provider-onboarding-v2-parity` had never been pushed, and
neither had its base commit `b4c6e25`.

| Fact                             | Value                                        |
| -------------------------------- | -------------------------------------------- |
| merge base with `origin/develop` | `98b8858`                                    |
| commits on `develop` not in HEAD | 5 — squash-merges of #66, #67, #68, #70, #71 |
| commits on HEAD not in `develop` | 1 — `b4c6e25`                                |
| `develop...HEAD` diff            | 8 files, 2514 insertions, **0 deletions**    |
| merge into `develop`             | **clean** (`git merge-tree`, read-only)      |

The branches had diverged, but harmlessly: sprint 9B.28's code reached `develop`
through its own squash-merge, and everything `b4c6e25` still adds over `develop`
is this sprint's design _input_ — the execution guide, the implementation
prompt, the prototype and flow references, the agent rule, and a devcontainer
lock. So the pull request is this sprint's work plus its own brief, not a
replay of an already-merged sprint.

## 5.7 What CI found that every local gate had missed

The branch was pushed as `fix/sprint-09b29-provider-onboarding-v2-parity` and
opened as **draft PR #72** into `develop`. The first run on `b03c405` is the
most useful result in this document, because two jobs failed and **neither
failure was reproducible by any gate run locally** — they are exactly the class
of defect the "publish and let CI judge it" step exists to catch.

Everything expensive passed on the first attempt: `Integration & E2E (real
Postgres / Redis)`, `Docker cold build + production boot`, `Compose stack
smoke`, `Auth cookie contract`, and all five `Verify` jobs.

### Defect 5 — ten new specs wrote a secret-shaped literal

`Dependency, secret, and container scans` failed: **gitleaks, 7 findings**, all
`generic-api-key`, all of the form

```ts
JWT_ACCESS_SECRET: 'phase3-journey-a-secret',
```

in the Phase 3 integration specs.

This is not a false positive to be silenced. Sprint 9B.28 had already fixed
exactly this habit and left the cure in the tree —
`apps/api/test/support/test-secrets.ts`, whose header says in as many words
that its purpose is to close _the source_ of these findings so "a future edit
to one of these lines cannot resurrect the failure under a new fingerprint".
This sprint's specs did not use it. The gate caught the regression that the
previous sprint's remediation was designed to prevent.

`.gitleaksignore` was **not** touched. Its own rules restrict it to reviewed
_historical_ fixtures, one fingerprint per finding; adding ten new entries for
code written this week is precisely the quiet hollowing-out that file warns
about.

Instead all **ten** new integration specs — the three gitleaks did not flag
included, since the habit and not the entropy score is the defect — now follow
the established shape: a module-level `const SECRET = makeTestSecret('<label>')`
referenced as `JWT_ACCESS_SECRET: SECRET`. The value is derived at runtime, so
there is no literal in the blob to match, and the line carries no quoted string
at all.

Verified locally afterwards: `api typecheck` exit 0, `eslint "test/**/*.ts"`
exit 0, and both edited suites still load and skip cleanly with the DB gates
unset (2 suites, 32 tests skipped, no import error).

### Defect 6 — four CodeQL alerts, one of them a real weakness

`CodeQL` failed with 4 new alerts (1 high, 3 medium) — the analysis itself
succeeded; the check fails on the alerts.

**High, `js/incomplete-url-substring-sanitization`,
`e2e/prototype-assets.ts`.** The vendored-asset router decided whether a request
was for the Google Fonts stylesheet with `url.includes('fonts.googleapis.com')`.
CodeQL is right and this is a real defect, not a lint nicety: the host name can
appear anywhere in a URL, so `https://evil.test/?x=fonts.googleapis.com`
satisfies the check and any intercepted origin could be served the vendored
stylesheet. Fixed by parsing and comparing the hostname for equality
(`hostnameOf(url) === 'fonts.googleapis.com'`), which only the host itself can
satisfy.

**Medium ×3, `js/http-to-file-access`, `e2e/assets/vendor-prototype-assets.mjs`.**
Network data written to a file. The script's entire purpose is to download
pinned third-party assets and write them to disk, so the flow is intended — but
the alert pointed at something genuinely missing: it wrote whatever arrived,
with **no integrity check at all**, and recorded the hash only afterwards. A
compromised or silently-updated CDN would have rewritten the visual baselines,
and the change would have surfaced as an unexplained pixel diff rather than as
the supply-chain event it was.

Every download now goes through `writeVerified()`, which compares the bytes
against the SHA-256 already pinned in `manifest.json` and **throws rather than
writing** on a mismatch. Accepting new bytes is opt-in
(`REVENDOR_ACCEPT_NEW_HASHES=1`), so bumping a pinned version is an explicit act
visible in review. A re-run is now a verification, not a refresh.
