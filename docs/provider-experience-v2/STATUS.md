# Provider Experience V2 — sprint status

Checkpoint for resuming after an interruption. Updated as work lands.

**Branch:** `feat/provider-experience-v2-ux-redesign`
**Base:** stacked on PR #68 (`1fb080c`), which is itself `develop` (`006926a`) + Mode B slice 1
**HEAD at last update:** `c60a69e`

---

## Commits on this branch

| SHA       | Commit                                                                     |
| --------- | -------------------------------------------------------------------------- |
| `58b8828` | docs(ai): permit scoped UX UI redesign mode                                |
| `4d28fe0` | docs(provider): document the V2 flag, and why an unset flag serves V1      |
| `65bcc10` | docs(provider): record the Phase 1 baseline and the Mode B design contract |
| `899835b` | test(web): stop the suites inheriting a developer's feature-flag .env      |
| `a817d1b` | feat(provider-ui): take the provider experience out of the phone frame     |
| `f1e0de3` | feat(provider-ui): add the provider design system — tokens and components  |
| `09d9d38` | fix(onboarding): name the blocker instead of "something needs attention"   |
| `c60a69e` | fix(onboarding): raise the consent blocker once, not twice                 |

---

## Phase status

| Phase                                 | State           | Evidence                                                                |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| 0 — git/env safety                    | done            | develop `006926a`; 4 stashes intact throughout                          |
| 1 — baseline                          | done            | `BASELINE.md`, 36 screenshots, root cause of "why V1 shows"             |
| 2 — design contract                   | done            | `UX_UI_DESIGN_SYSTEM.md`                                                |
| 3 — responsive shell                  | done            | phone frame removed for Provider; Seeker untouched                      |
| 3 — tokens + component library        | done            | `features/provider-ui/*`, 24 tests                                      |
| 4 — six task screens                  | **partial**     | Hub restyled; the six task screens themselves are NOT redesigned        |
| 5 — status centre                     | **not started** | post-submission is still one paragraph                                  |
| 6 — active workspace / 5 destinations | **not started** | routes exist (ADR 0014); nav is still 5 legacy tabs, no desktop sidebar |
| 7 — feature-folder refactor           | **partial**     | screens split in slice 1; `features/provider-*` split not done          |
| 8 — upgrade/session 403               | **not started** | root cause known (RolesGuard reads roles from the token)                |
| 9 — flag rollout / default flip       | **not done**    | local `.env` only; production default still OFF                         |
| 10 — WCAG 2.2 AA audit                | **partial**     | library built to the target; no axe run, no manual audit                |
| 11 — visual acceptance matrix         | **partial**     | ~45 screenshots; the ~300-shot matrix is not built                      |
| 12–15 — gates / push / CI             | in progress     | see below                                                               |

---

## Verification at `c60a69e`

| Gate                                                  | Result                                                   |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Focused resolver spec                                 | **30/30**                                                |
| API suite, DB **and** Redis gated, isolated instances | **189 suites / 3572 tests / 0 skipped — ×2 consecutive** |
| api lint / typecheck / build                          | pass                                                     |
| contracts build                                       | pass                                                     |
| prisma validate / generate                            | pass                                                     |
| migration drift (dedicated shadow db)                 | no difference                                            |
| `verify:migrations`                                   | ALL CHECKS PASSED                                        |
| web lint                                              | 0 errors, 32 pre-existing warnings                       |
| web typecheck                                         | pass                                                     |
| web unit                                              | **1450/1450**, ×4 consecutive                            |
| web production build                                  | pass                                                     |
| format check (changed files)                          | pass                                                     |
| Playwright matrix                                     | **in progress** — see risk below                         |

### Blocked locally: the Playwright matrix cannot run on this machine right now

**Not a code regression, and measured rather than assumed.** The final shard-1
run reached a terminal result of 236 passed / 84 failed / 48 skipped, and every
one of the 84 failures is process-level:

```
80 x  Error: worker process exited unexpectedly
 4 x  Error: browserContext.newPage: Target crashed
 0 x  any assertion failure
```

Zero `expect` failures in the whole run. Both signatures are Chromium/worker
OOM. Free memory measured at ~2.3 GB of 16 GB with the developer's 7 containers
and dev server resident; four Chromium workers do not fit alongside them.

Earlier in this same session, on this same code path, the full matrix passed at
**639 passed / 96 skipped** twice. Every container this work created has since
been removed to give the run more headroom, and it was still not enough.

**Not worked around.** Reducing workers, retrying, or re-sharding would only
hide an environment limit — and re-sharding does not reduce concurrent workers,
so it does not help. The authoritative matrix result is therefore CI's
`Browser E2E` job, which runs on a clean runner at the repository's configured
worker count. Local matrix status: **UNVERIFIED at this SHA**, pending CI.

### Open risk: one unreproduced web unit flake

A single web unit test failed once (1449/1450) and could not be reproduced in
four subsequent full runs. Not identified — the log was overwritten before it
was read. The previously identified cause of a similar flake (a lazy-import
race in the wallet test helper) was hardened in slice 1.

---

## Next exact steps

1. Terminal result for Playwright matrix shard 1, then shard 2; repeat for a
   second consecutive identical run.
2. Real browser-to-real-API journey with V2 ON (needs the isolated stack: pg
   25433, redis 26380, mailpit 21025/28025, API 4011, preview 4174).
3. Docker cold build, isolated Compose smoke, dependency audit, gitleaks.
4. Push branch, open/refresh Draft PR against `develop`, monitor CI + CodeQL on
   the final SHA.
5. Phases 4–11 remain genuinely unfinished — see the table above.

## Environment invariants held

- 4 user stashes intact and untouched.
- Developer's 7 containers untouched; every container this work created
  (`hsm-v2e2e-*`, `hsm-itest2-*`) is removed.
- No user volume, database, or port-4000 process touched.
- `apps/web/.env` carries the local V2 flag and is gitignored — never committed.
- `CLAUDE.md` is the developer's own edit and is committed only as its own
  documentation commit.
