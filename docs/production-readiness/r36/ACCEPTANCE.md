# R36 — Current preflight evidence and acceptance boundary

**R36 NOT IMPLEMENTED. NOT SANDBOX_ACCEPTED. NOT HOSTED_ACCEPTED.
NOT RELEASE_ACCEPTED.** This follow-up verifies source findings and prepares
the exact handoff; it is not functional `SOURCE_VERIFIED` recovery tooling.
No backup, restore, cutover or immutable-image rollback has occurred.
Achieved RPO/RTO and unintended money/mail effects are **NOT MEASURED**.

Inspection source: `c9de08d07b12871db8801fb9662b14de83a2c391`.
Inspection tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
The final published documentation commit/tree and remote check identities
belong in the PR metadata. Current sanitized evidence is
[evidence/preflight-2026-10-25.json](evidence/preflight-2026-10-25.json).
Earlier `preflight.json` and the October 24 repair record remain historical.

## Executed local checks

Task-local Node **24.21.0** and pnpm **10.32.1** were installed from their
published archives with checksum/integrity verification. Machine-wide tools
were not changed. The exact command was:

```sh
pnpm install --frozen-lockfile --store-dir /workspace/scratch/eb22d30bac36/r36-pnpm-store --reporter=append-only
```

Result: **exit 0**, unchanged manifests/lockfile, normal preinstall, Husky
preparation and contracts build completed. Existing ignored build-script
warnings for `@parcel/watcher@2.6.0` and `unrs-resolver@1.12.2` remain;
no approval setting, dependency pin or security budget was relaxed.

The following existing, unmodified suites executed together:

```sh
node --test .github/scripts/*.test.mjs \
  infra/production/check-runtime.test.cjs \
  infra/production/staging.test.cjs \
  scripts/production/platform/validate-plan.test.cjs \
  scripts/production/storage/storage-plan.test.cjs \
  scripts/production/storage/storage-cli.test.cjs
```

Result with authorized normal child-process execution: **966 passed, 0 failed,
0 cancelled, 0 skipped, 0 TODO; exit 0**. These are governance, configuration,
storage CLI/policy and launcher fixture tests. They do not run an R36 real
PostgreSQL/Redis/S3/KMS restore or certify a hosted target.

The first restricted-executor attempt failed: its reporter exposed **18
file-level results, 12 passing and 6 failing**, not individual test counts.
A direct governance diagnostic exposed **8 passed / 2 failed** assertions
because child-process stdout/stderr were empty. The unchanged aggregate
command then passed all 966 cases under approved normal process execution.
Both attempts are retained in the evidence; no assertions, tests, timeouts,
workers or repository permissions were changed to obtain the pass.

| Existing command                                                              | Exit | Observed result                                                           |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `node scripts/runtime/toolchain.cjs`                                          | 0    | Exact Node/runtime declarations pass.                                     |
| `node .github/scripts/g2-record.mjs --check`                                  | 0    | Consistent accepted G2 record; does not authenticate remote evidence.     |
| `node .github/scripts/g3-record.mjs --check`                                  | 0    | Consistent BLOCKED G3/Wave 4/G4 join.                                     |
| `node .github/scripts/g3-record.mjs --ready R36`                              | 1    | Actual R36 start refused.                                                 |
| `node scripts/production/platform/validate-plan.cjs --check --require-target` | 2    | CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED; nine blocker categories. |

Negative gate/target exits are unresolved blockers, not passing readiness.
Document formatting, exact seven-file scope and 32 source fingerprints, relative
links, governance and release-baseline validation all passed. The full dependency
audit reports zero findings at every severity; the scoped documentation secret
scan found no leaks. Results and log/report hashes are in the new evidence.
Final-PR CI and official CodeQL must be checked against the published head;
prior PR checks do not validate a new commit. The PR stays Draft while the
required recovery/gate evidence is absent, even if technical CI is green.

## Required R36 behavioral and integration evidence

Every row below is **NOT_RUN**. They are acceptance requirements, not newly
implemented tests or completed work. Use only authorized representative data
and independent resources after G3 publication and exact assignment.

