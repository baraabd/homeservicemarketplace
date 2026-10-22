# R30 — ownership and blocked implementation handoff

Status: **PREPARATION_ONLY / G2_BLOCKED**. Mode A covers source inspection,
conditional package registration and integration requests. The requested R30
product work is Mode C; its runtime start remains blocked by the supplied prompt.

## Authority and source

The owner supplied the complete R30 package on 2026-10-18 and requested
continuation on 2026-10-22. `PROMPT.md` retains that package. The earlier explicit
delegation to coordinate G2 and prepare required repairs for review persists;
`../post-r18/gates/g2/OWNERSHIP.md` records that authority. It authorizes the
bounded conditional registration below, not an invented G2 acceptance, merge,
deployment, account grant, commercial policy or live-money activation.

- Actual fresh checkout/branch start: `96e92825f9b65cf124317f43b55ce42fc97f5b49`.
- Source tree: `68f4e926eabeb37bb70382c62b75272cf67bd02c`.
- Assigned branch: `feat/r30-manual-payment-review`.
- Isolated checkout: `hsm-r30`; clean before edits, no stashes.
- No open PR or remote R30 branch was observed before this reservation.
- Both existing G2 branches point to their already-merged October 18 tips.
- Approved G2 execution source/tree: **absent**. No R30 runtime implementation
  is authorized by this preparation or by recording its future exact filenames.

## Exact preparation scope and writers

Root coordinates this task, validates and commits. Agents do not change Git
refs, install dependencies or publish. Each writer reads outside its list freely
and writes only the files below. These temporary preparation leases expire at
completion of this review PR or explicit coordinator revocation.

### Root — evidence and source identity

```text
docs/production-readiness/r30/OWNERSHIP.md
docs/production-readiness/r30/PROMPT.md
docs/production-readiness/r30/IMPLEMENTATION.md
docs/production-readiness/r30/ACCEPTANCE.md
docs/production-readiness/r30/RISKS.md
docs/production-readiness/r30/ROLLBACK.md
docs/production-readiness/r30/SOURCE_MANIFEST.json
docs/production-readiness/r30/G2_REVIEW.md
docs/production-readiness/post-r18/gates/g2/OWNERSHIP.md
```

### Contract/storage writer — r30_contract_storage_audit

```text
docs/production-readiness/r30/PROPOSED_OWNERSHIP.json
docs/production-readiness/r30/shared-change-requests/CR-002-receipt-persistence.md
docs/production-readiness/r30/shared-change-requests/CR-003-private-evidence.md
docs/production-readiness/r30/shared-change-requests/CR-004-atomic-confirmation.md
```

### Root — UI/verification evidence

The earlier proposed documentation assignment is returned unused. Root owns
these two preparation files; the UI/governance agent owns only the separate
G2 performance repair lease below.

```text
docs/production-readiness/r30/VERIFICATION_PLAN.md
docs/production-readiness/r30/shared-change-requests/CR-005-web-contracts.md
```

### Conditional registration writer — r30_readiness_audit

The G2 coordinator grants this five-file serialized lease before edits. Copy
the supplied title, branch, dependencies and finite future paths into the
existing R30 slot. Use the existing supported `PLANNED` / blocked G2 state with
null frozen source, empty runtime shared leases and no startable lane. Preserve
every peer's record and all G1/G2 acceptance, evidence and policy authorities.
The registration is a reviewable proposal until owner merge; it never starts
the product work. Root supplies the exact proposal before registry mutation.

```text
docs/production-readiness/post-r18/SPRINT_REGISTRY.json
docs/production-readiness/post-r18/ACTIVE_STATUS.md
docs/production-readiness/post-r18/waves/WAVE_03.md
docs/production-readiness/post-r18/waves/wave-03.plan.json
docs/production-readiness/r30/shared-change-requests/CR-001-g2-registration.md
```

Except for the separately bounded G2 performance and comparison repairs below, all shared
runtime, schema, migrations, contracts, routes, CI, manifests, lockfiles and
policies remain unmodified. The proposals in CR-002 through
CR-005 are unapplied integration requests, not runtime leases. Root may perform
final formatting and evidence corrections after each writer returns its lease.

## G2 performance prerequisite repair — r30_governance_ui_audit

Under the standing explicit G2 repair delegation, the coordinator grants this
eleven-file lease before source edits. This repairs an earlier-wave blocker;
it does not start R30 payment implementation. Target the unchanged proposed
statement ceilings 5/10/7/3 using page-bounded parameterized projections.
Preserve fresh guards, ownership, cursor validation/null ordering, exact DTOs,
financial values, no-store, the measured index and every relevant assertion.
No dependency, schema, migration, budget, timeout or authorization change.

```text
apps/api/src/infrastructure/persistence/requests/service-request.repository.ts
apps/api/src/infrastructure/persistence/bids/provider-profile.repository.ts
apps/api/src/infrastructure/persistence/bookings/booking.repository.ts
apps/api/src/modules/provider/available-requests/available-requests.service.ts
apps/api/src/modules/provider/bookings/provider-bookings.service.ts
apps/api/src/modules/admin/financials/admin-financials.service.ts
apps/api/src/infrastructure/persistence/requests/service-request.repository.spec.ts
apps/api/src/modules/provider/available-requests/available-requests.service.spec.ts
apps/api/src/modules/provider/bookings/provider-bookings.service.spec.ts
apps/api/src/modules/admin/financials/admin-financials.service.spec.ts
apps/api/test/integration/g2-query-projections.integration.spec.ts
```

