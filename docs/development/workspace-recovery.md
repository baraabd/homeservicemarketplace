# Recover native API development after a checkout update

A failure in `predev` / `scripts/dev/preflight.cjs` happens **before** Nest
starts. The browser cannot connect to an API that never started. Installed
Prisma/Sharp version mismatches and an outdated generated Prisma Client are
local workspace-state problems, not evidence of a PostgreSQL connection failure.

## Normal startup after pulling a schema change

`pnpm dev`, `pnpm --filter @homeservicemarketplace/api dev` and API `dev:fast`
now prepare derived Prisma artifacts before their existing preflight. When the
installed dependency pins are correct but generated artifacts are stale,
missing or incomplete, preparation runs the existing guarded generator, checks
freshness, typechecks the API, then checks freshness again before startup can
continue. A current workspace is a no-op. To run just that stage:

```sh
pnpm dev:prepare
```

Preparation uses the pinned pnpm that invoked the package script, never a
shell-resolved replacement. It stops if the API port is already in use, the
generator cannot safely replace its engine, a source/output path is redirected,
dependency pins disagree, or generation/typechecking fails. It does not install
dependencies, change the lockfile or environment files, run migrations, kill
processes, or contact the database. Missing or mismatched dependencies still
require the explicit `dev:repair` procedure below.

`pnpm dev:doctor` and direct `scripts/dev/preflight.cjs` invocations remain
read-only for dependency and Prisma diagnostics. They do not automatically
regenerate the client. The separate PowerShell launcher described below keeps
its read-only preflight; run `pnpm dev:prepare` before it when necessary.

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
remove uploads, kill processes or start the API. Normal `dev` prepares only
derived Prisma artifacts as described above; `dev:doctor` remains read-only.
Neither installs packages to bypass a failed dependency check.
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

## Login says that sign-in options could not be loaded

The login and registration gates request `GET /v1/auth/config` before showing
credentials. If API predev failed, Nest never started and this request cannot
succeed. A wrong API origin, CORS rejection, timeout, HTTP error or malformed
response can produce the same screen; the screenshot alone does not identify
which one occurred. An unavailable WhatsApp provider by itself is not a failed
configuration request: the API returns `whatsappAvailable: false` with a valid
policy, and the interface handles that availability separately.

After the API starts, verify both endpoints (replace `4000` with its actual
port):

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/health/ready"
Invoke-RestMethod -Uri "http://localhost:4000/v1/auth/config"
```

The configuration response must have `otpChannel` (`whatsapp` or `email`) and
boolean `whatsappAvailable`. An existing admin email choice remains valid;
development preparation does not overwrite it. A missing channel setting uses
the backend's WhatsApp default. A readiness failure or missing database schema
needs its own correction; generating the client does not apply migrations.

Start the frontend in a second terminal:

```powershell
pnpm --filter @homeservicemarketplace/web dev
```

For local development, an unset or blank `VITE_API_URL` follows the API's `PORT`
(default `4000`). The shared resolver uses the same precedence as Nest:
process `PORT`, then `apps/api/.env.local`, `apps/api/.env`, root `.env.local`,
root `.env`. Only the resulting public `http://localhost:<port>` origin enters
the browser; backend credentials are never copied into browser configuration.
Root `pnpm dev` also forwards the process `PORT` through Turbo to both tasks.

An explicit `VITE_API_URL` in the web environment always takes precedence.
Check existing `apps/web/.env` / `.env.local` and process variables if it still
points at an old port; either correct it or leave it blank to use the local API
port. Restart Vite after changing this configuration. The value must be an
absolute HTTP(S) origin, for example `http://localhost:4010`, without `/v1`,
credentials, a query or a fragment. Invalid explicit values now stop Vite with
an actionable configuration error instead of failing later at the login gate.
Production builds still require an explicit `VITE_API_URL`; preview and tests
never infer it from private API files.

In the browser Network panel, the `/v1/auth/config` request must target that
origin and return JSON with HTTP 200. For a cross-origin frontend such as
`http://localhost:5173`, the backend's configured `FRONTEND_URL` / `CORS_ORIGINS`
must allow the exact frontend origin, including its port. A successful
PowerShell request alone does not prove browser CORS. The gate's retry button
fetches fresh server policy; it never substitutes an old cached setting or
pretends the service is available.

## Regression coverage

