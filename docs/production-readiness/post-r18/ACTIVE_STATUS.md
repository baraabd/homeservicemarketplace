# Post-R18 active status index

Generated from `SPRINT_REGISTRY.json` (the only authority) on 2026-10-13 at
frozen base `059c018576a75837d4dfb262ee49168d9217d881`.
`.github/scripts/sprint-registry.mjs` fails CI if this table and the
registry disagree on a title or status. A status here is coordination state,
not acceptance evidence.

Last numbered milestone: **R18** (PR #155, merged as `059c018`). That
number says the R18 work merged; the R18 release decision is still
**NO-GO / `R18_BLOCKED`** (`../r18/GO_NO_GO.md`). PR #156 is an
unnumbered native-development hotfix, open and not merged.

| ID  | Title                                                                              | Wave | Status                   | Branch                             | PR   |
| --- | ---------------------------------------------------------------------------------- | ---- | ------------------------ | ---------------------------------- | ---- |
| R19 | Extend and certify the existing money authority; freeze shared financial contracts | 1    | IMPLEMENTED              | feat/r19-money-authority-contracts | #159 |
| R20 | (pending package)                                                                  | 1    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R21 | (pending package)                                                                  | 1    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R22 | (pending package)                                                                  | 1    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R23 | (pending package)                                                                  | 1    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R24 | (pending package)                                                                  | 2    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R25 | (pending package)                                                                  | 2    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R26 | (pending package)                                                                  | 2    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R27 | (pending package)                                                                  | 2    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R28 | (pending package)                                                                  | 2    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R29 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R30 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R31 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R32 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R33 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R34 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R35 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R36 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R37 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R38 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |

`RESERVED_PENDING_PACKAGE`: the ID and its wave are fixed, but the
package's `SPRINT_PLAN.json` and lane prompt were not provided, so no
title, branch, ownership or dependency is recorded. Nothing is invented to
fill them.
