# Wave 2 — source frozen, acceptance publication pending

> **Post-merge update (R27 handoff):** PR #171 was owner-merged at
> `0568739096ceeaf0cfc79034626886e258fe4328`. Its frozen runtime source/tree
> and ancestry were verified; 29 latest publication-head checks succeeded.
> `SOURCE_MANIFEST.json` now records MERGED. Only assigned R27 is READY_TO_START;
> other lanes await their own session handoff. The pre-merge account below is
> retained as history and its publication hold is superseded by this notice.

Frozen source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
Frozen complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
Machine manifest: `wave-02.plan.json`; decision: `../gates/g1/SOURCE_MANIFEST.json`.
G1 technical source acceptance is complete. **No lane may start until this
separate acceptance record is owner-reviewed, merged and verified.**

| Lane | Branch                           | Earlier-wave inputs | Current hold                                   |
| ---- | -------------------------------- | ------------------- | ---------------------------------------------- |
| R24  | feat/r24-money-api-integration   | R19, R22, R23       | G1 publication                                 |
| R25  | feat/r25-realtime-multi-instance | R22, R23            | G1 publication                                 |
| R26  | feat/r26-application-security    | R20, R21, R23       | G1 publication                                 |
| R27  | feat/r27-performance-capacity    | R20, R23            | G1 publication and branch handoff              |
| R28  | feat/r28-hosted-platform         | R20, R21, R22, R23  | G1 publication; hosted choices remain external |

The exact file allowlists and individual leases are unchanged. Their approval
is effective only after accepted G1 publication. Unlisted files and all shared
runtime/config/schema/CI paths require serialized coordinator ownership.
No lane consumes an unmerged peer or treats an interface as implemented runtime.

Use the manifest's isolated disposable database, Redis, storage, ports and
browser context. Inspect fixed container and volume names before starting
services; never copy the user's environment or reuse a working database.

## R27 handoff

Preserve merged PR #162 and branch head
`2e8d1dba35f2a36a73d47100d8495f5379bc028c`. Its measurements are pre-G1 evidence.
After publication, create a fresh worktree at the frozen source, compare the
existing branch/harness, record the explicit branch handoff and rerun baselines.
No automatic reset, rebase, cherry-pick of peer work or force-push is authorized.
The 17 existing pure harness tests passed in this certification session; they
are not new performance measurements or R27 acceptance.

## Release of the hold

After owner merge, the coordinator records the already-existing immutable
acceptance-record commit under `publication.acceptanceRecordCommitSha`, proves
its ancestry on `develop`, rechecks the frozen source/tree and ownership, then
updates `publication.state`, lane statuses and registry together. This record
does not anticipate that merge, and no `wave-02.ready.json` is fabricated.
