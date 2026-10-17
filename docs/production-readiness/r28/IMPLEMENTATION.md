# R28 — Authorized hosted topology and release inputs

## Scope and authority recorded before implementation

Delivery mode: **Mode A — Integration and Bug-Fix Mode**. This lane prepares
checked configuration for the existing operator-managed staging architecture.
It does not select or provision an account, enable live money, grant access,
merge, or deploy.

- Assigned branch: feat/r28-hosted-platform.
- Isolated worktree: /workspace/scratch/504a128f6293/hsm-r28.
- Actual execution base: 40cdac5c9ce6acaa8dedc0385984a807ae9a84d0.
- Frozen source tree: 109b514fe9833a9aac3e8caecd7f9b14d4f61b3b.
- G1 acceptance publication: owner-merged PR #171,
  0568739096ceeaf0cfc79034626886e258fe4328.
- The current wave-02.plan.json was inspected at develop
  4e87bf03663fb3c72ffee983fdb70c2863e1ce8a. R28 is READY_TO_START with
  APPROVED_AFTER_VERIFIED_G1_PUBLICATION ownership and no G1 blockers.
- The initial worktree was clean and had no stash. R28 implementation paths
  did not exist at the frozen base.

The exact seven owned files are this document, ACCEPTANCE.md, RISKS.md,
ROLLBACK.md, shared-change-requests/CR-001-integration.md, and
scripts/production/platform/validate-plan.cjs plus validate-plan.test.cjs.
The five explicitly leased files are infra/production/platform/README.md,
inputs.schema.json, topology.json, and infra/production/edge/README.md plus
edge-policy.json.

The existing G1 lease is EXACT_INFRASTRUCTURE_FILES, granted by the G1 delegated
coordinator under the owner's 2026-10-16 instruction, effective after accepted
publication. It permits prepared file authoring only, expires at G2 or earlier
revocation, and requires final-head evidence before ownership is reassigned.
This is an existing recorded lease, not a new self-granted permission. No
directory-wide or shared-glue lease is asserted.

## Implementation

**IMPLEMENTED:** the prepared platform/edge contracts and their offline validator.
**INTEGRATION_PENDING:** coordinator-owned CI, container stop grace and the selected
edge/secret-provider integration. **EXTERNAL_BLOCKED:** hosted target authority and
real target evidence. This lane does not assert SANDBOX_ACCEPTED, HOSTED_ACCEPTED
or RELEASE_ACCEPTED. Executed source verification is recorded in ACCEPTANCE.md.

The existing `infra/production/staging.cjs` remains the sole application rollout
authority. No cloud provider/account, region, registry, DNS zone, secret store,
budget, approved target or selected release was supplied by the owner or recorded
in the inspected authority. Those fields remain null in the checked-in template.
An explicit `HOSTED_ENVIRONMENT_BLOCKED` result satisfies this sprint's permitted
external-blocker exit without pretending that a hosted environment exists.

### Exact changed-file manifest

