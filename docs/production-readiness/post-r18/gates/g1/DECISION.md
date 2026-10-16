# G1 decision — ACCEPTED source, publication pending

Decision UTC: 2026-10-16T21:41:51.823662+00:00. Mode A. This is the Wave 1 to Wave 2 engineering gate,
not the historical R18-G1 branch-protection issue or a production release.

The integrated Wave 1 boundaries are accepted on the merged source below.
**No Wave 2 lane may start until the owner reviews and merges this separate
record and the coordinator verifies its publication identity.**

- Frozen source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Corrective source: owner-merged PR #169, following #168.
- Publication branch: `coord/g1-wave2-acceptance`.
- Acceptance-record commit: not assigned here; the PR binds its immutable
  final head externally. It is distinct from the frozen source.
- Wave 1 status: `SANDBOX_ACCEPTED` for R19 through R23.
- Wave 2 status: `BLOCKED` solely on acceptance publication; startable lanes: none.

## Basis

[ACCEPTANCE_EVIDENCE.md](ACCEPTANCE_EVIDENCE.md) and its machine-readable JSON
record actual case results, artifact IDs/digests, source identity and limits.
The merged source ran the previously omitted real-service scenarios. All
81 cases skipped in the general API invocation were matched by exact test
name to passing dedicated reports from the same merged-source workflow.
The PR-only synthetic alert run is explicitly earlier evidence on an identical
complete source tree; it is not described as a merge-commit run.

R19 freezes callable interfaces for later consumers, not their future live
implementations. R20 acceptance uses disposable S3, not a production account.
R21 uses disposable SMTP, not production sender deliverability. R23 producers
are active under their existing boundaries; hosted collection and approved
SLO values remain later work.

## Publication and handoff

1. Owner reviews and merges this acceptance record; this task does not merge it.
2. Coordinator verifies the immutable record commit is on `develop`, its
   frozen source/tree and current ownership, then updates publication identity,
   Wave 2 manifest and registry together. Never set `MERGED` in anticipation.
3. Each lane starts from the full frozen source with its exact file ownership.
   R27 preserves #162 and obtains its branch/worktree handoff; no automatic
   rebase, reset, peer import or force-push.

Live money/payouts, production verification flags, commercial decisions,
hosted infrastructure, branch protection and repository-wide security inventory
remain independent. Rollback of this publication is a reviewed revert of its
records/test-fixture change; retain corrective source and financial constraints.
