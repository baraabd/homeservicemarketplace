# Sprint 9B — interim status

**Not complete. Not pushed. No PR opened.** This records exactly what is done,
what is verified, and what blocks the push authorisation.

## Git state

|                         |                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Inherited branch / HEAD | `feat/sprint-09-provider-verification-access` @ `f0d27723c9f55a871d266c7024502568047ee28f` |
| Inherited worktree      | Clean — all 9A work already committed                                                      |
| 9B branch               | `feat/sprint-09b-provider-verification-experience`, cut from that exact SHA                |
| `origin/develop`        | `207dc1b547877b07854015045369c5e0a53feb36` (= merge base; 0 behind, no merge needed)       |
| Destructive operations  | None. No reset, no force checkout, no rebase. 9A ref intact                                |

## The inherited red test — GREEN

- **Test:** `renders real evidence rather than a documents placeholder`
- **Suite:** `Sprint 9 regression — the admin UI must not own the transition table`
- **Was:** `AssertionError: expected '…' not to match /DocumentsPlaceholder/`
- **Now:** passing

`git diff f0d2772 -- <that test file>` is **empty** — the file is byte-identical
to the 9A version. It was not skipped, weakened, reverted, or excluded from CI.
The implementation changed.

## Test counts vs. the 9A baseline

| Suite | 9A baseline                         | Now                                     | Δ               |
| ----- | ----------------------------------- | --------------------------------------- | --------------- |
| API   | 1666 passed / 0 failed / 89 skipped | **1836 passed / 0 failed / 89 skipped** | +170            |
| Web   | 661 passed / **1 failed**           | **676 passed / 0 failed**               | +15, −1 failure |

No new skips. No `.only`, no `.skip`, no `continue-on-error`, no threshold change.

## Delivered

| Area                                                                               | State                      |
| ---------------------------------------------------------------------------------- | -------------------------- |
| Inherited-state reconciliation + UX/UI component audit                             | ✅ `docs/sprint-09b/`      |
| File-signature validation (magic bytes, narrowed allowlist, filename sanitisation) | ✅ 33 tests                |
| Malware-scan port — never CLEAN without a real scan                                | ✅ 16 tests                |
| Evidence keys, hashing, per-outcome retention                                      | ✅ 23 tests                |
| Versioned requirement resolver (country × type × category)                         | ✅ 19 tests                |
| Case transition policy (one frozen table, 56-cell cross-product)                   | ✅ 24 tests                |
| Public/restricted boundary enforced on `GET` **and** `PUT`                         | ✅ 10 HTTP-boundary tests  |
| Admin verification case read API + contracts                                       | ✅                         |
| Admin restricted evidence panel (EN/AR, a11y, non-colour cues)                     | ✅ 14 copy/guardrail tests |
| Public-media import guardrail (matches specifiers, not comments)                   | ✅                         |

## Real API boot — verified

Booted `dist/main.js` against the live local Postgres and Redis:

```
/health/live   200 {"status":"ok"}
/health/ready  200 {"ready":true, postgres: up, redis: up}
GET /v1/verification/documents/:id/content  ->  401   (not 404)
```

401 rather than 404 is the proof the new route is both **registered** and
**auth-gated**. The boot log carries no dependency-injection errors, no
module-resolution failures and no configuration problems. Process stopped
afterwards; the user's own long-running processes were left untouched.

### Environment blocker (not a code defect)

`pnpm --filter @homeservicemarketplace/database generate` fails locally with

```
EPERM: rename ... query_engine-windows.dll.node
```

because the user's `prisma studio` (running since 22 Aug) holds that DLL open.
No schema changed this turn, and the generated client was verified current —
50 models, 40 enums, `ProviderWorkAccessGrant` carrying `source` and `caseId`.
A clean CI runner has no studio process and is unaffected. **Not worked around
by killing the user's process.**

## NOT started — required before any push

- Provider evidence experience (checklist, upload, submit, ACTION_REQUIRED, resubmit, renewal UI)
- Upload prepare/finalize idempotency (the READ half, IDOR and access audit are DONE)
- Portfolio (`ProviderPortfolioItem` CRUD, moderation, limits)
- Redacted preview endpoint + rate limiting + privacy snapshot tests
- Atomic approval → `VERIFIED` + grant + audit + notification + outbox, with forced-failure rollback
- Admin actions: assign / requestAction / approve / reject / reverify / expire / revoke
- Capability integration across every marketplace route
- Playwright journeys (EN/AR/RTL)
- Docker cold build, Compose smoke
- **Flag-on HTTP-boundary E2E with real Postgres/Redis**

## Push authorisation: BLOCKED

The brief authorises a push only _"after every local gate passes with zero
failures"_, and names Playwright, Docker cold build, Compose smoke and flag-on
HTTP-boundary security journeys among those gates. Those have not been run, so
the precondition is not met and nothing has been pushed.

Local gates that **have** run clean: contracts build; database typecheck/build;
API lint / typecheck / test / build; web lint / typecheck / test / build.

## Feature flags — unchanged from 9A

`WORK_ACCESS_ENFORCED` = **false**, `VERIFICATION_ENFORCED` = **false**.
9B has not altered either default. Production behaviour is unchanged.

## Rollback

Every 9B commit is additive: new modules, new contracts exports, one new
read-only endpoint, one component swap. Reverting the range restores 9A exactly,
and the two 9A migrations are untouched.
