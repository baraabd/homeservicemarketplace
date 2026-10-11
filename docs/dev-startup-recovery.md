# Recover native development startup after a source update

Mode: integration and bug fix. The commands below apply to a local checkout
using the repository's pinned Node 24.21.0 and pnpm 10.32.1. The web application
contains the Seeker, Provider and Admin experiences; all three depend on the
same API.

## Recognize the failure

After a branch or schema update, errors such as missing `LedgerAccount`,
`BookingReview`, `SupportTicket`, `Message.idempotencyKey` or
`MediaAsset.purpose` can mean that `packages/database/generated/prisma` still
describes an earlier schema. These generated files are intentionally ignored
by Git. The API's `build:deps` compiles database and contract packages; it does
not regenerate Prisma automatically.

`Cannot find module 'sharp'` can mean that the installed dependencies are older
than the current manifest and lockfile. The API already declares an exact
`sharp` dependency. Use the frozen install instead of introducing a different
version or removing image validation.

These are compiler or installation failures. They do not by themselves prove
that PostgreSQL is unavailable or that stored data is damaged. Generation and
database migration are separate operations.

## Diagnose without changing files

Stop the affected API watcher with Ctrl+C in its own terminal before installing
or regenerating its dependencies. Identify the current branch and retain any
local changes; do not force a checkout to perform this recovery. From the
repository root, using your existing Node version manager:

```powershell
git status --short --branch
node --version
pnpm --version
pnpm runtime:check
pnpm dev:doctor
```

`dev:doctor` checks workspace dependency metadata, generated Prisma freshness,
ports and generated API output state without repairing the cache. Normal
`dev` and API `dev` also report stale Prisma or missing dependencies before the
watcher starts or the incremental cache is repaired.

The workspace-only diagnostic can also run before installation or while a
server owns the development port:

```powershell
node scripts/dev/workspace-state.cjs
```

The check compares the source schema fingerprint with the generated schema,
accepts Prisma's field alignment formatting and Windows CRLF versus LF line
endings while retaining quoted values, checks generated entry files and client
version, and resolves dependency metadata from the consuming package.
It does not load the native image decoder, evaluate generated Prisma code,
install dependencies, modify environment files, connect to a database, or
apply migrations. A passing diagnostic does not certify native bindings,
database migration state, API readiness or browser workflows.

## Repair dependencies and generated code

Run each command from the repository root. If a command fails, resolve that
failure before proceeding; do not run the final startup command regardless of
earlier errors. This applies especially to Windows PowerShell, where separate
native-command lines do not necessarily stop after a nonzero exit code.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/database prisma:validate
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/api typecheck
```

The API `typecheck` command first runs `build:deps`, rebuilding the database
and contracts packages against the fresh generated client. Prisma generation
does not migrate the database. Existing environment files must be preserved;
generation uses the database package's existing environment configuration.

If you specifically need to verify that the installed image decoder can load
on this machine, run the explicit diagnostic below. This native load is kept
out of the ordinary preflight because portfolio validation intentionally loads
the decoder on demand.

```powershell
pnpm --filter @homeservicemarketplace/api exec node -e "require('sharp'); console.log('sharp runtime OK')"
```

## Check the intended development database separately

Confirm that `DATABASE_URL` targets the intended disposable test database or
the local development database you are authorized to update. Preserve its
existing data and recovery backup where needed. The database package's scripts
load root `.env`, while native API startup gives these files precedence:

1. `apps/api/.env.local`
2. `apps/api/.env`
3. Root `.env.local`
4. Root `.env`

Process environment variables take precedence over files. Resolve any target
mismatch privately before running migration commands; do not print connection
strings or credentials in logs or support messages. This recovery procedure is
not a staging or production deployment procedure.

If the normal local data services are not running, use the documented
data-plane-only command:

```powershell
pnpm docker:up
```

After confirming the intended migration target:

```powershell
pnpm --filter @homeservicemarketplace/database exec dotenv -e ../../.env -- prisma migrate status
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database exec dotenv -e ../../.env -- prisma migrate status
```

Pending migrations explain an initial nonzero migration-status result and can
be applied with `migrate:deploy`. A connection failure, failed migration or
diverged history needs its own investigation; do not assume that every nonzero
status means only pending migrations.

Keep migrations as a separate controlled operation. Do not add them to every
API replica's startup. Do not use `migrate reset`, `db push`, volume deletion or
the disposable CI Compose smoke script to repair a persistent local stack.

## Start and verify

Do not start the Docker API and native API on the same port. Inspect any
existing port owner before stopping it. Start the normal development processes:

```powershell
pnpm dev:doctor
pnpm dev
```

In another terminal, check the actual running API:

```powershell
Invoke-RestMethod http://localhost:4000/health/live
Invoke-RestMethod http://localhost:4000/health/ready
```

Use the configured API port if it differs. Readiness checks PostgreSQL and
Redis availability, plus Mongo only when enabled. Readiness does not prove
that every business table or role journey works. Open the real web application
at its reported URL and verify authentication and representative Seeker,
Provider and Admin operations against the same API. Browser performance must
be measured independently on a production build as well as in development.

Once the dependency metadata and schema are current, the preflight only reads
their small metadata/schema files; it does not repeat installation, generation
or migrations on every startup. No cache-wide deletion or blanket process
termination is part of this recovery.
