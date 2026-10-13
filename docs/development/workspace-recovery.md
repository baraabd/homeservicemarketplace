# Recover native API development after a checkout update

A failure in `predev` / `scripts/dev/preflight.cjs` happens **before** Nest
starts. The browser cannot connect to an API that never started. Installed
Prisma/Sharp version mismatches and an outdated generated Prisma Client are
local workspace-state problems, not evidence of a PostgreSQL connection failure.

## Recovery on Windows, macOS and Linux

Stop this repository's API and web watchers in their terminals first. On
Windows, running Node processes can keep generated Prisma engine files locked.
Do not kill unrelated Node processes.

Select the exact Node and pnpm versions declared by `.nvmrc` and `package.json`.
From the repository root, run:

```sh
pnpm dev:repair
```

The command performs these steps in order, stopping on the first failure:

1. `pnpm install --frozen-lockfile --prod=false`
2. `pnpm --filter @homeservicemarketplace/database generate`
3. `pnpm exec node scripts/dev/workspace-state.cjs`
4. `pnpm --filter @homeservicemarketplace/api typecheck`

It reuses the invoking pinned pnpm launcher, including paths containing spaces
on Windows, without constructing a shell command. It checks that the lockfile
has not changed after each successful step. Dependency and schema verification
runs in a fresh process so previous package-resolution caches cannot mask drift.
The command requires a checked-in lockfile and the declared runtime. It does
not silently upgrade dependencies or repair a manifest/lockfile disagreement.

This is an explicit, development-only operation. It installs dependencies,
regenerates Prisma code and builds the API's workspace dependencies. It does not
run migrations, reset a database, remove Docker volumes, rewrite `.env` files,
remove uploads, kill processes or start the API. Normal `dev` and `dev:doctor`
keep their existing checks; neither installs packages to bypass a failed check.
Package-manager lifecycle output remains local: do not publish raw logs that
might contain private configuration or registry credentials.

## When the first attempt fails

If installation succeeds but the same dependency mismatch remains, stop the
watchers and explicitly request a frozen reinstallation:

```sh
pnpm dev:repair --force
```

`--force` is never added automatically and does not remove `--frozen-lockfile`.
It can refetch packages and install additional optional packages. Keep optional
dependencies enabled for Sharp's platform-specific binaries. Do not delete the
lockfile, use `pnpm update`, run `prisma migrate reset`, or disable preflight as
an attempted repair.

If installation reports `ENOTFOUND`, resolve network/DNS/registry access before
retrying. A successful earlier install does not prove the current install
finished. For `EPERM`/`EBUSY` on Windows, stop the related watcher and retry; do
not start the API after a failed recovery step. For a typecheck failure, correct
the reported source error; repeated installation is not a substitute for that.

After successful recovery, start only the required local data services, then
the API. Do not run a Docker API and a native API on the same port.

```powershell
pnpm dev:repair
if ($LASTEXITCODE -ne 0) { throw "Workspace recovery failed. Do not start the API." }

pnpm docker:up
if ($LASTEXITCODE -ne 0) { throw "Local data services did not start." }

pnpm --filter @homeservicemarketplace/api dev
```

Keep existing environment files. Database provisioning and any required schema
migrations remain separate, intentional operations; recovery does not perform
them. After the API reports that it is listening, use a second terminal:

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/health/ready"
```

Use the configured port when it is not `4000`. Recovery success only certifies
the dependency metadata, generated schema and API typecheck. Native-module
loading, database readiness and browser flows still require their own checks.
A separate CI workflow exercises real Sharp encoding on Windows and Linux.

## Regression coverage

```sh
node --test scripts/dev/repair.test.cjs scripts/dev/workspace-state.test.cjs
```

The recovery tests use a fake package-manager process to reproduce the four
reported failures without network or database access. They exercise the real
recovery CLI and workspace-state verifier, including exit-code propagation,
lockfile preservation, missing outputs, Windows launcher arguments, runtime
rejection, controlled diagnostics and preservation of private fixture files.
These fixture tests do not claim that a real package installation or API boot
has completed. `.github/workflows/dev-workspace-recovery.yml` separately runs
frozen installation, generation, API typechecking and native Sharp encoding
against actual dependencies on hosted Windows and Linux runners.

## Reference behavior

- [pnpm 10 installation options](https://pnpm.io/10.x/cli/install)
- [Prisma Client generation](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client)
- [Sharp installation and optional dependencies](https://sharp.pixelplumbing.com/install/)
