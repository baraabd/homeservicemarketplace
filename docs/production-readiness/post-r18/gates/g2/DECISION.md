# G2 — Review decision and publication hold

**Decision: BLOCKED.** The authoritative state and exact candidate identity are in `SOURCE_MANIFEST.json`. No Wave 3 lane is startable, no full frozen base is assigned, and R32 implementation has not started.

The owner authorized G2 coordination, complete repairs and one review PR, explicitly excluding merge and deployment. Technical evidence is assembled before owner review. A passing local test, merged individual lane PR or complete source plan cannot replace the required combined-source checks.

The initial combined source failed R25 browser acceptance and therefore R18/CI. R27 also requires measured integration and an explicit budget decision. The coordinator is implementing and verifying those repairs. The R28 prompt permits checked plans when the approved hosted target is missing; its `CONFIGURATION_ONLY` evidence is evaluated separately from its retained `HOSTED_ENVIRONMENT_BLOCKED` state.

## Release sequence

1. Commit the coherent assembled repair candidate and run its applicable real-service, browser, migration, security and final-head CI checks.
2. Record immutable source/tree and evidence identities plus the concrete measured R27 budget proposal and remaining owner decisions. Missing evidence remains NOT_RUN/FAIL; no threshold is raised to change a result.
3. The owner reviews the concrete PR and decisions. G2 technical acceptance and owner approval must be recorded truthfully; this task never merges its own publication.
4. After owner-merged publication is independently verified against the reviewed record and accepted source ancestry, release only complete assigned lanes. R32 gets the full approved frozen SHA, a fresh isolated worktree and exact active ownership. Unprovided peer packages remain held.
5. Implement R32 on frozen ports and complete its later adapter-backed Wave 3 acceptance. No peer branch is cherry-picked during parallel implementation.

`publication.state`, actual merge identity and the lane manifest must agree. Validation rejects acceptance without mandatory evidence and readiness without merged publication. A JSON record cannot itself prove a GitHub approval or branch-protection rule.

## Concrete R27 owner decision prepared for review

The unchanged proposed-budget checker exits 1 against both complete artifacts from run 39071261866: candidate 48 checks pass and 4 fail; baseline 41 pass and 11 fail. Green workflow jobs do not approve these budgets. The two jobs used the same harness commit, lockfile, application input configuration and populated dataset. The coordinator proposes the following exact **benchmark-scenario** statement ceilings for owner review:

| Measured scenario                           | Existing proposal | Frozen G1 measured | G2 measured | Proposed reviewed ceiling |
| ------------------------------------------- | ----------------: | -----------------: | ----------: | ------------------------: |
| Seeker requests                             |                 5 |                  5 |           6 |                         6 |
| Provider available requests                 |                10 |                 13 |          13 |                        13 |
| Provider bookings                           |                 7 |                 12 |          12 |                        12 |
| Populated administrative financial bookings |                 3 |                  9 |           9 |                         9 |

These zero-headroom values describe the guarded benchmark fixture, not every parameter combination or a production SLO. Each observed count stays constant between limits 5 and 20; default scenarios return 50, 20, 50 and 30 items respectively. Source inspection identifies additional queries for provider-booking cursor ownership and an explicit available-request category; those variants were not separately counted in this run. The financial limit 100 has full correctness and bound-plan evidence but no separately measured HTTP statement count. Those unmeasured counts are not silently covered by the table. The proposed source budget file remains unchanged until the owner records a decision.

The captured statement decomposition is bounded per page:

| Scenario                          | Captured SQL accounting                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Seeker requests                   | 2 session/account checks + 3 page/relation reads + 1 authorized-page Bid aggregate = 6                                   |
| Provider available requests       | 2 session/account checks + 3 capability checks + 4 profile/category reads + 3 page/relation reads + 1 Bid aggregate = 13 |
| Provider bookings                 | 2 session/account checks + 3 capability checks + 1 profile lookup + 6 page/relation reads = 12                           |
| Administrative financial bookings | 2 session/account checks + 7 page/relation reads = 9                                                                     |

The seeker sixth query is the authorized-page Bid aggregate introduced while removing the whole-Bid scan. The other three default counts already occur on the frozen G1 baseline. The financial nine statements consist of one each for Booking, Bid, ProviderProfile, ServiceCategory, ServiceRequest and Session, plus three User reads. The relation reads remain batched at the measured page sizes. Broad relation projections can still be optimized in separately measured work; their current bounded counts do not prove each selected column is necessary.

The financial fixture has 5,418 bookings, including 1,626 visible completed and 180 soft-deleted completed rows. Both sides walk 82 pages with exact ordered database truth, zero duplicates while sort keys stay unchanged, and preserved monetary values and ledger/original rows. The candidate's actual generic and bound plans choose the new index. For limits 5/20/100, frozen-baseline Booking plans touch 148 shared-hit buffers each; candidate plans touch 8/18/96. No planner switch or forced index is used.

The comparator finds 48 complete paired browser measurement groups with zero missing groups and three observations per source/group. The baseline passes 8 production and 8 development browser cases; the candidate passes 28 production and 20 development cases. All 64 pass on their first attempt with zero reported failures, skips or flaky results. Each job also passes 106 helper tests. All 24 candidate private-cache, cross-tab logout and live permission-revocation reports match the exact source/tree/harness. Retain both raw `query.json` files because the comparator summary omits the exact index catalog, full generic/bound plans and financial mutation/integrity evidence. Artifact 12115541931 is the baseline; artifact 12115601631 is the candidate in the same run. Their verified SHA-256 values and source identities are recorded in acceptance evidence.

Candidate bundle proposals pass. Initial seeker/admin JavaScript gzip decreases 15.04% / 24.19%, while the shared shell grows by 2,507 gzip bytes and the complete administrative journey including charts grows 0.87%. Those deferred-loading tradeoffs remain part of the decision.

Timing is directional evidence only: the baseline ran on an Intel Xeon 8573C and the candidate on an AMD EPYC 7763. Five-sample HTTP profiles report medians and no p95/p99 estimate; browser groups contain three observations. The measured workload tails are empirical results from disposable runners. None of these measurements establishes a hardware-controlled speedup or approves a hosted SLO. The current budget CLI does not evaluate `hostedOnly` fields. Hosted load and resource budgets remain outside this disposable-fixture decision.

Mutable ID cursors ordered by `updatedAt` retain their existing semantics on both versions: changing the cursor row between requests repeats 19 previously seen rows and omits 19 rows from the original next page. The test records `snapshotGuarantee: false` and restores its fixture. Any stronger cursor contract requires a separately scoped design and migration/API review.

**Decision state: PROPOSED_AWAITING_OWNER_APPROVAL.** The owner can approve the four scenario ceilings above, or request narrower performance work before G2 technical acceptance. Nothing in this table authorizes hosting, spending, a commercial refund policy, merge or deployment.
