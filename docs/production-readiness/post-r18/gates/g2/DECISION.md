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