```sh
node --test scripts/dev/repair.test.cjs scripts/dev/prepare-workspace.test.cjs scripts/dev/workspace-state.test.cjs scripts/dev/api-endpoint.test.cjs scripts/dev/preflight.test.cjs
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
It also makes only the ignored generated schema stale, then runs real
`pnpm dev:prepare` and a second no-op preparation. API-origin tests cover file
precedence, explicit overrides, malformed origins, production build guards and
private-env isolation. Browser startup regressions use the real Vite
configuration and a labeled HTTP policy fixture; real backend and provider
acceptance remain separate evidence.

## Reference behavior

- [pnpm 10 installation options](https://pnpm.io/10.x/cli/install)
- [Prisma Client generation](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client)
- [Sharp installation and optional dependencies](https://sharp.pixelplumbing.com/install/)

## Windows: `EPERM ... rename query_engine-windows.dll.node.tmp<N>`

### What it means

`prisma generate` writes the JavaScript client (`index.js`, `index.d.ts`,
`schema.prisma`, `package.json`) first. It then copies the query engine to
`query_engine-windows.dll.node.tmp<N>` and renames that over the engine.
Windows refuses the rename while any process has the engine **loaded**, so
generation fails after the JavaScript client was already rewritten. The
number in the temporary name is not the PID of the holder.

Reproduced on the affected machine (2026-10-13):

- The API dev server's `node --enable-source-maps apps\api\dist\main` child
  had `packages\database\generated\prisma\query_engine-windows.dll.node`
  loaded while generation ran.
- With a loaded engine, opening it for write fails with `EBUSY`, and renaming
  over it fails with `EPERM`.
- Once the holder exits, the same rename succeeds.

A permission problem looks different: `EACCES` or `EPERM` on the open itself.
A security scanner can also hold the file briefly.

Before this fix, dev preflight only checked those four JavaScript files and
their versions. It therefore passed with an engine older than the client.

### What the tooling does now

The `generate` script (`packages/database/scripts/generate-client.cjs`) is
the only generation path: automatic dev preparation, `dev:repair`, CI and the
API image all use it.
Each run:

1. Takes a per-checkout lock. A concurrent run waits up to 2 minutes, then
   stops; a lock left by a process that no longer exists is reclaimed.
2. Removes the previous completion record before anything is written.
3. Refuses before generating if the engine is loaded, and names the
   processes that have it loaded (a read-only module listing).
4. Runs the pinned Prisma CLI without a shell and propagates its exit code.
   It refuses to run Prisma when `@prisma/client` is not installed for the
   schema, because Prisma would otherwise npm-install packages into a
   directory it chooses.
5. Checks the native engine. It must be byte-identical to the installed
   `@prisma/engines` copy, and it must load in a separate short-lived process
   and report the commit the client expects. That process exits first.
6. Only then writes `generated/prisma/.hsm-generation.json`, which records
   the schema, versions, platform, architecture and engine hashes.

Dev preflight and `dev:doctor` stay read-only. They require that record to
match the schema, the installed version, this platform and the engine bytes
on disk, so a failed or interrupted generation is never accepted.

### Release a loaded engine and recover

Read-only: list the processes that have this checkout's engine loaded.

```powershell
$engine = (Resolve-Path 'packages\database\generated\prisma\query_engine-windows.dll.node').Path
Get-Process | ForEach-Object { $p = $_; try { if ($p.Modules.FileName -contains $engine) { '{0} {1}' -f $p.Id, $p.ProcessName } } catch {} }
```

1. Stop each of them where it runs: Ctrl+C in the API dev terminal, close
   Prisma Studio, and finish or stop test runs that use this checkout.
2. Do not end every `node.exe`, close handles by force, turn off security
   software or run the project as administrator.
3. A process that appears in no listing is not proof that nothing holds the
   file, for example an elevated process or a scanner. Wait and retry.

Then generate and start, stopping at the first failure:

```powershell
pnpm --filter @homeservicemarketplace/database generate
if ($LASTEXITCODE -ne 0) { return }
powershell -ExecutionPolicy Bypass -File scripts\dev\start-api.ps1
```

## Start the API with one command (PowerShell 5.1 and 7)

`scripts/dev/start-api.ps1` runs these stages and stops at the first
non-zero exit code. It checks `$LASTEXITCODE` itself, because
`$ErrorActionPreference` does not see native exit codes.

1. The read-only preflight: runtime, port and a complete generated client.
2. The database build.
3. The contracts build.
4. The API typecheck (`-SkipTypecheck` to omit it).
5. `scripts/dev/run-api.cjs`, which starts Nest watch mode.

`run-api.cjs` reports two separate milestones, each printed only when true:

- `MILESTONE listening`: the port accepts connections.
- `MILESTONE ready`: `GET /health/ready` returned 200, with its
  dependencies listed.

Neither milestone means the browser journeys work; those are a separate
test.
