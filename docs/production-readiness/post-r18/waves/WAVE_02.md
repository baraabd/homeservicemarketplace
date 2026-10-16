# Wave 2 — prepared, BLOCKED at G1

The canonical machine manifest is `wave-02.plan.json`. No frozen base exists;
no lane may start. The exact titles, branches, dependencies, new files, tests,
evidence paths, conditional leases and isolated resources are listed there.
The full prompts are in `../gates/g1/prompts/R19-R28.md`.

| Lane | Branch                           | Earlier-wave inputs | Readiness                                                 |
| ---- | -------------------------------- | ------------------- | --------------------------------------------------------- |
| R24  | feat/r24-money-api-integration   | R19, R22, R23       | BLOCKED: G1 and internal-port freeze                      |
| R25  | feat/r25-realtime-multi-instance | R22, R23            | BLOCKED: worker recovery and telemetry inputs             |
| R26  | feat/r26-application-security    | R20, R21, R23       | BLOCKED: G1; inventory evidence remains required          |
| R27  | feat/r27-performance-capacity    | R20, R23            | BLOCKED: G1; provisional pre-G1 #162 needs reconciliation |
| R28  | feat/r28-hosted-platform         | R20, R21, R22, R23  | BLOCKED: G1; target account/region/spend remain external  |

Allowlist approval covers **only** each enumerated path, conditional on accepted
G1 publication. It does not approve directory-wide edits. New unlisted files
require a coordinator amendment before writing. Shared integration paths stay
with the coordinator; infra leases name individual files and expire at G2 or
earlier revocation. One writer per path, including leases, is mechanically checked.
No production topology/permission/spending decision is inferred from a code lease.

R25 owns realtime code; R26 owns security-event definitions. Cross-boundary
revocation/session events require a coordinator-owned frozen interface; neither
lane imports an unmerged same-wave implementation. R24 cannot substitute wire
DTOs for missing callable ports. R27 owns measurements and proposals; R28's
platform/edge plan leases do not include Vite/routes/global Docker/Compose edits.

Each lane uses its own disposable database, Redis instance, buckets/roots,
Compose project, host ports, and browser cookie jar. Inspect fixed container and
volume names before boot; project naming alone is insufficient. Heavy service
tests may be serialized for resources, but worker concurrency is not reduced to
hide data races. Never copy the user's .env or use their database.

R27 PR #162 is already merged from `059c018576a75837d4dfb262ee49168d9217d881`.
Keep it. Once G1 is accepted, create a fresh worktree at the approved source,
compare its existing branch and harness, agree the handoff, and rerun measurements.
Do not reset, automatically rebase, cherry-pick peers or force-push it.

Start condition: close every G1 blocker, certify one full source/tree pair,
publish and owner-merge a separate ACCEPTED record, verify its publication and
source, then deliberately change the manifest and registry together. A green
coordination PR or a merged BLOCKED report does not satisfy this condition.
