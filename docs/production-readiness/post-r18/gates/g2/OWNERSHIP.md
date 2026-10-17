# G2 coordinator ownership

## Authority and identity

Repository owner baraabd explicitly delegated complete G2 coordination, remediation and a review pull request in this conversation at 2026-10-17T20:06:42Z. The delegation authorizes preparation and required repairs; it does not authorize merge, deployment, live money, external spend, production grants or fictional acceptance. R32 starts only after G2 is approved and its publication identity is verified.

- Delivery mode: Mode A, integration and correctness.
- Branch: `chore/g2-wave2-acceptance`.
- Isolated worktree: `/workspace/scratch/ca0e1fde8f79/homeservicemarketplace-g2`.
- Actual start: `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`.
- Actual start tree: `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`.
- Preserved G1 runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Worktree was clean, assigned branch was created in a fresh clone and there were no stashes.
- No G2 branch or open pull request existed at reservation time.

## Exact serialized leases

The delegated coordinator is the accountable writer and approves the following exact subtask leases before their source edits. Each has one writer; no lease authorizes unlisted paths. All expire on completion of this G2 review PR or explicit coordinator revocation. Root performs commits, publication and final source verification. Agents do not change Git refs or install shared node_modules.

### Governance validator writer: gate_audit

Scope: additive, fail-closed G2/Wave 3 validation and negative tests. Preserve all existing G1 invariants and evidence semantics. This code checks records; it cannot grant approval.

- `.github/scripts/wave-gate.mjs`
- `.github/scripts/wave-gate.test.mjs`
- `.github/scripts/sprint-registry.mjs`
- `.github/scripts/sprint-registry.test.mjs`

### Frozen refund port writer: refund_contract_audit

Scope: an additive confirmed-refund participant token/interface and unavailable default, module composition and a consumer/type fixture. Preserve authorizeReservation, existing rail observation states and all runtime R24 behavior. R32 owns later policy implementation and confirmed-result orchestration; document this handoff instead of claiming its completion. No migration or new refund authority.

