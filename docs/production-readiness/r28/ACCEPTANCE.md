# R28 — Source evidence and hosted acceptance boundary

Original evidence date: **2026-10-17**, covering the original 12-file scope.
The 2026-10-18 successor is scoped and assigned in IMPLEMENTATION.md. Historical
counts below are retained as original evidence; they are not fresh test results
for a newer commit. The final-head PR ledger records current source acceptance.

## 2026-10-18 successor verification

Starting source: `e197e943bca78859976f0495b388f376cb4c0136`, tree
`60df06295cde83bdfcf6f725caa2c7bc94cde39d`, originally integrating develop
`6e13120f140e973e793e9e1a7e76170dcb1850a0`. After the owner merged PR #179 and
PR #180 during this work, the successor normally integrated current develop
`75bd688e7254b84316b32f82b0f6ee337249b977`, tree
`953f1556497502bb7c9828e763732416adbfc3d6`. The original frozen G1 source below
is retained. The successor's nine-file scope and prepared-file assignment were
recorded before implementation in IMPLEMENTATION.md and published in PR #179;
its new source and final checks belong to the corrective Draft PR. G2 acceptance
remains BLOCKED in the owner-merged source.

The current configuration fingerprint is:

```text
d2b75052c99e89d4699c53fd93e74920b710ee092dad856c541b730943a2dbf2
```

Both database-owner and database-level-CREATE fields are required and fixed to
false for API and migrator declarations. Four newly added omitted-field tests
failed with `Missing expected exception` on the original schema, then passed after
the correction. Four additional unsafe-grant cases and one prior-fingerprint
rejection case also pass. The platform suite therefore increases from 344 to
**353** tests without removing, skipping or weakening any prior case.

Commands ran in `/workspace/scratch/e21baf16b335/hsm-r28` with an isolated copy of
the pinned Node 24.21.0/pnpm 10.32.1 toolchain and independent node_modules. The
package download store was reused, not another worktree's installed modules.
Every PASS below returned exit 0; the incomplete-target check returned its required
exit 2. No local database, Docker daemon or hosted target was used.