| ID     | Required behavior and evidence                                                                                                                                                                   | Negative/concurrent case and stop condition                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REC-01 | One approved recovery set binds DB snapshot/WAL, migration/trigger lineage, required object versions/deletions, protected key references, immutable images/source and configuration fingerprint. | Reject absent/mismatched lineage, partial manifests and source/target physical overlap.                                                                                                                   |
| REC-02 | Execute a real backup and restore of an approved representative hosted dataset into independently identified DB/user, Redis, storage, queue and network resources.                               | Refuse unapproved/expired target authority and any identity, volume, namespace or cookie-domain collision before mutation.                                                                                |
| REC-03 | Compare exact counts and canonical state digests; verify per-currency balanced posted ledger and immutable account/header/entry/reversal history plus audit.                                     | Attempt invalid mutation through a disposable test transaction; missing guard, unbalanced posting or modified historical rows stops acceptance.                                                           |
| REC-04 | Preserve payment/period/refund/dispatch/inbox/command identities and outbox-handler markers; concurrent replay leaves one authoritative local result.                                            | Same key/different payload conflicts; terminal proof never creates a replacement external operation key or duplicate money effect.                                                                        |
| REC-05 | Preserve G3 approved policy versions, reconciliation windows/runs/observations/cases/decisions, fences/cursors and original evidence/compensation links.                                         | Missing append-only guard, invalid scope, decision conflict or regressed cursor/fence fails verification.                                                                                                 |
| REC-06 | Deep blob hashes with explicit source-version to restored-version mapping and approved deletion/hold state.                                                                                      | Missing historical version despite matching latest object, unexplained extra object, wrong namespace or unavailable storage fails closed.                                                                 |
| REC-07 | Prove decryptability of required objects and queued envelopes using protected version references.                                                                                                | Missing/revoked/wrong KMS key and valid-but-wrong mail key produce redacted diagnostics; no plaintext dump or undecryptable-success fallback.                                                             |
| REC-08 | Before boot, disable Outbox/mail schedulers, deny real payment/refund/SMTP egress, isolate webhook routing and observe isolated sink/network counters.                                           | Exercise direct mail, immediate post-commit delivery and background paths; verify no real recipient/provider destination is reached.                                                                      |
| REC-09 | Terminal jobs remain terminal; controlled pending work reaches only approved isolated sinks with original identities.                                                                            | Include provider/relay acceptance followed by lost DB ACK and post-snapshot effects. Unknown money or ambiguous accepted-mail outcome blocks real replay/cutover.                                         |
| REC-10 | Real Seeker/Provider/Admin login; authorized private preview; wrong-role/owner and unauthenticated denial; restored session/permission correctness.                                              | Reconcile post-snapshot revocations, holds and erased media before access; old backup must not reopen private evidence. Inspect privacy-safe AR/EN/RTL/mobile/keyboard browser evidence where applicable. |
| REC-11 | Rehearse partial deployment, failed migration, unavailable object storage and expired credentials with actual-state inspection and a named incident/repair owner.                                | Retain locks/evidence, stop with egress closed; no autonomous rollback, reset, grant expansion or retry after unknown money outcome.                                                                      |
| REC-12 | Run prior accepted immutable API/web images against the actual forward schema through useful service, including legacy and provenance-backed reconciliation cases.                               | Zero old-migrator invocation; fail on compatibility, provenance, authorization, media or replay regression. Preserve schema and financial history.                                                        |
| REC-13 | Record known committed-write markers around backup/failure and compare restored membership/loss; measure elapsed recovery through agreed useful-service probes.                                  | Never infer zero loss from a healthy DB or latest-row timestamp; never stop RTO at DB startup. Compare actual values to explicitly approved objectives.                                                   |
| REC-14 | Prepare a cutover plan binding exact restored sourceSha, images, resources, incident owner, external-outcome/deletion reconciliation and independent owner approval.                             | Actual production cutover remains a separate authorized action; a successful isolated drill is not permission to disrupt production.                                                                      |

Required timeline: approval/isolation verified; known write markers committed;
backup consistency point recorded; simulated loss/recovery start; DB and
object/key validation completed; safe replay observed; cross-role/private
service usable; operator decision. Keep timestamps and monotonic durations,
backup/restore IDs and sanitized evidence hashes. Actual resource identities
and secret references belong in restricted operator evidence, not public
source artifacts. Public records carry approved fingerprints/references only.

## Unrun scope and exit status

No R36 implementation/unit tests, real-service backup/restore, missing-version
or lost-key drill, restored-browser journey, image rollback or hosted timing
was executed. UI, application typecheck/lint/build and full application suites
were not run locally for this documentation-only diff; the install's contracts
prepare build is not substituted for them. No new screenshot is claimed.

G3 acceptance/publication, approved objectives/policies, protected credentials,
independent target/images and actual recovery evidence remain required.
The current result is **verified documentation preflight with blocked R36
execution**, not a completed recovery sprint.