- `apps/api/src/modules/money/ports/refund.port.ts`
- `apps/api/test/support/g2-money-ports-consumer.fixture.ts`
- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/money.module.spec.ts`

### R28 configuration prerequisite writer: r28_plan

Scope: checked plans and exact HOSTED_ENVIRONMENT_BLOCKED evidence permitted by the committed R28 prompt when target/resource authorization is absent. Extend the existing operator-managed staging architecture and validators. Do not choose hosting accounts, providers, regions, budgets, DNS or secrets. No apply command, deployment or hosted-acceptance claim.

- `infra/production/platform/README.md`
- `infra/production/platform/inputs.schema.json`
- `infra/production/platform/topology.json`
- `infra/production/edge/README.md`
- `infra/production/edge/edge-policy.json`
- `scripts/production/platform/validate-plan.cjs`
- `scripts/production/platform/validate-plan.test.cjs`
- `docs/production-readiness/r28/IMPLEMENTATION.md`
- `docs/production-readiness/r28/ACCEPTANCE.md`
- `docs/production-readiness/r28/RISKS.md`
- `docs/production-readiness/r28/ROLLBACK.md`
- `docs/production-readiness/r28/shared-change-requests/CR-001-integration.md`

### Root coordinator records

Scope: reconcile actual merged source/CI and gate evidence, freeze only a tested candidate, record the future exact Wave 3 ownership and preserve publication hold. Historical G1 records are not rewritten. The R32 prompt is retained in full with original-byte provenance and the single final newline required by repository formatting. Other unprovided lane packages remain held until their actual authority is supplied.

- `docs/production-readiness/post-r18/gates/g2/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g2/IMPLEMENTATION.md`
- `docs/production-readiness/post-r18/gates/g2/ACCEPTANCE.md`
- `docs/production-readiness/post-r18/gates/g2/RISKS.md`
- `docs/production-readiness/post-r18/gates/g2/ROLLBACK.md`
- `docs/production-readiness/post-r18/gates/g2/DECISION.md`
- `docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g2/CONTRACT_CATALOG.md`
- `docs/production-readiness/post-r18/gates/g2/REQUIREMENTS.md`
- `docs/production-readiness/post-r18/gates/g2/MERGE_MATRIX.md`
- `docs/production-readiness/post-r18/gates/g2/ACCEPTANCE_EVIDENCE.json`
- `docs/production-readiness/post-r18/gates/g2/CHANGE_REQUESTS.md`
- `docs/production-readiness/post-r18/gates/g2/prompts/R32.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/WAVE_03.md`
- `docs/production-readiness/post-r18/waves/wave-03.plan.json`

## Pending runtime repair lease

The combined develop R25 job failed after R24 merged; exact cause is not yet reproduced. Root will record any required runtime/test repair paths here before editing them. Existing gates, assertions, timeouts and security budgets remain intact. Any R27 query/cache/index repair receives its own exact extension with measured evidence; no policy budget is silently approved.

### R27 private HTTP and browser authority writer: refund_contract_audit

Granted by the owner-delegated G2 coordinator on 2026-10-17 before these edits. Scope: resolve CR-R27-04 with an early private/no-store policy, retain explicit immutable public-media behavior, and prove real cross-tab logout and fresh permission revocation in the existing identity-verified disposable R27 harness. New candidate expectations do not relabel the frozen baseline. Preserve guards, parser limits, cookies, assertions and timeouts. The money-port lease above is unchanged; root serializes final validation. This lease expires at G2 review PR completion or coordinator revocation.

- `apps/api/src/main.ts`
- `apps/api/src/infrastructure/http/cache-control.ts`
- `apps/api/src/infrastructure/http/cache-control.spec.ts`
- `apps/web/r27-tests/performance.real-api.spec.ts`

No authentication runtime, workflow, shared role grant, live account, dependency or migration is authorized by this lease. A runtime authority failure requires a new exact recorded repair lease. Test revocation/restoration is restricted to the harness's existing verified disposable database and original fixture row.

### R27 financial fixture and measured index writer: gate_audit

Granted by the G2 coordinator on 2026-10-17 after completion of the four governance files above. Scope: representative completed and soft-deleted booking fixtures through existing guarded completion endpoints, real financial list/page/authorization evidence, and default-planner parameter-bound EXPLAIN comparison. The proposed index is added only after a measured isolated PostgreSQL comparison justifies it. Preserve all financial values and ledger history; no runtime cursor contract, budget, threshold or authorization change. The existing baseline harness overlay must measure the identical fixture against both immutable baseline and candidate. This is the only active G2 schema/migration writer, after owner-merged R24 source is fixed at the recorded start. Lease expires at G2 review PR completion or revocation.

- `scripts/perf/post-r18/query-profile.mjs`
- `scripts/perf/post-r18/lib/amplify.mjs`
- `scripts/perf/post-r18/lib/financials.mjs`
- `scripts/perf/post-r18/lib/financials.test.mjs`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261017220000_g2_completed_booking_read_index/migration.sql`

The schema edit is restricted to one Booking read index. Mutating a row's sort key does not become snapshot pagination; characterize that limit explicitly. Unapproved budgets remain proposals and cannot support a PASS claim. Root commits after the agent supplies its measured decision and verifies migration drift.

### Root integration wiring and migration inventory

The coordinator reserves these exact shared paths before edits to add R28 source tests to the existing governance workflow and reconcile the authoritative model/migration reference index if the measured Booking index is added. Existing workflow jobs and assertions remain required.

- `.github/workflows/production-governance.yml`
- `docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json`

### R26 UTC token-boundary corrective writer: r28_plan

