# G1 decision — BLOCKED

Decision UTC: 2026-10-16T08:33:09.185443+00:00. Issued by the delegated engineering integration
coordinator for repository owner `baraabd`, under the supplied G1 prompt.
Mode A. This is the Wave 1 → Wave 2 gate, not historical R18-G1 and not a
production-release decision.

**All required implementation and corrective PRs are merged. G1 is not accepted.**
The current pipeline omits required scenarios, R19's internal-port freeze is
incomplete, and R22/R23 integration requests remain unimplemented. A green
pipeline does not establish these missing requirements.

- Inspected merged candidate: `54a69f78c0227a2f2b94df851a3ebb941348d8aa`.
- Exact candidate tree: `6f638f5f3aedbcc5b795b62da11bb3000f7dba4b`.
- `frozenBaseSha`: **not assigned**; `frozenTreeSha`: **not assigned**.
- Acceptance-record commit: **not assigned** (no accepted decision exists).
- Coordination branch: `coord/g1-wave2-freeze`.
- Publication: Draft PR, owner review/merge pending; final commit/head is
  bound externally in that PR to avoid a self-referential hash.
- Startable lanes: **none**. R24–R28 stay blocked with `PLANNED` lifecycle status.

The current candidate is byte-identical to R23 corrective head
`f3f9ef491ac8d8296c655d0e010d8ad2a39e7cf5`; both have the tree above.
Git ancestry verifies all nine Wave 1 implementation/corrective merge commits.
The source repair in this PR is additional and requires its own exact-head
checks; it does not inherit acceptance from the inspected candidate.

See [MERGE_MATRIX.md](MERGE_MATRIX.md), [REQUIREMENTS.md](REQUIREMENTS.md),
[CHANGE_REQUESTS.md](CHANGE_REQUESTS.md), [INTEGRATION_EVIDENCE.md](INTEGRATION_EVIDENCE.md)
and [BLOCKERS.md](BLOCKERS.md). The machine decision is [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json).
Wave 2's exact conditional allowlists are in [wave-02.plan.json](../../waves/wave-02.plan.json).
No `wave-02.ready.json` is created.

Historical G0 records are retained as dated evidence. The recovered complete
prompts resolve the missing-package inventory; they do not retroactively make
the competing R19/R21 schema writes compliant. Both schema blocks and ordered
migrations are present, and the candidate database checks passed.

The owner must first review/merge required corrective source through the
normal process. The coordinator then tests that exact merged candidate,
closes every G1 blocker, publishes a separate ACCEPTED record, and obtains
its required owner review/merge before any Wave 2 start statement is valid.
This task performs no merge, auto-merge, force push, deployment or live activation.
