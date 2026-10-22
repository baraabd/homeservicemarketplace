# R28 CR-001 — Shared CI, shutdown grace and edge handoff

State: **PARTIALLY_APPLIED / INTEGRATION_PENDING**. Sections 0 and 1 were applied
by the separately authorized repair in PR_REPAIR_20261018.md. Owner-merged G2
source-applied section 2's 30-second API Compose grace; its actual target evidence
and section 3 remain pending. Section 4 records the bounded successor handoff.

Requester: R28. Author/applicator: the G2 coordinator after ownership is serialized.
The original R28 lease covered five prepared infrastructure files and expired at
the G2 decision. The exact successor assignment in IMPLEMENTATION.md covers three
platform files and owned tests/evidence; it grants no write authority for the
still-pending global files below.
Resolve these proposals against the accepted integration candidate, without
importing an unmerged peer branch or overwriting the current coordinator work.

## 0. Current-base integration into the R28 branch — APPLIED

Disposition: the owner-authorized repair integrated develop
`6e13120f140e973e793e9e1a7e76170dcb1850a0` while preserving the frozen G1 ancestor.
Both are present in reviewed head `e197e943bca78859976f0495b388f376cb4c0136`.
PR_REPAIR_20261018.md and the PR ledger record the source and subsequent checks.
During successor verification the owner merged PR #179, then PR #180. The R28
successor normally integrated that owner-merged develop revision
`75bd688e7254b84316b32f82b0f6ee337249b977` under continuing coordinator authority.
Its new nine-file delta requires a corrective Draft PR because #179 is merged.
No unmerged peer source was consumed; G2 remains BLOCKED in the merged record.
The following describes the original request, superseded by those integrations.

The first published R28 head follows the required frozen G1 source. Current
`develop` (`4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`) also contains the later
owner-merged R24/R25/R26/R27 work. GitHub runs the current R26/R27 workflows for
PR #179, but those workflows deliberately check out the R28 head as their harness.
That frozen head does not contain their post-G1 test files:

- R26 requires `scripts/production/security-app/verify-boundaries.test.cjs` and
  `verify-boundaries.cjs`.
- R27 requires `apps/web/playwright.r27.config.ts` and its accompanying real-route
  browser harness. Both baseline and candidate measurements use that newer harness.

This caused actual missing-file failures before the R26/R27 acceptance scenarios
could run. The precise run/job IDs and final source identity belong in the PR
ledger. These files are outside R28's exact authoring allowance; copying a few
files or disabling the workflows would not produce valid acceptance.

Requested coordinator/owner authorization: **normally merge the exact already
owner-merged develop revision into `feat/r28-hosted-platform`**, preserving the G1
source as provenance and all accepted peer work. This does not merge R28 into
develop. CLAUDE.md requires explicit merge authorization, and the inspected G1
handoff grants no general R28 integration lease. The R24-specific integration
permission cannot be reused for this lane.

A non-applied `git merge-tree` review found no conflicts; the resulting diff
against current develop contains only R28's 12 files. Recompute its candidate
tree after any R28 corrective commit and publish that concrete identity for review.
No integration commit or ref update to that candidate is performed without the
requested authority. Afterwards, retain the exact final head/tree and rerun all
affected checks; prior green runs do not validate the integrated source.

## 1. R28 controls in the existing staging workflow — APPLIED

Disposition: `.github/workflows/staging-boundary.yml` runs the R28 tests and plan
check on Linux and Windows and retains the report/source SHA. The authorized
repair also added them to `.github/workflows/production-governance.yml`. The
following preserves the original request and its minimal patch for provenance.

Exact shared path: `.github/workflows/staging-boundary.yml`.

The original controls matrix ran only the existing runtime/launcher tests. The new
R28 test filename was not discovered by its CI command. The request was to add it to the
existing Linux/Windows matrix and retain the configuration report next to the same
source SHA. Keep all current tests, image checks, gate dependencies and permissions.

Minimal proposed patch against the inspected workflow:

```diff
@@
           node scripts/runtime/toolchain.cjs
-          node --test infra/production/check-runtime.test.cjs infra/production/staging.test.cjs | tee controls.tap
+          node --test infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/platform/validate-plan.test.cjs | tee controls.tap
+          node scripts/production/platform/validate-plan.cjs --check | tee platform-plan.json
           git rev-parse HEAD > source-sha.txt
@@
             controls.tap
+            platform-plan.json
             source-sha.txt
```

Existing `set -euo pipefail` must remain so `tee` cannot mask failures. A valid
unselected template intentionally passes ordinary `--check` and explicitly reports
HOSTED_ENVIRONMENT_BLOCKED. Do not make hosted authority optional or convert the
checker to report acceptance. `--require-target` is a later declaration-completeness
check with an expected exit 2 for this template, not a deployment permission.

Validation: execute the full existing-plus-R28 test command on Node 24.21.0 for
Linux and Windows; run the check CLI; inspect retained `controls.tap`,
`platform-plan.json` and `source-sha.txt` on the final integration SHA. Keep the
existing image jobs and gate green. No package, dependency, database migration,
public contract or feature-flag change is required by this patch.

## 2. Give the API its reviewed worker shutdown window — SOURCE_APPLIED

Exact shared path: `infra/production/docker-compose.staging.yml`.

Disposition: owner-merged G2 at `75bd688e7254b84316b32f82b0f6ee337249b977` sets
`stop_grace_period: 30s` on the API service. The R28 successor preserves that
accepted source. Protected-setting comparison and actual pending-work shutdown
evidence below remain pending; no target was deployed or inspected by R28.

