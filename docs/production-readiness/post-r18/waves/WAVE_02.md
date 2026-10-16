# Wave 2 — frozen source, awaiting G1 publication

The canonical manifest is `wave-02.plan.json`. Frozen runtime source:
`40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; tree `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
G1 source is accepted on post-merge evidence, but its separate record is
`PENDING_OWNER_REVIEW_AND_MERGE`. No lane may start yet.

| Lane | Branch                           | Earlier-wave inputs | Current hold                                                                  |
| ---- | -------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| R24  | feat/r24-money-api-integration   | R19, R22, R23       | G1 publication and assigned-owner start decision                              |
| R25  | feat/r25-realtime-multi-instance | R22, R23            | G1 publication and assigned-owner start decision                              |
| R26  | feat/r26-application-security    | R20, R21, R23       | Owner-merged G1 publication verification; this owner session is assigned next |
| R27  | feat/r27-performance-capacity    | R20, R23            | G1 publication and provisional #162 reconciliation/handoff                    |
| R28  | feat/r28-hosted-platform         | R20, R21, R22, R23  | G1 publication; hosted account/region/spend decisions remain external         |

The exact existing file lists and isolated runtime resources are preserved.
R26's exact allowlist is coordinator-approved conditional on verified G1
publication. This grants no directory-wide edit, shared configuration change,
IAM mutation, dependency upgrade, deployment or external spend. Additional
files require an exact coordinator lease before editing.

After owner merge, inspect the actual acceptance-record commit and its Git
ancestry, recheck the frozen source/tree and active ownership, record the
publication identity, and change the manifest and registry together before
starting an assigned lane. Never invent a self-referential publication hash.
Do not infer READY_TO_START from the word ACCEPTED alone.

R25 owns realtime implementation; R26 must preserve the frozen security-event
payload contracts. R24 consumes the accepted V1 money ports. R27's pre-G1
merged harness is retained and needs explicit handoff/new measurements; do not
reset, rebase or force-push a peer branch. R28 topology is not authorized spend.

Every lane uses an isolated worktree, dependencies/generated outputs, database,
Redis instance, storage namespace, Compose resources, ports and cookie jar.
No user's working database or copied environment is used. All live rails stay off.
