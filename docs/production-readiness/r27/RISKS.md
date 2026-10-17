# R27 current risks — 2026-10-17

This section supersedes historical pre-G1 readiness statements below. G1 is
READY_TO_START; this R27 continuation does not certify G2 or a release.

1. The diagnostic browser matrix failed on an incorrect Arabic label and
   cumulative loopback login counters. Both root causes and orphan response
   promises are repaired; only new real CI can establish the complete matrix.
2. The guarded fixture cleanup is setup-only and limited to R27 throttler
   counters. It must remain serial and must never be moved into a measured
   flow or overload recovery. It preserves session/custom registration/cache
   state, refuses other runners/containers/key shapes and propagates failures.
3. **Performance is mixed.** Retained bundle bytes and query work improve;
   readiness RSS rises 196.5 to 203.0 MiB and workload peak RSS rises up to
   537.8 MiB. The small completed desktop-English cold-UI sample is slower
   (seeker 344 to 386 ms; admin 334 to 339 ms), and dashboard transition
   median rises 61 to 104 ms. Deferred loading moves work; no universal speed
   or memory improvement is asserted. Re-evaluate the complete new matrix.
4. Proposed budgets remain unapproved and four checks fail (47 pass): seeker
   requests6/5, provider available13/10, provider bookings12/7, and the
   admin financial-bookings large scan. Do not remove guard reads or raise
   limits solely for a green report. Provider ceilings were originally measured
   on empty pages; current populated pages use unchanged runtime code. The
   migration lane owns index work.
5. Authenticated responses still lack an explicit private no-store header.
   Existing cross-user/role/ETag/revocation negatives pass, but that does not
   substitute for CR-R27-04's security-lane policy decision and integration.
6. Amplification contains 10836 requests, 43344 bids and 5418 bookings but
   only15 users and12 provider profiles. Financial-booking results were empty.
   These fixtures cannot establish production capacity, broad admin scaling,
   completed-booking pagination under mutation, or upload/realtime capacity.
7. Baseline and candidate use the same harness/lock/configuration and hardware
   class on separate shared GitHub VMs. OS/database caches are warm. Browser
   observations number three per role/cache/project; boot five. Their tail
   percentiles remain unreported. CPU/compile event categories may overlap.
8. Artifacts have 14-day retention; download before expiry or rerun the exact
   harness on its immutable source. Historical diagnostic ZIP digests are in
   ACCEPTANCE. The comparator flags incomplete or mismatched evidence.
9. The branch does not import the merged coordinator record solely to update
   its documents, and does not consume unmerged peers. Its frozen base and
   existing exact-file leases remain authoritative. The coordinator must
   transcribe the R27 extension and resolve central integration separately.
10. Merge, production deployment, real funds, verification decisions and
    owner-approved performance budgets remain separate actions. R16/R18
    decisions were neither inferred nor modified.

---

## Historical records retained for audit

> **Current G1 continuation:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Current implementation/integration is IN_PROGRESS and is
> not accepted. Fresh baseline CI and required browser evidence are pending.

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
