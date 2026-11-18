# Picomatch security repair — 2026-11-18

## Trigger and scope

PR #230 synchronizes `main` back into `develop` without a source-tree change.
Its current CI inherited GHSA-fc5q-39xc-vjpf (CVE-2026-112366) in three
picomatch resolutions: 2.3.2, 4.0.4 and 4.0.7. The full dependency audit
reported three high findings; the production-only audit reported zero.

The npm registry still lists 4.0.7 as latest and no patched release was
available when checked. The fix replaces the affected 2.x and 4.x dependency
families with separately versioned, repository-owned forks. See their READMEs
for source provenance, exact behavior changes, license and removal criteria.
The security audit script and its zero-finding policy remain unchanged.

## R27 comparison integrity

The source changes are tooling dependency changes. They require a new pair of
immutable dependency-only controls so a performance comparison cannot mix
an old dependency graph with the repaired candidate. The new baseline is a
child of the previous control `a2cd2b5e3a79eb608721bd632ebc8b3f31809281`.
The repair control is a child of the PR base
`d64d463666e94a68b007ba96d724998e7e928fdc`.

Both controls contain the exact candidate manifest, lockfile, existing
deepmerge fork and installed files from both picomatch forks. The inventory
in `.github/scripts/r27-dependency-controls.mjs` validates all corresponding
blobs and prohibits runtime changes in the control commits. The registered
SHAs, tree identities and digests are in `r27-dependency-controls.json`.
Both controls remain reachable through the candidate's ancestry. A backmerge
base with a different commit ID is accepted only when its complete Git tree
exactly matches the registered original base; ancestry and all dependency
identity checks still apply. This covers `main`/`develop` synchronization
without accepting unknown source changes.

No historical R27 measurement is relabelled as new evidence. All three
measurement jobs must run against the new candidate and controls.

## Executed checks

- PASS: pinned Node 24.21.0 / pnpm 10.32.1 frozen installation.
- PASS: 58 security audit, exploit, installed-consumer and fork tests.
- PASS: full and production dependency audits, zero findings at all severities.
- PASS: 26 R27 control and workflow tests, including same-tree backmerges;
  the complete governance suite passes all 631 tests.
- PASS: ESLint and Prettier for the changed security and vendor source.
- PASS: web unit tests, 243 files / 3,133 tests, and production web build.
- PASS: API default unit run, 321 suites / 5,761 tests. Its existing 107
  real-service-gated suites (1,962 tests) are not enabled in this local unit
  run; this is not real-service acceptance. The API production build passes.

The official picomatch 4.0.7 test suite was also executed from upstream commit
`6bb40679c218cefba5d4e9662408c5fdf699a8bb` using Node's BDD test API: the
unmodified source passes all 1,983 tests. With the guard it passes 1,979;
four assertions differ because they expect unsafe repeated wildcard extglobs
to match. The affected patterns are `*(a*|b)`, `+(*)c` (two assertions), and
`*/*(W*, *)*`. These are intentional fail-closed compatibility changes,
not skipped or weakened tests. Project glob/build consumers are checked
separately. The exploit regression also times out against the official
unfixed 4.0.7 tarball and completes against both patched forks.

## Rollback and limits

Revert the security dependency update and its R27 record/workflow together.
Doing so reintroduces the current advisory and the full audit will fail.
There is no database migration or application feature activation.

These local checks do not establish real hosted OTP delivery, browser
acceptance or production readiness. The normal final-SHA CI, CodeQL,
real-service and deployment gates still apply.
