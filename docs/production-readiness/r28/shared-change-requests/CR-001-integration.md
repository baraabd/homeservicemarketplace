# R28 CR-001 — Shared CI, shutdown grace and edge handoff

State: **PROPOSED / INTEGRATION_PENDING; not applied by this lane**.

Requester: R28. Author/applicator: the G2 coordinator after ownership is serialized.
R28's existing lease covers only the five prepared infrastructure files listed in
IMPLEMENTATION.md. It grants no write authority for the global files below.
Resolve these proposals against the accepted integration candidate, without
importing an unmerged peer branch or overwriting the current coordinator work.

## 1. Run and retain the R28 controls in the existing staging workflow

Exact shared path: `.github/workflows/staging-boundary.yml`.

The current controls matrix runs only the existing runtime/launcher tests. The new
R28 test filename is not discovered by any current CI command. Add it to the
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

## 2. Give the API its reviewed worker shutdown window

Exact shared path: `infra/production/docker-compose.staging.yml`.

The API runs the outbox worker in-process. The inspected overlay has no explicit
stop grace, while the current worker defaults to 20,000 ms. The prepared R28 plan
proposes 30 seconds for that default. Apply the following only to the API service,
not to the reusable preflight anchor:

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

Publish the R28 final head/tree and local evidence first. The coordinator releases
or renews exact-file ownership before reassigning an author and updates wave status
only after integrated evidence. A green R28 draft is a source-review candidate;
it neither applies this CR nor grants a merge, deployment, infrastructure charge,
identity/policy change or live-money activation.