Granted by the owner-delegated G2 coordinator on 2026-10-17 after the R28 plan lease completed. A clean-source real HTTP probe proved that a correct fresh delivered OTP is rejected with AUTH_OTP_INVALID when the isolated PostgreSQL session uses Asia/Riyadh: Prisma UTC timestamp-without-time-zone fields were compared with clock_timestamp() as timestamptz. The exact repair normalizes all six conditional-read/write clocks in the existing token repository to UTC. Preserve database-time atomic expiry, purpose, single-use, attempts, resends, locks and rollback; no migration, policy limit, authentication bypass or timeout change. Regression tests use SET LOCAL TIME ZONE inside their own transactions, covering UTC and positive/negative offsets, fresh/expired consume, failed attempts, rotation and UTC usedAt. Expires on G2 PR completion or revocation.

- `apps/api/src/infrastructure/persistence/iam/verification-token.repository.ts`
- `apps/api/test/integration/r04-auth-lifecycle.integration.spec.ts`

This confirmed local defect is distinct from the unpublished remote R25 browser failure. Do not claim the remote root cause without evidence. Root configures only the task-owned R25 database to UTC for a separate original-source CI-parity run. No other database session or application configuration is changed by the regression suite.

### R28 independent-review corrective writer: refund_contract_audit

After the original R28 twelve-file writer completed and returned its lease, the G2 coordinator grants this exact two-file corrective lease on 2026-10-17. Independent in-memory mutation probes showed that length-only hosted-evidence/source-reference checks accepted repeated entries and that API Dockerfile/health identity could drift. Require unique named mandatory categories/references and the actual API/web build and health identities, with negative regression cases. Additions may remain explicit; no hosted approval or new resource is inferred. This writer is exclusive for these two paths until completion/revocation; the original R28 writer is now working only its separately leased UTC token correction.

- `scripts/production/platform/validate-plan.cjs`
- `scripts/production/platform/validate-plan.test.cjs`

## UTC rotation binding correction within the active R04 lease

Coordinator authorizes the existing UTC-token writer to normalize the single raw SQL `rotateLiveChallenge` expiry parameter explicitly from `timestamptz` to UTC timestamp, in addition to the six database-clock expressions already leased. The real three-zone regression improved from 16/21 to 20/21 after the clock changes and isolated the remaining failure to parameter binding in this same repository. Strengthen the existing rotation test with exact stored-expiry bounds. The exclusive paths remain `apps/api/src/infrastructure/persistence/iam/verification-token.repository.ts` and `apps/api/test/integration/r04-auth-lifecycle.integration.spec.ts`; token lifetime, attempt limits, schema and public contract are unchanged.

## R25 REST/socket presentation correlation correction

Coordinator is the exclusive writer for these four paths. The unchanged original R25 browser scenario on the combined base with a UTC database reached multi-tab durable notification recovery and observed two presentations for one booking start. REST summaries omit the actor identifier carried by the socket envelope. Add bounded, user-scoped cross-tab correlation for that missing-actor boundary in either arrival order, preserving the existing test that two known different actors remain distinct. Retain the original real-browser assertion, timing limits, privacy rules and authorization behavior.

- `apps/web/src/lib/realtime/side-effects.ts`
- `apps/web/src/lib/realtime/side-effects.test.ts`
- `apps/web/src/lib/realtime/notification-baseline.ts`
- `apps/web/src/lib/realtime/notification-baseline.test.ts`

## Media path canonicalization correction

Coordinator grants `/root/refund_contract_audit` an exclusive four-path corrective lease after a read-only executable probe showed that `portfolio-staging//ref/synthetic.jpg` passes local storage validation, fails portfolio classification and normalizes to the protected canonical file. Reject empty path segments before storage access and validate decoded public-read keys before namespace classification, returning the existing uniform 404. Preserve authorized public request media and approved portfolio behavior; prove malformed literal/encoded aliases cannot bypass moderation or receive public immutable cache headers, including with a deliberately permissive storage test double. No storage, ownership, permission or API contract relaxation is authorized.

- `apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts`
- `apps/api/src/infrastructure/storage/local-disk-storage.adapter.spec.ts`
- `apps/api/src/modules/media/media.controller.ts`
- `apps/api/test/e2e/restricted-media-boundary.e2e.spec.ts`

