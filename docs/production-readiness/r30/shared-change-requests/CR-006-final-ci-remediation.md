# CR-006 — final CI container and permission-catalog correction

Status: **IMPLEMENTED / LOCAL CHECKS PASS / FINAL-HEAD IMAGE CI PENDING**. The owner-delegated
coordinator recorded `R30-SHARED-20261023-FINAL-CI` in `RUNTIME_OWNERSHIP.json`
and both canonical R30 shared leases before the changes. No peer lane is edited.

## Exact shared paths and minimal patches

| Path                                                                   | Change                                                                                                                           | Reason                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/Dockerfile`                                                  | Require `musl>=1.2.6-r3` and `musl-utils>=1.2.6-r3` in the existing builder, migrator and runner package installations.          | Alpine's security database identifies this revision as the fix for CVE-2026-107891; an unavailable fixed revision must fail the build.                                 |
| `apps/api/test/integration/r19-subscription-money.integration.spec.ts` | Add `money:receipt:settlement` and `money:receipt:view` to the exact seeded catalog expectation and clarify its R24/R30 comment. | R30 intentionally defines these capabilities without granting them. The old expectation omitted them. All zero-grant and financial-history assertions remain required. |

## Observed evidence

Published source `0da484547bf1f3f31698352ea7fd021a8b6cb459`, CI run
`39943342577`, integration job `120383964786`: 6,652 tests passed, one failed,
98 skipped. The sole failure is the exact R19 catalog mismatch above, not a
permission grant. The dedicated R30 real-service/browser job passed separately.

Security job `120383964892` reported success under the existing HIGH/CRITICAL
policy, while warning that details for CVE-2026-107891 were unavailable. Its
verified SBOM artifact `12496784608` contains `musl` and `musl-utils` at
`1.2.6-r2` on Alpine 3.24.2. Artifact ZIP SHA256:
`f8268e46ffe373a1cbf58c3eec957c9b5d105eeceb63da092a7b346520f15d6b`.
The scanned image manifest was
`sha256:aaf1961b341a4d1845ba45066b7da5d4465b5c2518657acb9585c2f00e6b80dd`;
the Node base was
`node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`.

Primary sources checked on 2026-10-23:

- [musl's October 21 advisory](https://www.openwall.com/lists/musl/2026/10/21/1)
  describes integer overflows when an application passes untrusted regular
  expressions to libc `regcomp`; an exploitable application path was not established.
- [Alpine v3.24 security database](https://secdb.alpinelinux.org/v3.24/main.json)
  identifies `musl` revision `1.2.6-r3` as fixed for this CVE.
- [Official Alpine x86_64 package index](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz)
  offered both fixed packages at 11:27:43 UTC, port commit
  `8f79d39391b46d6dbf1800fb68b8212a21d5ee2e`.

The scanner's generic wording that a CVE "may be rejected" is not evidence
that this advisory was withdrawn. Package inventory and the vendor fix mapping
establish the affected revision independently of the incomplete scanner result.

## Validation and consequences

Run the complete R19 real-PostgreSQL suite using the task's isolated services,
scoped formatting/lint, toolchain guards and unchanged governance checks.
The local environment has no Docker runtime; actual image rebuild, cold boot,
container boundaries and rescan therefore require the successor's existing CI
jobs. Independently inspect its generated SBOM to confirm both installed musl
packages meet the fixed floor, even if scanner metadata remains incomplete.
Final source identity and results are recorded in PR184 after normal hooks.

Local execution passed the complete R19 suite: 19 tests, one suite, zero
failures/skips. The disposable database applied all 73 migrations and the
standard seed, contained eight money capabilities with zero role grants, and
was disposed after the run. The exact changed-file lint reported zero errors
and warnings. Unchanged governance checks passed 480/480, and existing
staging/runtime/platform checks passed 448/448, all with zero skips. Safe
report digests are retained in `SOURCE_MANIFEST.json`. These counts do not
claim a local container build or substitute for successor CI.

No JavaScript dependency or lockfile change, schema migration, capability grant,
Node/pnpm change, scanner upgrade, severity suppression, timeout increase or
test skip is introduced. Existing non-root users, production-only bundle and
migration separation remain intact. The corrected catalog remains exact;
unknown additional capabilities still fail the test. Roll back through a
reviewed successor image, preserving the security fix and immutable financial
history; do not redeploy the known affected image to clear an unrelated issue.
