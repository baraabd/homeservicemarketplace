# R28 — Source evidence and hosted acceptance boundary

Evidence date: **2026-10-17**. Scope: the 12 exact files in IMPLEMENTATION.md.

| State                                                 | Result and limit                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED                                           | Platform/edge input contracts, offline validator, negative/concurrency tests and handoff documents          |
| SOURCE_VERIFIED                                       | Applicable local checks below passed; publication CI/CodeQL belongs to the final-head PR ledger             |
| INTEGRATION_PENDING                                   | CR-001: explicit shared CI coverage, effective API stop grace, selected edge and secret-process integration |
| EXTERNAL_BLOCKED                                      | No authorized account/resources/region/cost or actual hosted target evidence                                |
| CONFIGURATION_ONLY                                    | Both unselected and fully populated synthetic input remain configuration-only                               |
| SANDBOX_ACCEPTED / HOSTED_ACCEPTED / RELEASE_ACCEPTED | Not asserted                                                                                                |

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

The checked-in plan/edge/schema fingerprint is:

```text
00930548859d95781434fcd8727ce38775be9bdfe2d123f089639d150afdf8e3
```

It covers the canonical non-secret declarations and schema under
`hsm.platform-validator/v1`. It is not an owner signature or proof that a target
was inspected. Real target IDs, approval documents, secrets, raw env files and
browser sessions are not embedded in this source evidence.

## Executed local checks

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
| `node --test scripts/production/platform/validate-plan.test.cjs infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/storage/storage-plan.test.cjs scripts/production/storage/storage-cli.test.cjs` | **455 passed**, 0 failed/cancelled/skipped/todo; 342 R28 + 95 existing staging + 18 existing storage |
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

The current workflow does not name the new R28 test file. Until the coordinator
applies CR-001, local R28 coverage and existing remote regression gates are separate
facts. Green existing Actions alone do not prove Windows execution of R28 or an
applied platform/edge. Remote run/artifact IDs are retained in PR metadata to avoid
creating a new source SHA merely by documenting the run that checked the old SHA.

## Failures, warnings and unrun checks

- Initial subprocess tests failed with executor `EPERM`; rerunning with authorized
  process access executed the real child CLI tests. They were not skipped or mocked
  away. Final counted suites have no failures or skips.
- Early test development exposed a stderr/stdout expectation issue and actual
  falsey-edge fallback, schema-snapshot and DNS validation defects. Corrected
  behavior is covered by the final passing regression suite.
- One ESLint control-regex error was corrected without relaxing the lint rule.
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