The existing performance harness and original budgets stay unchanged. Actual
PostgreSQL correctness, count/plan, cursor/category and final-head CI evidence
must precede a performance PASS. Even passing measurements do not approve
the budget policy or publish an accepted G2 freeze. Root owns final validation
and publication after the agent returns this exclusive lease.

## Measured G2 follow-up — r30_governance_ui_audit

The first published candidate `1a319133d387dd6747bfd412503f4458573cf10e`
passes functional checks and the four amplified statement ceilings, but the
unchanged evaluator reports 50 passes / 2 failures: complete generic plans for
provider and administrative booking lists sequentially scan 10,836
`ServiceRequest` rows during relation hydration. Before corrective edits, root
reassigns these two paths from the returned eleven-file lease exclusively to
`r30_governance_ui_audit`:

```text
apps/api/src/infrastructure/persistence/bookings/booking.repository.ts
apps/api/test/integration/g2-query-projections.integration.spec.ts
```

Retain a correlated primary-key lookup boundary for each returned page row,
preserving every existing field, authorization, cursor and null/deletion
invariant. Prove the prior source fails the new actual generic-plan regression,
then rerun equivalence and final-head R27. No new index, schema, dependency,
planner switch, guard, budget, comparator or harness change is authorized.
The earlier measured failure remains evidence; green workflow jobs alone do
not satisfy the failed performance gates. Root retains documentation, commits,
PR metadata and publication. The source writer returns this lease after checks.

The renewed source/test lease has been returned after the prior-query red proof,
36/36 real PostgreSQL cases, 74/74 targeted units, scoped lint/format and API
typecheck. Independent read-only review found no blocking defect. Root resumes
final formatting, source validation, normal-hook commits and publication; this
handoff grants no R30 product runtime authority.

## G2 comparison prerequisite repair — r30_readiness_audit

The unchanged comparator rejects the verified PR181 G1/candidate pair because
the owner's merged security upgrades changed the lockfile. Under the standing
G2 repair delegation, the coordinator grants this exact additional shared lease
before edits:

```text
.github/workflows/r27-performance.yml
```

Add a third `repair-baseline` runtime at the immutable PR base with the same
final-head harness. Manual runs require an explicit full-SHA input, with no
moving-branch or self-comparison fallback. Validate format, distinct commit,
ancestry, checkout identity and equal lockfile bytes before measurement. Retain
the original G1 and candidate jobs, existing assertions, toolchain pins,
permissions, timeouts, service isolation, sampling and artifact provenance.
Comparator, harness source and proposed budgets remain unchanged. Root must
verify `OBSERVED_COMPLETE_MATRIX` and zero missing groups, in addition to the
comparator exit code. The historical G1 dependency mismatch stays visible.
The agent may exercise temporary guard fixtures outside the repository; root
owns final validation and publication. This lease expires with this review PR
and grants no R30 runtime, policy approval or acceptance publication authority.

## Root — synthetic governance fixture correction

After conditional registration, the existing current-record suite reproduced
one failure (63 passed / 1 failed): its synthetic accepted wave freezes only
R32 and therefore reports `R30: inconsistent Wave 3 bases`. Before editing,
the coordinator grants root the exact additional path:

```text
.github/scripts/g2-current-record.test.mjs
```

Scope: update only the in-memory accepted contract double to freeze every
provided package consistently, while releasing only its existing R32 example.
Assert that R30 remains held and that inconsistent R30 bases are rejected.
Preserve every existing negative assertion. Production validator logic, real
gate data and acceptance/publication authority remain unchanged. This lease
expires with this review PR; it does not extend R30 runtime ownership.

## Conditional future runtime ownership

`PROPOSED_OWNERSHIP.json` names finite lane and dedicated test paths. Conditional
registration reserves their proposed ownership without granting an executable
base. Revalidate against the accepted G2 tree and current writers before start.
All shared changes require new exact serialized leases at that stage; proposed
schema paths do not reserve a second Wave 3 migration writer.

No R30 product database, Redis namespace, bucket, scanner, queue, container,
volume or browser origin is assigned. That runtime handoff must assign isolated
identities and inspect effective Compose values. The user's database,
environment files and sessions are not reused.

The separate G2 prerequisite verification uses a task-owned native PostgreSQL
16.15 instance at `127.0.0.1:54330`, database `hsm_r30_g2_test`, non-superuser
login `hsm_r30_g2_runner`, with data/socket/logs below
`/tmp/hsm-r30-postgres`. Root verified this identity before applying the unchanged
repository migrations and test seed. Four temporary extracted packages were
verified against signed Ubuntu index hashes; no system package installation or
configuration change was made. An interrupted initial metadata-only download
left partial shared apt index cache, which was recorded and not deleted.
This native instance cannot substitute for the unchanged R27 Docker-identity
guard. Root owns its validation and scoped shutdown; it does not start R30.
