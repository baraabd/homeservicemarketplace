# R27 current risks — 2026-10-17

This section supersedes historical pre-G1 readiness statements below. G1 is
accepted and READY_TO_START. R27 source and the complete afec37ae disposable
measurement/browser run are verified; budget, combined-wave and release
acceptance remain separate.

1. **Timing comparability:** run 39032727959 used an Intel Xeon Platinum 8573C
   baseline and an AMD EPYC 7763 candidate. Both have 4 logical CPUs / 15.6 GiB,
   but elapsed-time differences are hardware-confounded. The comparator now
   emits this advisory separately from source-identity checks. Shared-VM and
   time effects remain even when CPU models match.
2. **Mixed performance:** bundle/query structure improves, but production warm
   UI and transitions have higher medians in several groups. Desktop EN admin
   warm UI is 154.36 / 211.84 ms and transition 82.57 / 126.08 ms; readiness is
   1051 / 1200 ms. Workload peak RSS rises from 500.0–503.2 to 523.3–539.5 MiB.
   Ready RSS moves in the opposite direction from the earlier diagnostic run.
   These are qualified observations, not proven causal regressions or universal
   speed/memory improvement. The complete tables retain all observations.
3. **Unapproved budgets:** the unchanged checker records 47 PASS / 4 FAIL:
   seeker requests 6/5, provider feed 13/10, provider bookings 12/7 and the
   financial Booking scan. Provider costs use unchanged populated-page source;
   historical ceilings came from empty pages. CR-001 has concrete proposed
   edits for owner review and unmeasured projection directions. Do not remove
   guards, simplify fixtures or raise limits merely to obtain green.
4. **Unrepresentative financial/users data:** amplification contains 10836
   requests, 43344 bids and 5418 bookings, but only 15 users / 12 profiles and
   zero completed-booking results. Full populated nonfinancial cursor walks
   pass; financial hydration, stable/mutating pagination and index benefit
   remain unproved. The three-query financial ceiling also needs populated
   validation. The migration owner must choose/test an index and forward path.
5. **Private HTTP cache policy:** 15/17 sampled private reads lack an explicit
   directive. Ten asserted API negatives and same-context browser account
   switching pass; three ETag observations are informational. These do not
   establish cross-tab sign-out, live role/grant revocation or a global no-store
   policy. CR04/CR001 require the HTTP/security owner's early default and
   success/error/private-media/public-exception tests.
6. **Measured sample limits:** each browser group has n=3 and boot n=5, so no
   tail estimates are claimed. The 192 UI observations cannot be pooled across
   different roles/modes/projects. Warm closed-loop workloads have n=200 and
   empirical tails only. CDP tracing adds overhead; compile categories overlap.
   OS caches were not purged. No realtime/upload or hosted-capacity claim follows.
7. **Fixture reset boundary:** browser setup clears only validated default
   throttle keys in the identity-verified disposable Redis container, before
   each serial project. Keep it outside timings/account-switch assertions and
   overload recovery. Sessions/custom registration/cache keys remain; wrong
   runners, containers, keys and command failures are rejected. Real login
   throttles are unchanged, and overload recovery observes natural expiry.
8. **Final CI:** the afec R27 matrix and CodeQL passed, but one separate main-CI
   admin-review case timed out retrieving an OTP after a 200 login. Its root
   cause is unproven; 14 other cases passed. The existing shared test, helper
   and timeout are unchanged. Required final-successor CI must be inspected,
   and any recurrence belongs to its owner with concrete logs. It is not
   dismissed as a flake or resolved by the independent R27 PASS.
9. **Evidence retention and ownership:** fresh ZIPs expire 2026-10-31; digests,
   source identities, inspected screenshot paths and summary data are in Git.
   Reproduce or download full artifacts before expiry. No merged coordinator
   records or unmerged peers were imported; current develop/active ownership
   must be reconciled in serialized coordinator integration.
10. **Acceptance boundaries:** the complete isolated run does not mark G2,
    SANDBOX_ACCEPTED for the whole product, HOSTED_ACCEPTED or RELEASE_ACCEPTED.
    Merge, deployment, real funds, verification decisions and budget approval
    remain owner actions. R16/R18 policy holds and all financial contracts are
    unchanged. R37 owns representative hosted load and capacity evidence.

---

## Historical records retained for audit