| Command                                                                                                                                                                                                                                                         | Actual successor result                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile --store-dir /tmp/hsm-r26-20261018-store`                                                                                                                                                                              | PASS; six workspace projects, 1,166 packages reused, zero downloads; contracts prepare/build passed; lockfile unchanged          |
| `node scripts/runtime/toolchain.cjs`                                                                                                                                                                                                                            | PASS exact Node 24.21.0 and repository declarations; pnpm 10.32.1 verified                                                       |
| `node --test --test-reporter=tap scripts/production/platform/validate-plan.test.cjs infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/storage/storage-plan.test.cjs scripts/production/storage/storage-cli.test.cjs` | **466 passed**, 0 failed/cancelled/skipped/todo: 353 R28, 95 staging, 18 storage                                                 |
| `node --test --test-reporter=tap .github/scripts/*.test.mjs scripts/security/dependency-audit.test.cjs scripts/security/secret-scan-tree.test.cjs`                                                                                                              | **385 passed**, 0 failed/cancelled/skipped/todo: 339 governance, 46 security                                                     |
| `pnpm exec eslint scripts/production/platform/validate-plan.cjs scripts/production/platform/validate-plan.test.cjs --max-warnings=0`                                                                                                                            | PASS, zero warnings                                                                                                              |
| `node --check scripts/production/platform/validate-plan.cjs` and `node --check scripts/production/platform/validate-plan.test.cjs`                                                                                                                              | PASS both files                                                                                                                  |
| `node scripts/production/platform/validate-plan.cjs --check`                                                                                                                                                                                                    | PASS; CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED, nine blocker groups, authorizationVerified false, deploymentStarted false |
| `node scripts/production/platform/validate-plan.cjs --check --require-target`                                                                                                                                                                                   | Expected exit 2; missing target declarations rejected                                                                            |
| `node .github/scripts/production-governance.mjs` and `node .github/scripts/release-baseline.mjs`                                                                                                                                                                | PASS; source governance only, no sprint/wave promotion                                                                           |
| `node scripts/production/storage/storage-plan.cjs --check`                                                                                                                                                                                                      | PASS, STORAGE_PLAN_OK                                                                                                            |
| `pnpm security:audit --output /workspace/scratch/e21baf16b335/r28-evidence/audit-full.json`                                                                                                                                                                     | PASS; all severity counters zero                                                                                                 |
| `pnpm security:audit:prod --output /workspace/scratch/e21baf16b335/r28-evidence/audit-production.json`                                                                                                                                                          | PASS; all severity counters zero                                                                                                 |
| Scoped Prettier, normal commit hooks and `git diff --check`                                                                                                                                                                                                     | Required on the nine listed successor paths before publication; final execution recorded in the PR ledger                        |

The first local attempt was prevented by sandbox child-process `EPERM`; it is not
counted as a behavioral regression. Authorized-process execution subsequently
produced the four actual assertion failures before the schema edit and 730 passing
source tests after it, before integrating the newly owner-merged baseline. The
repeated suites on integrated develop `75bd688e7254b84316b32f82b0f6ee337249b977`
then passed all **851** tests above; G2 contributes 121 additional governance cases.
These counts are separate checkpoints, not additive test totals.
Existing ignored dependency build-script
warnings for `@parcel/watcher` and `unrs-resolver` remain; no package approvals or
runtime/dependency changes were made. Optional Python `jsonschema` and local
PostgreSQL were unavailable; their validation is not claimed.

Pinned Gitleaks 8.24.3 was verified against archive SHA-256
`9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
The final committed-tree scan, full source identity, history scan, CodeQL result,
Actions/artifact identifiers and actual source checkout belong together in the PR
ledger after that source exists. Previously observed 36/36 checks on `e197e943`
are historical evidence, not acceptance of this successor. Every new published
head must complete its own required checks, while this PR stays Draft for missing
hosted/integration evidence.

The PostgreSQL audit is a read-only operator query, not executed target evidence.
Database-owner/CREATE denial, positive migrator DDL in the existing schema, real
network/TLS/SMTP/storage/scanner/worker behavior and applied edge tests still need
the approved isolated target. The original API/browser CI is retained and runs
against the published source or its actual GitHub integration merge as each
workflow specifies; it is not described as local or hosted validation.

## Current acceptance states

| State                                                 | Result and limit                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED                                           | Platform/edge input contracts, offline validator, negative/concurrency tests and handoff documents                                              |
| SOURCE_VERIFIED                                       | Applicable local checks below passed; publication CI/CodeQL belongs to the final-head PR ledger                                                 |
| INTEGRATION_PENDING                                   | CR-001: effective shutdown-window evidence, selected edge and secret-process integration; CI and 30-second API Compose grace are source-applied |
| EXTERNAL_BLOCKED                                      | No authorized account/resources/region/cost or actual hosted target evidence                                                                    |
| CONFIGURATION_ONLY                                    | Both unselected and fully populated synthetic input remain configuration-only                                                                   |
| SANDBOX_ACCEPTED / HOSTED_ACCEPTED / RELEASE_ACCEPTED | Not asserted                                                                                                                                    |

## Source, tooling and reproducibility

- Branch: `feat/r28-hosted-platform`.
- Actual frozen base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen base tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Ownership/publication authority: the G1 acceptance and later inspected manifest
  identified in IMPLEMENTATION.md. Current develop was not silently substituted
  for the assigned frozen source.
- Toolchain: Node **24.21.0**, pnpm **10.32.1**, isolated node_modules from
  `pnpm install --frozen-lockfile`. Official Node archive SHA-256 and pnpm package
  integrity were verified before use; no machine-wide runtime was switched.
- Final commit/tree, PR URL, Actions runs, job/artifact IDs and official CodeQL
  result are recorded together in the final-head PR description. A commit cannot
  contain its own hash; any new source commit invalidates the previous final-head
  acceptance record until rechecked.

The original plan/edge/schema fingerprint was:

```text
00930548859d95781434fcd8727ce38775be9bdfe2d123f089639d150afdf8e3
```

It covered the canonical non-secret declarations and schema under
`hsm.platform-validator/v1`. It is not an owner signature or proof that a target
was inspected. Real target IDs, approval documents, secrets, raw env files and
browser sessions are not embedded in this source evidence.

## Original executed local checks

Commands ran from the isolated repository with the pinned toolchain on PATH.
Every listed PASS completed with exit **0**, except the explicitly expected
`--require-target` exit **2**. No assertion, gate, test timeout or security budget
was weakened to obtain these results.

| Command                                                                                                                                                                                                                                     | Result                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                            | PASS; 6 workspace projects, 1,166 packages; lockfile unchanged; contracts prepare/build also passed  |
| `node scripts/runtime/toolchain.cjs`                                                                                                                                                                                                        | PASS exact runtime/declarations                                                                      |
| `pnpm exec prettier --check` on the exact 12 changed paths                                                                                                                                                                                  | PASS, all 12 files; exact invocation is listed below                                                 |
| `pnpm exec eslint scripts/production/platform/validate-plan.cjs scripts/production/platform/validate-plan.test.cjs --max-warnings=0`                                                                                                        | PASS, 0 warnings                                                                                     |
| `node --check scripts/production/platform/validate-plan.cjs` and the same for `validate-plan.test.cjs`                                                                                                                                      | PASS both CommonJS syntax checks                                                                     |
| `node scripts/production/platform/validate-plan.cjs --check`                                                                                                                                                                                | PASS; CONFIGURATION_ONLY, HOSTED_ENVIRONMENT_BLOCKED, 9 blocker groups                               |
| `node scripts/production/platform/validate-plan.cjs --check --require-target`                                                                                                                                                               | Expected exit 2; missing target declarations are not accepted                                        |
| `node --test scripts/production/platform/validate-plan.test.cjs infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/storage/storage-plan.test.cjs scripts/production/storage/storage-cli.test.cjs` | **457 passed**, 0 failed/cancelled/skipped/todo; 344 R28 + 95 existing staging + 18 existing storage |
| `node --test .github/scripts/*.test.mjs scripts/security/dependency-audit.test.cjs scripts/security/secret-scan-tree.test.cjs`                                                                                                              | **204 passed**, 0 failed/cancelled/skipped/todo                                                      |
| `node scripts/production/storage/storage-plan.cjs --check`                                                                                                                                                                                  | PASS, STORAGE_PLAN_OK; offline R20 policy check                                                      |
| `node .github/scripts/production-governance.mjs`                                                                                                                                                                                            | PASS repository governance; does not verify GitHub protection                                        |
| `node .github/scripts/release-baseline.mjs`                                                                                                                                                                                                 | PASS source-backed registry; does not accept the sprint/wave                                         |
| `pnpm security:audit --output /workspace/scratch/504a128f6293/r28-evidence/audit-full.json`                                                                                                                                                 | PASS; info/low/moderate/high/critical all **0**                                                      |
| `pnpm security:audit:prod --output /workspace/scratch/504a128f6293/r28-evidence/audit-production.json`                                                                                                                                      | PASS; info/low/moderate/high/critical all **0**                                                      |

Final exact formatting command:

```sh
pnpm exec prettier --check \
  docs/production-readiness/r28/IMPLEMENTATION.md \
  docs/production-readiness/r28/ACCEPTANCE.md \
  docs/production-readiness/r28/RISKS.md \
  docs/production-readiness/r28/ROLLBACK.md \
  docs/production-readiness/r28/shared-change-requests/CR-001-integration.md \
  scripts/production/platform/validate-plan.cjs \
  scripts/production/platform/validate-plan.test.cjs \
  infra/production/platform/README.md \
  infra/production/platform/inputs.schema.json \
  infra/production/platform/topology.json \
  infra/production/edge/README.md \
  infra/production/edge/edge-policy.json
```

There is no new TypeScript package or compiled runtime artifact in this lane.
The changed CommonJS runs directly under the exact Node runtime. Existing API/web
builds, real-service and browser suites are retained in repository CI; their
publication results must be linked to the final PR head, not inferred from syntax
or the install-time contracts build.

## Behavioral and adversarial coverage

The R28 suite executes the actual checker/CLI with temporary JSON inputs. Fully
populated targets are **synthetic contract fixtures**, not owner approvals or cloud
resources. Tested behavior includes:

- Valid unselected and complete synthetic plans; no fabricated hosted acceptance.
- Closed nested schema, unknown/missing/invalid fields, unsafe privilege changes,
  network exposure, policy flags, optional services and worker placement.
- API/migrator separation, logical collision checks for DB/Redis/buckets/restore,
  exact registry and per-role repository binding, immutable release images and
  reuse of the existing launcher manifest/origin checks.
- DNS label and total-host bounds for service, registry, image and HTTPS origins,
  including a release whose edge origin has not been selected.
- TLS/SMTP combinations, CORS/cookies/CSP, both Socket.IO transports, SSE behavior,
  private-media/CDN boundaries and container-versus-worker shutdown grace.
- Canonical fingerprint stability/tampering, stale supplied hashes, same validated
  schema snapshot, invalid explicit falsey edge inputs, bounded/symlink input
  rejection, descriptor mutation, safe error redaction and CLI exits 0/1/2.
- Four concurrent real CLI readers with identical reports and unchanged input.
  An instrumented complete-input run refuses any subprocess/network/file mutation
  or declared/ambient secret access while the checker completes successfully.

Those instruments establish the checker's offline side-effect boundary. They do
not replace actual cloud/network, database-role, browser or secret-store tests.

## Final-head publication evidence

Use the existing repository secret-scan helper after the commit exists:

```sh
node scripts/security/secret-scan-tree.cjs \
  --gitleaks /workspace/scratch/504a128f6293/toolchain-r28/bin/gitleaks \
  --work-dir /workspace/scratch/504a128f6293/r28-evidence/final-source-scan \
  --report /workspace/scratch/504a128f6293/r28-evidence/final-source-scan.sarif
```

Gitleaks **8.24.3** was downloaded and verified against the existing CI checksum
`9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
The actual scan's final commit, file/byte count and result belong in the PR ledger,
alongside final-head history scanning, Actions and official CodeQL security-result
evidence. This document does not predeclare those publication checks as passed.

The PR must remain Draft while required integration/hosted evidence is absent.
The repository's metadata check may pass a Draft; its final technical-acceptance
collector intentionally rejects Draft and an unintegrated current base. Do not
call that collector's blocked state a hosting approval or remove the Draft flag
just to obtain an acceptance label.

The authorized repair now names the R28 test file in both production governance
and the staging Linux/Windows matrix, retaining the plan report and source SHA.
CR-001 sections 0 and 1 are applied. Source-bound Windows execution is verified
from those actual jobs; it still does not prove an applied hosted platform/edge.
Remote run/artifact IDs are retained in PR metadata to avoid creating a new source
SHA merely by documenting the run that checked the old SHA.

## Failures, warnings and unrun checks

- Initial subprocess tests failed with executor `EPERM`; rerunning with authorized
  process access executed the real child CLI tests. They were not skipped or mocked
  away. Final counted suites have no failures or skips.
- Early test development exposed a stderr/stdout expectation issue and actual
  falsey-edge fallback, schema-snapshot and DNS validation defects. Corrected
  behavior is covered by the final passing regression suite.
- One ESLint control-regex error was corrected without relaxing the lint rule.
- First publication CodeQL found one file-system-race alert in the R28 JSON reader.
  The correction opens the descriptor before checking path metadata, verifies
  non-symlink identity before reading, and adds replacement/no-follow-fallback
  regressions. Only a later observed official CodeQL result can close this alert;
  successful execution of the CodeQL Actions job alone is insufficient.
- The first R26/R27 publication workflows failed on missing post-G1 harness files,
  outside the original R28 allowance. PR_REPAIR_20261018.md records the authorized
  current-base integration that resolved them. The original failed runs remain
  historical failures; later checks validate their own source. No check is disabled.
- Frozen install reported ignored build scripts for `@parcel/watcher@2.6.0` and
  `unrs-resolver@1.12.2`; no package/build approval or dependency change was made.
- Optional Python meta-schema tooling was unavailable (`jsonschema` absent);
  no Python schema-validation PASS is claimed. The actual checked-in subset is
  exercised through the tested validator.
- No Docker daemon, disposable PostgreSQL/Redis/S3 service stack or authorized
  external target was available to this lane. Existing offline storage/launcher
  tests are not real-service evidence. The CI jobs run their own disposable stack;
  only their observed final-head results may be reported as such.
- No UI code changed. No local AR/EN/RTL/mobile/keyboard screenshots or real-route
  browser journeys were executed/inspected. Applied-edge browser acceptance remains
  required on the representative authorized target; no screenshots are fabricated.

## Exact hosted blocker record

Default checker result: `targetInputsComplete: false`,
`authorizationVerified: false`, `deploymentStarted: false`.

| Blocker ID                         | Owner                                            | Required completion evidence                                                                                                  |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| HOSTED_TARGET_AUTHORITY_REQUIRED   | Infrastructure and spending owner                | Exact provider/account/region/host/DNS/registry repositories/secret store, cost ceiling and separate operator/spend approvals |
| HOSTED_SERVICE_INPUTS_REQUIRED     | Database, storage, mail and security owners      | Selected service IDs/endpoints/roles/buckets and real privileges, TLS, storage, delivery and scanner evidence                 |
| HOSTED_RELEASE_INPUTS_REQUIRED     | Release owner                                    | Accepted source and three immutable image references in the existing staging manifest                                         |
| HOSTED_NETWORK_EVIDENCE_REQUIRED   | Network owner                                    | Existing private network and actual firewall/public-ingress denials                                                           |
| HOSTED_SECRET_DELIVERY_REQUIRED    | Secret rotation operator                         | Separate immutable API/migration versions and tested rotation/rollout serialization                                           |
| REGISTRY_PROVENANCE_REQUIRED       | Release and registry owner                       | Trusted registry/builder and per-image attestation references, verified externally                                            |
| ISOLATED_TARGETS_REQUIRED          | Infrastructure owner and R35/R36/R37 coordinator | Distinct production comparison resources, isolated restore approval/resources and representative hosted test approval         |
| RECOVERY_ACCEPTANCE_REQUIRED       | Data owner and R36 coordinator                   | Approved retention/RPO/RTO and measured isolated restore evidence                                                             |
| EDGE_INTEGRATION_EVIDENCE_REQUIRED | Edge owner and R25/R26 coordinator               | Approved origin/certificate, applied policy/CSP and real transport/browser evidence                                           |

When a release is selected without independent CLI origins, an additional
INDEPENDENT_ORIGIN_APPROVAL_REQUIRED blocker is returned. Populating all metadata
only changes hostedStatus to HOSTED_EVIDENCE_PENDING. The checker still cannot
verify authority or accept a target.

R16/R18 policy gates remain with their existing owners. No merge, deployment,
resource purchase, image publication, identity grant or live-money activation was
performed by this sprint. ROLLBACK.md and CR-001 define the bounded handoff.
