# PLATFORM-TX-1 dependency gate remediation

Mode A (Integration and Bug-Fix). Applies to PR #144, based on
`53e8f2cf339714f01eabed3a55a3fce2e313d807`; CI run #402.

## Findings and correction

| Advisory                                           | Affected path                                                | Correction                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| GHSA-jqcg-44mw-7w3h (critical)                     | Express → proxy-addr 2.0.7                                   | Pin affected versions to 2.0.8                                                   |
| GHSA-jggr-w7fw-pc2j (moderate)                     | pino-pretty → fast-copy 4.0.2                                | Pin affected 4.x versions to 4.1.0                                               |
| GHSA-68fv-2mgg-jv7q (high)                         | Tailwind/PostCSS → source-map-js 1.2.1                       | Pin affected versions to 1.2.2                                                   |
| GHSA-hp3w-g68c-fv3c (moderate; no patched release) | Jest → load-nyc-config → js-yaml 3 → argparse 1 → sprintf-js | Scope js-yaml 4.3.2 to load-nyc-config 1.1.0, removing argparse 1 and sprintf-js |

The production audit had two findings, while the full audit artifact had four.
The failed CI gate correctly propagates the security job's failure; no workflow
or audit-policy relaxation is needed. These overrides repair the installed tree,
not the report. Existing audit exclusions remain prohibited.

The NYC loader uses `js-yaml.load`, which is available in 4.x. Its YAML-config
loading was exercised with the replacement. This is a scoped major override in
test tooling: hosted Jest suites must still pass before merge. No application
code, Prisma version, schema, migration, route, or feature flag changes.

## Local validation

- pnpm 10.32.1; local Node 24.19.0 differs from the required 24.21.0. Hosted CI
  must validate the pinned toolchain.
- `node --test scripts/security/dependency-audit.test.cjs`: 39 passed, zero failed
  or skipped.
- `corepack pnpm install --lockfile-only --frozen-lockfile --ignore-scripts --offline`:
  passed. This validates lockfile configuration; it is not a full installation.
- `corepack pnpm install --lockfile-only --ignore-scripts --offline`: passed.
- `corepack pnpm security:audit`: zero findings at every severity.
- `corepack pnpm security:audit:prod`: zero findings at every severity.
- Prettier 3.8.1 check of package.json, pnpm-lock.yaml and this document: passed.
- Isolated installed-package smoke checks: mapped-IPv6 trust boundaries;
  fast-copy ordinary copy and explicit depth-limit error; source-map round trip;
  NYC YAML loading with js-yaml 4.3.2: all passed.
- `git diff --check`: passed.

The lockfile edit is bounded to these paths, using registry-provided integrity
hashes. No unrelated dependency refresh. Full repository installation, builds,
application tests, browser tests and image scans were not run locally; the draft
PR's new head must obtain fresh hosted evidence. Earlier green jobs do not
validate this dependency change.

## Rollout and rollback

Normal frozen installation applies the corrected tree; no data changes.
Revert this remediation commit to roll back (reintroduces the four findings).
Keep PR #144 draft until all required checks pass on its final head. Do not merge
as part of this task.

## Revalidation on the pinned toolchain (2026-10-06)

Separate from the validation above, which ran on Node 24.19.0 with an offline,
lockfile-only install. Taken on `9cb2354` with Node 24.21.0 and pnpm 10.32.1:

- full `pnpm install --frozen-lockfile` (online, lifecycle scripts enabled);
- `security:audit:test` 39/39; `security:audit` and `security:audit:prod`
  0 findings at every severity at 14:14 UTC;
- each consumer resolves the corrected version: express → proxy-addr 2.0.8,
  pino-pretty → fast-copy 4.1.0, @tailwindcss/node → source-map-js 1.2.2,
  load-nyc-config 1.1.0 → js-yaml 4.3.2 → argparse 2.0.1; the lockfile has no
  reference to the replaced versions;
- 21/21 behavioural probes on the installed packages: Express `trust proxy` at
  0, 1 and 2 hops (the API's `TRUST_PROXY_HOPS` mode) with an IPv4-mapped IPv6
  hop; proxy-addr subnet trust for mapped addresses; `load-nyc-config` with
  `.nycrc.yml`, `.nycrc.yaml`, JSON, `package.json` and invalid YAML (rejected
  with `YAMLException`); pino-pretty and fast-copy on nested and circular
  values; source-map-js round trip and unsupported-version rejection;
- API and web rebuilt on the new tree; the PLATFORM-TX-1 browser spec passed.

The repository has no nyc configuration file and CI does not collect coverage,
so the js-yaml 4 path is exercised only by these probes, not by CI. Hosted CI
run 37473362334 (#403, attempt 1) passed every job on `9cb2354`.
