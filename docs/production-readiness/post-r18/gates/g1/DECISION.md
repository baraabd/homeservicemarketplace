# G1 decision — ACCEPTED source and verified merged publication

Decision UTC: 2026-10-16T21:41:51.823662+00:00. Mode A. This is the Wave 1 to Wave 2 engineering gate,
not the historical R18-G1 branch-protection issue or a production release.

The integrated Wave 1 boundaries are accepted on the merged source below.
**The owner merged PR #171 and the coordinator verified its immutable identity.
Wave 2 is READY_TO_START under the exact ownership and isolation manifest.**

- Frozen source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Corrective source: owner-merged PR #169, following #168.
- Publication branch: `coord/g1-wave2-acceptance`.
- Acceptance-record commit: `0568739096ceeaf0cfc79034626886e258fe4328` (PR #171).
- Reviewed head: `578ae9359fb93a46e478b1db0ca043a0c73aca51`; reviewed/merged tree:
  `ceaa111acd43e07a89e49728996933b9204bd73d`. This is distinct from the frozen runtime tree.
- Wave 1 status: `SANDBOX_ACCEPTED` for R19 through R23.
- Wave 2 status: `READY_TO_START`; exact ownership for R24–R28 takes effect.
- Verification: [PUBLICATION_VERIFICATION.md](PUBLICATION_VERIFICATION.md) and its JSON companion.

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

1. Owner merge completed at `2026-10-16T23:01:54Z`; this task did not perform it.
2. Frozen-source ancestry and identical reviewed/merged trees are verified.
   Publication identity, Wave 2 manifest and registry are reconciled together.
3. Assigned sessions start from the full frozen source under exact ownership.
   R27 preserves #162 and follows the explicit handoff in PUBLICATION_VERIFICATION.md;
   no automatic rebase, reset, peer import or force-push.

Live money/payouts, production verification flags, commercial decisions,
hosted infrastructure, branch protection and repository-wide security inventory
remain independent. Rollback of this publication is a reviewed revert of its
records/test-fixture change; retain corrective source and financial constraints.
