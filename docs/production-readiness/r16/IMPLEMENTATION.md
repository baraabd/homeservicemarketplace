# R16 — Payout / withdrawal capability: implementation record

**Status: `R16_POLICY_BLOCKED` + `R16_FUNDING_AUTHORITY_BLOCKED`.**
**R16 is not implemented and not complete.** This delivery is analysis, design
and one regression guard. No withdrawal route, worker, adapter, migration,
contract or flag was added. Nothing can move money.

## Source identity

| Item              | Value                                                                            |
| ----------------- | -------------------------------------------------------------------------------- |
| Branch            | `feat/r16-payout-withdrawal-authority` (worktree `../HSM-r16`)                   |
| Base / merge base | `cc41787fc68053a858365475e997bd7f4af95faf` (develop, includes #137 R15 and #139) |
| Existing R16 work | none: no branch, worktree, commit or open PR (0 open PRs on 2026-10-05)          |

## Gate A — baseline (accepted with recorded caveats)

Exact-SHA **push** runs on `cc41787`, all attempt 1, all `success`, no job
skipped:

| Workflow                            | Run id      | Jobs                                                                                                                          |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| CI                                  | 37236345092 | 17/17 success, including the real Postgres/Redis integration, Playwright, Phase 5, Docker boot, Compose smoke, scans, CI gate |
| CodeQL                              | 37236344662 | Analyze JavaScript/TypeScript                                                                                                 |
| Production governance               | 37236344748 | 1/1                                                                                                                           |
| Web development startup             | 37236344642 | windows-latest, ubuntu-latest                                                                                                 |
| Authentication lifecycle acceptance | 37236344800 | R04 real browser, SMTP and Postgres                                                                                           |
| Staging release boundary            | 37236344706 | 4/4                                                                                                                           |

Executed counts from job logs: web unit 188 files / 2339 tests passed; API unit
217 suites passed, 64 skipped (5260 tests: 3890 passed, 1370 skipped — the
DB-gated suites, which run in the integration job); integration job 277 suites
passed, 4 skipped (5227 passed, 33 skipped); Playwright 821 passed, 298 skipped
(conditional); auth cookie 8; admin review 12; Phase 5 visual 108 + 131 unit;
retention 29; dispute 31.

Caveats (recorded, not waived):

- Gitleaks history mode scanned **0 commits** on the push event; the
  tracked-tree scan covered commit `cc41787`, 2078 files, ~16.7 MB, no leaks.
- 8 open CodeQL alerts on develop, including #3 **critical** and #1, #2, #4, #5
  **high** (all 2026-08-22, recorded in `r11/IMPLEMENTATION.md`). These block
  live money under `docs/money/LIVE_MONEY_GATE.md`.
- `develop` has no branch protection or ruleset.

## Gate B — product authority (blocked)

See `PAYOUT_POLICY.md`: 0 confirmed, 2 proposed, 15 blocked decisions. The
deciding facts:

- `docs/money/README.md` prohibits payouts until a marketplace-funds ADR
  decides whether HSM holds or transfers customer funds. None exists.
- ADR 0014's rails are for provider subscriptions paid to HSM, not outbound
  transfers.
- No customer payment, capture or settlement persistence exists, so no balance
  can be traced to funding: `BLOCKED_FUNDING_AUTHORITY`.

## Delivered

| File                                                           | Purpose                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `docs/production-readiness/r16/PAYOUT_POLICY.md`               | Decision register, funding provenance, proposed accounting shape, owner questions                            |
| `docs/production-readiness/r16/WITHDRAWAL_AUTHORITY_MATRIX.md` | Every money value/action, classified; `availableBalance` is a booking-derived estimate                       |
| `docs/production-readiness/r16/WITHDRAWAL_STATE_MACHINE.md`    | Separated states, transition table, reservation/lock design, verified infrastructure gaps, proof obligations |
| `docs/production-readiness/r16/RECONCILIATION_RUNBOOK.md`      | Discrepancy classes, operator rules, disable/rollback procedure                                              |
| `apps/web/src/app/components/provider/WalletScreen.test.tsx`   | The disabled-CTA test now asserts no POST/PUT/PATCH/DELETE was issued, instead of relying on an unmocked 404 |

### Guard verification (mutation checks, all reverted)

| Mutation in `WalletScreen.tsx`                           | Result                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Remove `disabled`, POST on click                         | test fails at `toBeDisabled()` (pre-existing assertion)                                                                            |
| POST `/v1/provider/withdrawals` from a mount effect      | test fails: `expected [ {…} ] to have a length of +0 but got 1` (new assertion)                                                    |
| Wrapper `onClickCapture` POST around the disabled button | test passes — the click on a disabled button never reached the handler, so no write occurred; not a detection gap for a real write |

## Not done, and why

- No schema, migration, contract, permission, route, worker, adapter, flag or
  UI change: every one depends on a BLOCKED decision (P1, P3, P5, P7, P8).
- No R16 PostgreSQL or browser acceptance: there is nothing to exercise. The
  proof obligations are listed in `WITHDRAWAL_STATE_MACHINE.md`.
- No provider sandbox evidence: no provider is selected (evidence level B not
  applicable; level C not authorized).
- No relabelling of `availableBalance`: changing what the estimate means is a
  product decision tied to P1/P5.

## Rollback

Documentation plus one stricter test assertion. Reverting the commit restores
the previous state; no data, schema or runtime behavior is involved.

## Next owner action

Answer `PAYOUT_POLICY.md` § Questions for the owner — first the
marketplace-funds model (P1/P5). If HSM will not hold customer funds, R16
should be re-scoped or closed as not applicable rather than implemented.