The API runs the outbox worker in-process. The originally inspected overlay had
no explicit stop grace, while the worker defaults to 20,000 ms. The prepared R28
plan proposes 30 seconds for that default. The historical patch below is now
applied to the API service, not to the reusable preflight anchor:

```diff
@@
   api:
     <<: *api
     command: ['node', '--env-file=/run/secrets/api_env', 'deploy/start-api.cjs', '/app']
+    stop_grace_period: 30s
     networks: [runtime]
```

This literal supports the reviewed 20,000 ms worker setting. The runtime allows
`OUTBOX_SHUTDOWN_GRACE_MS` up to 120,000 ms; **30 seconds is insufficient for all
possible configurations**. Before target acceptance, the coordinator/operator must
compare the actual protected worker setting, `runtime.outboxShutdownGraceMs`, the
plan stop grace and the effective Compose stop grace without printing secrets.
If another value is selected, update/review both plan and Compose so container
grace strictly exceeds worker grace, then reapprove the new plan fingerprint.
Do not assume the offline declaration check reads the protected runtime file.

Validation: retain sanitized effective stop-grace evidence; rerun the existing
staging boundary checks; on an approved isolated target stop an API with pending
outbox work and prove controlled shutdown plus correct durable retry/delivery.
No migration, dependency, source contract or flag change is required. Do not
increase a global timeout to hide an unrelated failure.

## 3. Bind an actual edge and secret process to the prepared contracts

Existing shared application paths relevant to integration are
`apps/web/nginx.conf`, `apps/api/src/main.ts`,
`apps/api/src/config/env.schema.ts`, `infra/production/check-runtime.cjs` and
`infra/production/staging.cjs`. R28 proposes **no speculative code patch** to these
without a selected edge/provider and the accepted R25/R26 candidate.

Before hosted acceptance, the coordinator must name the exact applied edge adapter
path/version and its writer. Implement the rules in
`infra/production/edge/edge-policy.json`, including route normalization,
`/socket.io/` WebSocket and polling, unbuffered `/v1/me/events`, denied public
`/metrics`, exact approved Origin handling, Set-Cookie preservation, enforced CSP
with the actual web assets and private-media cache/CDN restrictions. Verify the
actual `CSP_MODE`, proxy trust and protected metrics settings; the prepared JSON
does not install headers or change runtime defaults.

Select an authorized secret store/delivery process, immutable API/migrator snapshot
identities and cross-system rotation/deployment serialization. The current
staging lock must remain intact; do not treat Compose mounts as encryption or a
file-version string as proof of secret-manager integration. Keep independent
origin arguments, bounded secret-file checks, source/digest validation and
DEPLOYED_NOT_ACCEPTED behavior in the existing launcher.

Required integration evidence: real same-origin authenticated browser journeys,
negative/absent/null Origins as appropriate for each transport, session revocation,
AR/EN/RTL/mobile/keyboard inspection, TLS certificate rejection, public ingress
denials, real external mail, scanner verdicts, restricted storage and durable
workers on the approved target. R36 owns isolated restore; R35/R37 own representative
hosted journeys/load. None was run against an external target by this lane.

## Handoff and approval boundary

### 2026-10-22 PR #181 test-only repair

The existing PR coordination record assigns exactly
`apps/api/test/integration/r11-reviews-reputation.integration.spec.ts` for the
integration failure in run `39149960222`. The owner renewed the repair request
on 2026-10-22. IMPLEMENTATION.md records the single-author assignment, listener
ownership correction and failure-draining behavior. Root updates the five
existing R28 evidence documents; the PR now has ten authored paths against the
same base. No further shared workflow, application or infrastructure change is
added. Preserve the original failed run and require fresh source/CI evidence;
the external requirements and prior database refinement below remain unchanged.

### 4. Database privilege contract refinement — successor handoff

The request and exact three-file successor infrastructure assignment were
published in PR #179 before changing the schema, then recorded in IMPLEMENTATION.md.
The previous G1 lease is not reused beyond its G2-decision expiry.

Require `databaseOwner: false` and `databaseCreate: false` for both API and migrator
under `services.postgres`. These are distinct from `createDatabase` (the role's
CREATEDB attribute). The operator guide now inspects the current database ACL and
direct/inherited/SET ROLE owner authority. The migration identity continues to
perform DDL only inside the pre-created application schema. No database is
queried, modified or granted rights by the validator.

Exact implementation files: `infra/production/platform/topology.json`,
`infra/production/platform/inputs.schema.json`,
`infra/production/platform/README.md`, and
`scripts/production/platform/validate-plan.test.cjs`; five existing R28 evidence
documents record scope, tests, risks and rollback. No application interface,
Prisma schema, migration, dependency or global workflow changes are requested.

The coordinator must use the reviewed successor schema and regenerate/review
any copied R28 inputs and their fingerprint before later integration. A prior
complete input omitting either new field now fails closed. PR #180 was first
inspected at `5d96bd17cc490579434007806345d8e0502ec679`, then owner-merged into
develop at `75bd688e7254b84316b32f82b0f6ee337249b977` and normally integrated into
this successor. Its prior copied configuration is not silently promoted to the
new contract. No source or metadata was written to the PR #180 branch.

Acceptance requires omitted-field and unsafe-grant rejection tests, unchanged
configuration-only/no-side-effect behavior, final-head CI/CodeQL and the later
authorized-target database privilege audit. Target roles, hosted denial probes,
spending and deployment remain externally blocked.

Publish the R28 final head/tree and local evidence first. The coordinator releases
or renews exact-file ownership before reassigning an author and updates wave status
only after integrated evidence. A green R28 draft is a source-review candidate;
it neither applies the pending CR sections nor grants a merge, deployment, infrastructure charge,
identity/policy change or live-money activation.