## Concurrent R28 delivery consolidation

Remote inspection during preparation found the owner's parallel R28 Draft PR #179 at `e91c6c596e3154d24f4aa8637ddc901adfa15d64`, tree `854a2763ce2e00f9235e4c15fb5540a77358ed54`. It contains a complete alternative for all twelve R28 paths already leased above. The coordinator will retain the provisional local slice as a private checkpoint, import the twelve exact immutable peer blobs unchanged into this integration candidate, then rerun the actual pinned checks. This consolidates the same-wave delivery without changing, closing or merging #179 or its branch. Prior provisional fingerprints/counts remain historical only. Root owns the twelve paths for this import and evidence reconciliation; no other writer is active on them. The R28 source alternative remains CONFIGURATION_ONLY and the hosting authority remains blocked.

## R28 coordinator CI and reviewed default shutdown grace

Root is the exclusive writer for the two shared paths below to apply the concrete source-level parts of imported R28 CR-001. Add the R28 controls and retained configuration report to the existing Linux/Windows staging matrix, preserving every test, image job, aggregate, permission and shell failure check. Add API-only `stop_grace_period: 30s` for the current default 20,000 ms outbox worker grace. This is a prepared default, not evidence that a selected protected target uses that value; larger configured worker grace requires separately reviewed matching container settings before any deployment. Hosted edge, secrets, account authorization and actual shutdown acceptance remain explicit external blockers.

- `.github/workflows/staging-boundary.yml`
- `infra/production/docker-compose.staging.yml`

## R27 candidate index installation and generic-plan evidence

Coordinator renews `/root/gate_audit` as exclusive writer for the three paths below. The candidate `--assert-repairs` gate must verify the exact new Booking index catalog definition, ordered columns/directions, validity and readiness, and retain successful nonempty generic/bound financial EXPLAIN evidence. Record baseline absence normally; assert installation only for the candidate. Preserve actual normalized financial SQL and complete generic plans. Do not force planner choices, disable sequential scans, approve budgets, change fixtures or weaken existing repair assertions.

- `scripts/perf/post-r18/query-profile.mjs`
- `scripts/perf/post-r18/lib/financials.mjs`
- `scripts/perf/post-r18/lib/financials.test.mjs`

## Isolation and handoff

Use this clone's independent node_modules, dist, generated clients and caches. Task-specific binaries are outside the repository; no machine-wide runtime switch. Disposable PostgreSQL/Redis/mail/storage and browser contexts must use this coordinator's own identities and ports. No other session's database, environment, stash, process or branch is modified.

The source manifest, registry and PR distinguish source checks, integrated disposable-service evidence, hosted/policy holds and owner publication. Each subtask hands back changed paths, commands, exit codes and limitations; root verifies the assembled candidate. No lane is released by a draft record or green checks alone.

## Assembled publication scope

### R28 descriptor-reader correction consolidation

Before publication, the coordinator reviewed the one-commit descendant of the selected R28 delivery: `60b64cd8216294d7476a7a22607ee56feb18dec4`, tree `a89d8cdf69f7fa368dc9ffb91fc1b241bdcc49b5`. Root renews exclusive import ownership for the six exact paths below. Adopt their immutable peer blobs unchanged, preserving local checkpoint `f93ddb5509a33c471a4f3758889643e581727aa9` and the historical e91c source evidence. The correction validates the opened file descriptor against the current path before reading bytes and adds replacement/symlink regressions. Its unchanged plan fingerprint does not identify validator source bytes. Fresh integrated tests and official final-head CodeQL remain required. This import does not merge, modify or close the peer branch or PR.

- `scripts/production/platform/validate-plan.cjs`
- `scripts/production/platform/validate-plan.test.cjs`
- `docs/production-readiness/r28/ACCEPTANCE.md`
- `docs/production-readiness/r28/IMPLEMENTATION.md`
- `docs/production-readiness/r28/RISKS.md`
- `docs/production-readiness/r28/shared-change-requests/CR-001-integration.md`

