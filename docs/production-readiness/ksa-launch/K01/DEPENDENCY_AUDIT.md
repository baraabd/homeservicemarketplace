# K01 — Dependency audit remediation

Policy: `scripts/security/dependency-audit.cjs` is unchanged. Success is a
complete, unfiltered registry audit with zero findings at every severity. No
`auditConfig`, ignore list or muted advisory is permitted, and none is used.

## Reproduction (develop `92770ea6`, 2026-11-03)

| Command                    | Exit | Counts                                        |
| -------------------------- | ---- | --------------------------------------------- |
| `pnpm security:audit`      | 1    | info 0, low 1, moderate 7, high 1, critical 0 |
| `pnpm security:audit:prod` | 1    | info 0, low 0, moderate 1, high 1, critical 0 |

Hosted develop CI agreed: `Dependency, secret, and container scans` failed.
That failure cascaded into `R18 functional completion acceptance` and `CI gate`.

## Resolution per advisory

| Advisory (severity)            | Package / installed            | Owner path(s)                                                                        | Patched upstream           | Resolution                                                                                         |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------- |
| GHSA-mrwp-f3q8-3g9p (high)     | follow-redirects 1.16.1        | web › axios                                                                          | 1.16.2                     | Override `follow-redirects@>=1.16.0 <1.16.2` → `1.16.2` (replaces the old `<1.16.1` entry)         |
| GHSA-6pq8-jhm2-2vcw (moderate) | qs 6.16.0                      | api › express; api › supertest › superagent                                          | 6.16.1                     | Override `qs@>=6.0.0 <6.16.1` → `6.16.1` (replaces the old `<6.16.0` entry)                        |
| GHSA-8g5g-mxqh-grgj (moderate) | vite 6.4.4                     | web (exact pin)                                                                      | 6.4.5                      | `apps/web` pin → `6.4.5`                                                                           |
| GHSA-g3hv-75wg-m249 (moderate) | minimatch 10.2.4, 9.0.9, 3.1.5 | eslint, @eslint/config-array, typescript-estree, glob, test-exclude; fork-ts-checker | 11.0.1 only (no backports) | Override `minimatch@>=9.0.0 <11.0.1` → `11.0.4`; minimatch 3 removed with fork-ts-checker (below)  |
| GHSA-3g3m-2fjr-6pw4 (moderate) | glob 13.0.6, 10.5.0            | @nestjs/cli 11; jest-config, @jest/reporters, jest-runtime; test-exclude             | 14.0.2 only                | Override `glob@>=9.0.0 <14.0.2` → `14.0.3`; @nestjs/cli 12 no longer depends on glob               |
| GHSA-gcqx-w48m-w2h4 (low)      | deepmerge 4.3.1                | api › @nestjs/cli 11 › fork-ts-checker; api › jest › jest-config                     | **none**                   | @nestjs/cli 12 removes fork-ts-checker; jest-config uses the owned fork `vendor/deepmerge` (below) |

### Major-version overrides reviewed

minimatch 11 removes `makeRe()`, `Minimatch#regexp`, `matchOne()`, `debug` and
the `AST` class. glob 14 renames `isRegExp`/`testRegExp` and returns arrays
from `walk()`. Every consumer forced onto them was inspected in
`node_modules`:

| Consumer                                          | Calls used                                 |
| ------------------------------------------------- | ------------------------------------------ |
| eslint 10.0.3 (`eslint-helpers.js`)               | `new Minimatch()`, `.match(path, partial)` |
| @eslint/config-array 0.23.3                       | `new Minimatch()`, `.match()`              |
| @typescript-eslint/typescript-estree 8.57         | `minimatch(path, pattern, { dot })`        |
| test-exclude 7.0.2                                | `glob()`, `glob.sync()`, `minimatch()`     |
| jest-config / @jest/reporters / jest-runtime 30.5 | `glob.sync()`                              |

None calls a removed API. Behavior was then exercised end to end: API and web
`eslint` (0 errors), every typecheck, the API Jest suite and the web Vitest
suite all pass (see [README.md](README.md)).

### @nestjs/cli 11 → 12

@nestjs/cli 12 makes webpack, fork-ts-checker and ts-loader optional peers and
drops glob. The lockfile was re-resolved for `apps/api` so that stale
optional-peer snapshots did not keep fork-ts-checker installed. `nest build`
still loads the workspace TypeScript (`require.resolve('typescript', { paths:
[process.cwd(), …] })` → 5.9.3). Its 1,038 emitted files are identical to
`tsc -p tsconfig.build.json`, apart from `.tsbuildinfo`, and `dist/main.js`
is byte-identical. New peer warning: @angular-devkit/core 22 (used only by
`nest generate` schematics) reports `ajv-formats` expecting `ajv@8.18.0` while
8.20.0 is installed. This is a consequence of the existing
`ajv@>=8.0.0 <8.18.0` override. It is a warning only and has no runtime use.

### deepmerge — repository-owned fork

There is no patched deepmerge release (4.3.1 is the latest, from 2023). The
upstream fix is open as TehShrike/deepmerge#286. jest-config 30.5.2 (the
latest Jest) depends on `deepmerge@^4.3.1`, and Jest has no change to drop
it. `pnpm patch` would leave `deepmerge@4.3.1` in the lockfile and the finding
open. A muted advisory is forbidden, and replacing Jest is outside the scope
of this sprint.

`vendor/deepmerge` (version `4.3.1-hsm.1`, private, MIT) is the published
4.3.1 CommonJS build with the one-hunk upstream fix. It is formatted with the
repository Prettier config so commit hooks and R27 controls stay byte-stable;
the README gives a reproducible diff against the published files. Its provenance (upstream
SHA-256 values), tests and exit criterion are in
[`vendor/deepmerge/README.md`](../../../../vendor/deepmerge/README.md). It is
wired in through `"deepmerge@>=4.2.0 <=4.3.1": "file:./vendor/deepmerge"`.

- `vendor/deepmerge/test/prototype-poisoning.test.cjs`: 6 tests. **3 fail
  against upstream 4.3.1** (exposing the defect) and 6/6 pass on the fork.
- `scripts/security/vendored-forks.test.cjs`: proves that jest-config resolves
  the fork at runtime and that no registry deepmerge remains in the lockfile.
- Both run in `pnpm security:audit:test`, which CI already executes.
- The R27 dependency-control protocol counts the fork's four installed files
  as dependency identity (`.github/scripts/r27-dependency-controls.mjs`).
  Fresh dependency-only controls are registered: baseline `8dd452ba` (prior
  runtime `46241888` + the K01 dependency files) and repair `5485c9df` (PR base
  `92770ea6` + the same files). Both install with `--frozen-lockfile`, and the
  real selector passes on the candidate (`EXPLICIT_DEPENDENCY_CONTROL`).

**Review requested:** this is a reviewed dependency change, not an upstream
release. The exploit path requires attacker-controlled objects merged into
Jest configuration, so the residual risk is negligible. The fork still adds
a small maintenance duty until the exit criterion is met.

## Result

| Command                    | Exit | Counts                                        |
| -------------------------- | ---- | --------------------------------------------- |
| `pnpm security:audit`      | 0    | info 0, low 0, moderate 0, high 0, critical 0 |
| `pnpm security:audit:prod` | 0    | info 0, low 0, moderate 0, high 0, critical 0 |
| `pnpm security:audit:test` | 0    | 55 tests, 55 pass                             |

These are dated results, not permanent guarantees. New advisories will turn
the gate red again, and that is the intended behavior. Lockfile integrity
(`Install & lockfile integrity`) and the existing container image scans keep
running in CI.