> **Historical continuation note:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Its pending statements describe the earlier snapshot;
> the current measurement and acceptance state are recorded above.

# R27 — Risks, deviations and blockers

| #   | Risk or deviation                                                                                                                                                          | Impact                                                                                                                                                                                                                 | Owner / next step                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Started before G1** on the G0 base 059c018, as the owner approved. R20 (storage) and R23 (observability) are not merged.                                                 | Numbers describe 059c018, not the wave-2 base. R20 can change upload and storage paths (profile U); R23 adds telemetry overhead to every request.                                                                      | Coordinator: re-run `bundle-report`, `api-boot` and `query-profile` on the G1 SHA; register R27 in `SPRINT_REGISTRY.json`. |
| 2   | **Host starvation.** 0.3–1.3 GB free with four other lanes. The fixture-profile API failed to start 3 times; the improved query run (page-size probe) could not execute.   | All local timings are indicative only. The page-size probe for CR-08 is unexecuted, though 52-for-15 already evidences the N+1.                                                                                        | Re-run `query-profile.mjs` on a quiet host or a hosted runner; record `BLOCKED_HOST` until then.                           |
| 3   | Latency in `query-profile-baseline.json` (100–800 ms p50 per read) was measured in development mode on a starved host, with DB time under 30 ms for most reads.            | The latency figures must not be quoted.                                                                                                                                                                                | Use statement counts and plans only; R37 measures latency.                                                                 |
| 4   | Generic plans can differ from the custom plans used with real parameters.                                                                                                  | A seq scan flag might not reproduce in production, or a real problem might be missed.                                                                                                                                  | `auto_explain` (≥ 50 ms, ANALYZE) is on in the lane DB; R37 captures real plans.                                           |
| 5   | The amplified dataset clones the same 6 seekers and 4 providers.                                                                                                           | Per-user lists are heavy, a worst case; user, notification and audit tables stay small. Admin users and notifications were not scaled.                                                                                 | R37 generator with many users.                                                                                             |
| 6   | CR-01 changes test timing: `DashboardOverview.test.tsx` failed under load with the patch (see the CR).                                                                     | The CR needs its test adjustment, or it will flake in CI. A `beforeAll` preload was tried and rejected (it timed out and skipped 5 tests under load). The proposed static side-effect import was not verified locally. | Admin web owner applies the CR together with the test adjustment and verifies it on hosted CI.                             |
| 7   | CR-02's proposed file includes one formatting-only line (`setPinCoords`) that lint-staged would produce anyway.                                                            | Cosmetic.                                                                                                                                                                                                              | None.                                                                                                                      |
| 8   | The production boot profile ran with `VERIFICATION_ENFORCED=false` (no ClamAV in the lane) and a placeholder HTTPS CORS origin.                                            | Boot path is otherwise production; the scanner client start-up is not included.                                                                                                                                        | R37 boots with ClamAV.                                                                                                     |
| 9   | Dev-seed admin credential (`test1@admin.com`) and a loopback DB password appear in harness source. The same seed credential already appears in `apps/web/e2e/real-api.ts`. | Possible secret-scan finding; no real credential.                                                                                                                                                                      | CI gitleaks on the PR; gitleaks is not installed locally.                                                                  |
| 10  | Budgets are proposals.                                                                                                                                                     | Nothing is enforced; `check-budgets.mjs` exits 1 on the current baseline (4 bundle failures).                                                                                                                          | Owner approval; CR-07 for CI wiring.                                                                                       |
| 11  | Motion (378 KiB rendered) and socket.io-client (90 KiB) sit in the shell.                                                                                                  | Largest remaining first-load bytes.                                                                                                                                                                                    | No minimal change exists; a design decision for the web owner, not a CR.                                                   |
| 12  | Admin financial list pages by an `id` cursor while ordering by a mutable `updatedAt`.                                                                                      | Possible skipped or duplicated rows during paging.                                                                                                                                                                     | Not exercised (0 completed bookings); fixture needed (CR-06 note).                                                         |

## Policy and external blockers

- Launch load `L`, the hosted target, and budget approval are **owner
  decisions** (R18 `OWNER_DECISIONS.md`). They block R37 and the
  enforcement of `hostedOnly` budgets.
- No money, payout, fee or verification decision was inferred or changed.
  The R16 and R18 open decisions are untouched.
