# R36 — Preflight evidence and acceptance boundary

**NOT IMPLEMENTED. NOT SANDBOX_ACCEPTED. NOT HOSTED_ACCEPTED. NOT RELEASE_ACCEPTED.**
Source inspection is complete for this preflight; it is not R36 functional
`SOURCE_VERIFIED`. No restore, data-loss measurement, cutover or image rollback
has taken place. Achieved RPO/RTO and unintended outbound-effect counts are
**NOT MEASURED**, never zero by assumption.

The inspection source is `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`, tree
`54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`. Run metadata and final document
commit/tree belong to the PR; sanitized preflight evidence is in
[evidence/preflight.json](evidence/preflight.json).

## Executed checks

The following existing, unmodified suites ran using task-local Node 24.21.0:

```sh
node --test .github/scripts/g3-record.test.mjs \
  .github/scripts/r27-acceptance.test.mjs \
  .github/scripts/r27-workflow.test.mjs \
  scripts/production/platform/validate-plan.test.cjs \
  scripts/production/storage/storage-plan.test.cjs \
  scripts/production/storage/storage-cli.test.cjs \
  infra/production/staging.test.cjs
```

Result: **509 passed, 0 failed, 0 cancelled, 0 skipped, 0 TODO; exit 0**.
These are existing isolated validator/launcher tests using controlled fixtures;
they are not a real PostgreSQL/Redis/S3/KMS recovery exercise. No tests were
removed, skipped, weakened or newly manufactured to mirror these documents.

The complete existing governance command, `node --test
.github/scripts/*.test.mjs`, also passed **480/480**, with zero failures,
cancelled, skipped or TODO tests. It overlaps the first command; the counts
must not be added together as unique tests.

Pinned `pnpm install --frozen-lockfile --offline --store-dir
/workspace/scratch/d86d02f90f5c/pnpm-store --reporter=append-only` completed
with exit 0 and unchanged package/lockfile bytes. The first online download
was interrupted (exit 130); a task-local copy of the existing immutable
package download cache then supplied the successful offline install. Project
node_modules and generated output are independent. The normal preinstall,
Husky preparation and contracts build ran. Existing ignored build-script
warnings for `@parcel/watcher@2.6.0` and `unrs-resolver@1.12.2` were retained;
no build approvals or dependency pins were changed.

| Command                                                                       | Exit | Observed result                                                           |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `node .github/scripts/g2-record.mjs --check`                                  | 0    | G2 record consistent; remote authenticity is not asserted by this command |
| `node .github/scripts/g3-record.mjs --check`                                  | 0    | Consistent BLOCKED record; Wave 4 and G4 remain BLOCKED                   |
| `node .github/scripts/g3-record.mjs --ready R36`                              | 1    | R36 is not authorized to start                                            |
| `node .github/scripts/g3-record.mjs --ready R34`                              | 1    | R34 is not authorized to start                                            |
| `node scripts/production/platform/validate-plan.cjs --check --require-target` | 2    | CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED; nine blocker categories  |

The negative exits above are retained findings, not a passing start/hosting
gate. Toolchain, frozen installation, document formatting, diff/ownership
checks and fingerprints are recorded in the machine-readable preflight and
the final PR description after execution.

## Remote PR evidence

PR #188 was initially inspected at
`88c4fb7186d6d64ed07b518d5fcc54de41fbce2d`. R27 run `40016123413`, job
`120628504400` stopped at the repair-baseline lockfile comparison, exit 1.
The missing artifact was a consequence. That head's later cancelled/failed
jobs are not acceptance evidence.

A concurrent correction produced
`482a368b6417215354a325b66d372bb25d4f68e1`, deferring Zod 4 and restoring
the original dependency blobs. This session inspected that change but did not
author it. Its new CI must be evaluated on that exact head; earlier successes
do not establish green. This R36 documentation PR has its own independent CI
and remains Draft while the start gate and functional evidence are missing.

## Required but not executed

Real representative backup/restore, ledger/count/dedupe verification, missing
historical object version, lost-key diagnostic, restored cross-role login and
private preview, safe pending-job replay with measured outbound counts,
old/new schema/image compatibility, partial deployment, failed migration,
unavailable object storage, expired credentials and recovery-through-useful-
service timing: **NOT RUN**. No approved hosted restore target or accepted
Wave 4 execution base exists in the inspected source.

Application lint/typecheck/unit/build, full PostgreSQL/Redis/ClamAV/storage,
AR/EN/RTL/mobile/keyboard/browser screenshots, dependency/secret/container
scans and official final-head CodeQL must be distinguished from the local
document checks. No local application/security/browser execution or inspected
screenshots are claimed here. Final-head remote checks are reported in the PR
without treating them as R36 restore acceptance.