The initial coherent review checkpoint comprises these 61 exact paths. Earlier lease sections establish the author and disposition for each source slice; this inventory adds no executable Wave3 ownership. Imported R28 files retain their exact peer blobs. Final record-only successors are identified separately in acceptance evidence.

- `.github/scripts/sprint-registry.mjs`
- `.github/scripts/sprint-registry.test.mjs`
- `.github/scripts/wave-gate.mjs`
- `.github/scripts/wave-gate.test.mjs`
- `.github/workflows/production-governance.yml`
- `.github/workflows/staging-boundary.yml`
- `apps/api/src/infrastructure/http/cache-control.spec.ts`
- `apps/api/src/infrastructure/http/cache-control.ts`
- `apps/api/src/infrastructure/persistence/iam/verification-token.repository.ts`
- `apps/api/src/infrastructure/storage/local-disk-storage.adapter.spec.ts`
- `apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts`
- `apps/api/src/main.ts`
- `apps/api/src/modules/media/media.controller.ts`
- `apps/api/src/modules/money/money.module.spec.ts`
- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/ports/refund.port.ts`
- `apps/api/test/e2e/restricted-media-boundary.e2e.spec.ts`
- `apps/api/test/integration/r04-auth-lifecycle.integration.spec.ts`
- `apps/api/test/support/g2-money-ports-consumer.fixture.ts`
- `apps/web/r27-tests/performance.real-api.spec.ts`
- `apps/web/src/lib/realtime/notification-baseline.test.ts`
- `apps/web/src/lib/realtime/notification-baseline.ts`
- `apps/web/src/lib/realtime/side-effects.test.ts`
- `apps/web/src/lib/realtime/side-effects.ts`
- `docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/gates/g2/ACCEPTANCE.md`
- `docs/production-readiness/post-r18/gates/g2/ACCEPTANCE_EVIDENCE.json`
- `docs/production-readiness/post-r18/gates/g2/CHANGE_REQUESTS.md`
- `docs/production-readiness/post-r18/gates/g2/CONTRACT_CATALOG.md`
- `docs/production-readiness/post-r18/gates/g2/DECISION.md`
- `docs/production-readiness/post-r18/gates/g2/IMPLEMENTATION.md`
- `docs/production-readiness/post-r18/gates/g2/MERGE_MATRIX.md`
- `docs/production-readiness/post-r18/gates/g2/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g2/REQUIREMENTS.md`
- `docs/production-readiness/post-r18/gates/g2/RISKS.md`
- `docs/production-readiness/post-r18/gates/g2/ROLLBACK.md`
- `docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g2/prompts/R32.md`
- `docs/production-readiness/post-r18/waves/WAVE_03.md`
- `docs/production-readiness/post-r18/waves/wave-03.plan.json`
- `docs/production-readiness/r28/ACCEPTANCE.md`
- `docs/production-readiness/r28/IMPLEMENTATION.md`
- `docs/production-readiness/r28/RISKS.md`
- `docs/production-readiness/r28/ROLLBACK.md`
- `docs/production-readiness/r28/shared-change-requests/CR-001-integration.md`
- `infra/production/docker-compose.staging.yml`
- `infra/production/edge/README.md`
- `infra/production/edge/edge-policy.json`
- `infra/production/platform/README.md`
- `infra/production/platform/inputs.schema.json`
- `infra/production/platform/topology.json`
- `packages/database/prisma/migrations/20261017220000_g2_completed_booking_read_index/migration.sql`
- `packages/database/prisma/schema.prisma`
- `scripts/perf/post-r18/lib/amplify.mjs`
- `scripts/perf/post-r18/lib/financials.mjs`
- `scripts/perf/post-r18/lib/financials.test.mjs`
- `scripts/perf/post-r18/query-profile.mjs`
- `scripts/production/platform/validate-plan.cjs`
- `scripts/production/platform/validate-plan.test.cjs`
