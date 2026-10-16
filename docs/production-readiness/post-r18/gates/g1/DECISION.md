# G1 source decision — ACCEPTED; publication pending

Mode A. The delegated coordinator accepts the integrated Wave 1 source and
disposable-service boundaries after reviewing the exact post-merge evidence.
This separate decision is proposed for owner review/merge. It authorizes no
Wave 2 execution while its publication is pending.

- Frozen source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Corrective source: owner-merged [PR #169](https://github.com/baraabd/homeservicemarketplace/pull/169).
- Evidence capture: `2026-10-16T21:42:17.935Z`.
- Accepted scoped inputs: R19, R20, R21, R22 and R23.
- Publication: `PENDING_OWNER_REVIEW_AND_MERGE`.
- Acceptance-record commit: assigned externally in the review PR; no guessed self hash.
- Startable lanes: none. R24–R28 remain `PLANNED` / held.

G1-01 through G1-05 are closed by merged source and executed cases, not by
aggregate green status alone. G1-06 still requires owner review/merge of this
record, actual publication-commit verification, and a deliberate coordinator
start decision. Source acceptance and start authorization are separate facts.

The complete source tree equals tested PR head `a93bdf6e5f6d403f6395f4c140fe52ff4ed319c4`. Seven push
workflows were independently inspected on the frozen merged commit. The
PR/dispatch-only alert and native-recovery workflows were not rerun on push;
their identical-tree PR evidence is supplemental and is labeled accordingly.

See [ACCEPTANCE_PUBLICATION.md](ACCEPTANCE_PUBLICATION.md),
[ACCEPTANCE_EVIDENCE.json](ACCEPTANCE_EVIDENCE.json),
[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) and [BLOCKERS.md](BLOCKERS.md).
The original blocked observations remain historical evidence in Git and in
the explicitly labeled earlier reconciliation documents.

This is not R18 release approval, hosted acceptance, a clean repository-wide
security-alert inventory, permission to spend, or live-money authorization.
R26 and the other future lanes are not implemented or accepted by this record.