| Path                                                                         | Authority and purpose                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/production-readiness/r28/IMPLEMENTATION.md`                            | Owned; scope, findings and source identity                                   |
| `docs/production-readiness/r28/ACCEPTANCE.md`                                | Owned; commands, counts, evidence boundaries and blockers                    |
| `docs/production-readiness/r28/RISKS.md`                                     | Owned; concrete residual risks and owners                                    |
| `docs/production-readiness/r28/ROLLBACK.md`                                  | Owned; configuration rollback and future rollout boundary                    |
| `docs/production-readiness/r28/shared-change-requests/CR-001-integration.md` | Owned; exact proposed coordinator changes, not applied patches               |
| `scripts/production/platform/validate-plan.cjs`                              | Owned; offline validation CLI and library                                    |
| `scripts/production/platform/validate-plan.test.cjs`                         | Owned; behavioral, rejection and concurrent-reader tests                     |
| `infra/production/platform/README.md`                                        | Leased; selected-target procedure and actual privilege evidence requirements |
| `infra/production/platform/inputs.schema.json`                               | Leased; closed platform and edge input schema                                |
| `infra/production/platform/topology.json`                                    | Leased; unselected target and explicit security/recovery proposals           |
| `infra/production/edge/README.md`                                            | Leased; applied-edge handoff and test requirements                           |
| `infra/production/edge/edge-policy.json`                                     | Leased; same-origin edge policy declarations                                 |

All 12 paths are covered by the existing [R28 manifest entry at the inspected
develop revision](https://github.com/baraabd/homeservicemarketplace/blob/4e87bf03663fb3c72ffee983fdb70c2863e1ce8a/docs/production-readiness/post-r18/waves/wave-02.plan.json).
The older copy at the frozen runtime base predates the acceptance publication;
it is not substituted for the later approved ownership record. No global CI,
Compose/Docker, staging launcher, central registry, source contract, app entrypoint,
package manifest, lockfile or migration is modified.

Authoring was partitioned between the validator/evidence writer, one test writer,
and one five-file infrastructure writer. The latter two released their files
before final integration/formatting. Independent review was read-only. No peer
branch was imported, no shared runtime was reused and no stash was popped.

### Platform and security behavior

- Reuse the existing distinct API, migrator and web digest-pinned release manifest;
  validate it through the actual `staging.cjs` functions. Preserve independent
  approved origins, source SHA, project/network identity and secret-path boundaries.
- Define separate API/migrator role policies, including ownership, inherited
  membership, migration-history writes and TRUNCATE restrictions. Supply read-only
  PostgreSQL 16 inspection queries and require actual disposable-target permission
  denial tests; variable names alone do not prove privileges.
- Require declared private ingress, TLS/authenticated dedicated Redis, distinct
  DB/Redis/buckets across staging/production/restore, current R20 storage authority,
  required SMTP TLS, private ClamAV and disabled optional Mongo.
- Match workers to existing code: outbox/cleanup/scan/verification-expiry/public
  cleanup run in the API; only evidence retention and dispute maintenance have
  independent binaries. Keep their existing modes off. Compare proposed container
  stop grace strictly against the worker grace; actual Compose integration remains
  a coordinator request.
- Use external immutable API/migrator secret snapshots, serialized rotation and
  exact registry/repository identities. Evidence references do not prove secret
  encryption, trustworthy provenance or operator authorization.
- Propose seven-day PostgreSQL base-backup/WAL retention, 300-second RPO and
  14,400-second RTO for owner acceptance. Preserve R20 object-versioning/retention
  authority, require an isolated R36 restore and reserve representative R35/R37
  target references. None is measured or configured on a real target here.
- Prepare same-origin secure cookies, strict CORS, enforced CSP, TLS, exact
  Socket.IO and SSE routes, denied public management access, and non-public
  verification/portfolio media. This is a policy contract, not an installed
  reverse-proxy product. R25/R26 behavior arrives through coordinator integration.
- Preserve R16/R18 money and verification decisions, no-demo-provider initialization
  and the last-active-admin floor. No identity, policy, grant or live rail changes.

### Validator contract and side effects

`hsm.platform-inputs/v1` and `hsm.edge-policy/v1` use a closed JSON Schema
draft-2020-12 subset. `hsm.platform-validator/v1` implements only that checked-in
subset and rejects unsupported keywords/references. It never retrieves a schema.
The existing staging manifest stays `schemaVersion: 1`; there is no database
schema, Prisma, dependency or public application-contract change.

`--check` opens a bounded regular JSON input once, then validates the path entry
against the opened descriptor before reading. It rejects symlinks/entry replacement
and detects changes during descriptor reads. It never reads declared secret files or contacts a
target. The module has no provisioning, network, subprocess, grant, secret-write
or deployment operation. Its `--apply` argument is rejected. Opaque evidence
identifiers and resource values are omitted from error reports.

The SHA-256 fingerprint covers canonical plan, edge and schema content plus the
validator contract version. Validation and fingerprinting use the same schema
snapshot. Reordering JSON keys does not change the fingerprint; a semantic change
does. `--expected-plan-sha` rejects stale input. This is not a signature or an
authenticated approval; even complete synthetic input remains CONFIGURATION_ONLY
with `authorizationVerified: false` and `deploymentStarted: false`.

### Inspection sources and unresolved integration

Read-first authority included CLAUDE.md (Mode A), the UX/UI policy, R15 accounting
and ledger documents, R16 PAYOUT_POLICY, R18 BLOCKERS/OWNER_DECISIONS/production
initialization, the live-money gate and G1 publication/wave manifest. Relevant ADRs
include deployment topology, optional Mongo, transactional outbox, restricted
identity media, policy-versioned verification and evidence retention. Existing R20
storage and worker playbooks remain authoritative. Version-specific vendor links
are recorded in the platform and edge READMEs.

The concrete integration request names the existing staging workflow and Compose
overlay. It also identifies applied edge/CSP and secret-rotation evidence still
needed. Repository-wide CI success alone does not run the new R28 tests until the
coordinator integrates that request. No unmerged R25/R26 implementation is consumed.

The first published PR run exposed missing post-G1 R26/R27 harness files and a
CodeQL file-race finding in the R28 reader. The reader correction is scoped here;
the missing harnesses require explicit current-base integration authority under
CLAUDE.md and the wave handoff. CR-001 records the concrete normal-merge request.
The branch remains on its prescribed lineage pending that authorization.

## Source identity convention

The final commit and source-tree identities belong in the PR description and
final-head check records. Embedding a commit's own SHA inside that commit would
make the evidence self-referential. The base identities above are immutable;
the final handoff will state the actual reviewed head separately.
