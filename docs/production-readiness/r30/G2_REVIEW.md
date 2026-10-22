# G2 prerequisites for R30 — current-source review

This record supports a review decision. It does not replace the canonical G2
manifest or grant an executable frozen source.

## Verified source and publication state

Current branch base is `96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. The owner merged R28 repair #181
into that source. Earlier repair #179 merged as
`15fe443a7d1b94b3f6a7f45cbe2bf5650a38d539`, and G2 repair #180 merged as
`75bd688e7254b84316b32f82b0f6ee337249b977`.

The canonical G2 manifest still states `BLOCKED`, null frozen commit/tree,
empty `acceptedSprints` and `DRAFT_PENDING_OWNER_REVIEW`. The current Wave 3
manifest has no startable lane. A physical merge of a blocked repair record
does not convert it into accepted publication.

The G2 evidence points at historical candidate
`736208b70c211c5c1fe931f0a2f0f37c4d55d529`; the old Wave 2 closeout points at
`4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`. Their failure and missing-delivery
observations are preserved history. They are not fresh failures of this base.
Likewise, prior PR-head green checks do not substitute for the final R30 head.

## Remaining performance decision

`scripts/perf/post-r18/budgets.proposed.json` remains an unapproved proposal.
`gates/g2/DECISION.md` and `ACCEPTANCE_EVIDENCE.json.r27OwnerBudgetProposal`
explicitly reserve the following alternative for owner baraabd:

| Benchmark                                   | Original proposed ceiling | Retained candidate observation | Proposed alternative ceiling |
| ------------------------------------------- | ------------------------: | -----------------------------: | ---------------------------: |
| Seeker requests                             |                         5 |                              6 |                            6 |
| Provider available requests                 |                        10 |                             13 |                           13 |
| Provider bookings                           |                         7 |                             12 |                           12 |
| Populated administrative financial bookings |                         3 |                              9 |                            9 |

The retained measurement run is `39071261866`, baseline artifact
`12115541931` and candidate artifact `12115601631`. The unchanged evaluator
recorded candidate 48 passed / 4 failed and baseline 41 passed / 11 failed,
both exit 1. These are earlier measured results, not newly executed results
on this branch. The relevant repositories, services, query profiler and budget
configuration are unchanged between that measured source and this branch base.

The independently downloaded PR181 candidate supplies newer evidence for the
exact preparation **tree**: source `70b7225727d89df0fd040b00ebd37c09383e7d30`,
tree `68f4e926eabeb37bb70382c62b75272cf67bd02c`, run `39801354824`, candidate
job `119902596450`, artifact `12435857950`. Its ZIP SHA-256 was verified as
`b98ae9b6cab5f69939570dfa3a99532acf4aec925f054e713b3a818ce400befa`.
The unchanged evaluator again returned exit 1, 48 passed / 4 failed, with
6/13/12/9 statements in those four scenarios. This is observed prior-source
baseline evidence; it is not a result for this branch's changed queries.

Successful measurement workflow jobs do not approve these numeric ceilings.
The proposal records `approval: null` and `sourceBudgetChanged: false`.
No budget, assertion, timeout or authorization policy is changed by recording it.
The figures apply to named measured scenarios, not a universal request limit or
hosted SLO. Cursor-owner and explicit-category variants need separate coverage.

The standing coordinator delegation is now used for the separately recorded
eleven-file repair lease in `OWNERSHIP.md`. Page-bounded parameterized projections
target the original limits while retaining fresh guards, ownership, pagination
and financial values. A dedicated provider-booking summary reader preserves the
full relation reader used by wallets. `IMPLEMENTATION.md` describes the changes;
`ACCEPTANCE.md` records actual PostgreSQL, query/plan and final-head results.
No unexecuted optimization is claimed as a pass.

Even if these repairs pass all original limits, those limits remain proposed
policy until owner approval. Passing the original proposals removes the need
to approve the alternative larger numbers; it does not approve the original
proposal or publish accepted G2. The historical failed measurements above remain
unaltered and distinct from new candidate evidence.

## Bounded shared CI change: comparable repair baseline

The PR181 G1 artifact `12436780241` has verified ZIP SHA-256
`cc0c226d2dacc32bd468e56ffd2ce854b086ee0a2138b97af49c8b24aabcb105`.
It uses the frozen G1 runtime and the same measurement harness as the PR181
candidate, but the owner's intervening security upgrades changed the lockfile.
The unchanged `compare-reports.mjs` correctly exits 1 with
`incomparable lockfileSha256`. The older G2 comparison does not prove this newer
pair, and equal harness file contents do not replace commit provenance.

The single-file CI lease in both ownership records addresses this concrete
evidence gap through `.github/workflows/r27-performance.yml`. The existing G1
baseline and candidate remain. An additional `repair-baseline` uses the exact
PR base SHA with the final-head measurement harness. Manual dispatch requires
an explicit full baseline SHA. Guards reject a missing or malformed SHA,
self-comparison, non-ancestor source, wrong checkout or unequal lockfile bytes.
Current candidate authority/index assertions also apply to the repair baseline.
No comparison rule, budget, dependency, timeout, sample design or original job
is weakened. The measurement harness source remains unchanged.

The current base and repair retain lockfile SHA-256
`38c763b2348edacd22c88f61d7efbae67455ca92e5fb23320e3a5543e0a9d7c4`.
The final before/after evidence must use independently verified artifacts from
the new run, with their own source/tree and one harness commit. Require the
unchanged comparator's `OBSERVED_COMPLETE_MATRIX` and zero missing groups;
exit 0 alone can also represent an incomplete matrix. Preserve the original G1
pair's dependency mismatch as a distinct historical limitation. No new result
is asserted before execution, and no measurement approves policy or G2.

## Concrete completion conditions

1. Verify the complete checks and official CodeQL on one exact integrated
   candidate, including source artifact/tree identity and R25 real replica,
   API and browser results. Reconcile all five merged Wave 2 deliveries.
2. Resolve the performance issue with measured changes under unchanged limits,
   or obtain the owner's explicit decision on the concrete alternative. Do not
   infer it from a repair merge or a general instruction to continue R30.
3. Record current R24 collection/receipt, activation, refund and finance-read
   port digests and the precise accepted source/tree in the canonical G2 record.
4. Obtain owner approval and verify the separately merged acceptance
   publication. Synchronize registry/wave identities and authorize the exact
   R30/shared file handoff before `g2-record.mjs --ready R30` can pass.

R28's allowed checked-configuration alternative remains distinct from its
`HOSTED_ENVIRONMENT_BLOCKED` release hold. Merchant accounts, live settlement,
reviewer grants, commercial policies, receipt retention and hosted resources
are separate owner inputs. Their absence never becomes simulated live success.
