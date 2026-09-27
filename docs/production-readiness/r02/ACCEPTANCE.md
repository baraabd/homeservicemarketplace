# R02 — exact Node runtime and non-destructive clean startup

Status: implementation candidate; final-head Node 24 acceptance and the R01
protection dependency remain **BLOCKED**. No merge, deployment, dependency
refresh, migration, stored-media change or production flag activation occurred.
Mode: integration and bug fix.

## Audited baseline and runtime decision

Application base: `cc2cd399052ceac053990a9175daa524ea350d6e`.
R01 is submitted separately in PR #115. This branch starts at the same base
and does not silently include, merge or certify R01. The integration owner is
`@baraabd`; R01's workflow additions must survive the R02 Node-pin handoff.

Candidate runtime: **Node 24.21.0 LTS**, published September 8, 2026. Sources:
[official release](https://nodejs.org/en/blog/release/v24.21.0) and
[release support schedule](https://nodejs.org/en/about/previous-releases).
An exact released version was selected instead of a floating `20`, `24` or
`lts/*`. This is not a claim that pinning alone proves application compatibility.

The current source uses Nest 11, Prisma/client 5.22.0, Vite 6.4.3 and native
argon2. Prisma/client, Nest, Vite and the lockfile are unchanged. Their actual
runtime compatibility, native loading, generation, migrations, database
integration and browser behavior must pass on this candidate before acceptance.
The existing `@types/node` 20 type baseline is not an executing Node 20 process;
changing it is a separately tested type/API compatibility decision, not a
prerequisite for pretending that these runtime gates passed.

The existing exact pnpm 10.32.1 integrity pin is retained. Both API and web
Docker builds install from the frozen lockfile with lifecycle scripts enabled;
no `--ignore-scripts`, forced audit fix, skipped failing tests or floating pnpm
replacement is introduced.

## Implemented controls

- Exact Node pin in engines, Volta, nvm, active CI inputs, API/web build bases
  and an explicit non-root development-container build.
- Built-in-only runtime checker rejects mismatched execution and declaration
  drift before install/dev. Its explicit `--declarations` mode does not certify
  the Node process executing it.
- Safe dev preflight resolves API PORT using the same environment-file
  precedence, checks API/web port availability without killing any process or
  silently selecting a different port, and never prints environment values.
- If bootstrap outputs such as `env.schema.js` are absent, only the generated
  development incremental cache is invalidated. Existing outputs, user media,
  database volumes and environment files are retained. Redirected API/cache
  directories and non-regular cache files are refused.
- `pnpm dev:doctor` performs the checks without changing the cache. A successful
  port probe is not live API/database readiness; another process may bind later.
- Explicit `vite.config.ts` selection and the browser-source/server-CommonJS
  contracts boundary remain unchanged. Recursive Docker context exclusions
  prevent nested local outputs, caches and environment files entering builds.

The prior README recommended `smoke:compose` locally even though the script
executes `down -v` both before testing and on exit. Its actual entrypoint now
checks all three CI/Actions/hosted-runner indicators **before** setting up
Compose or its cleanup trap. Normal local and self-hosted invocation is rejected;
no Docker operation occurs. This is an accidental-data-loss guard, not a
cryptographic trust boundary; never spoof the CI indicators. The destructive
smoke remains enabled for the existing disposable GitHub-hosted CI job.

## Acceptance harness

The existing Windows/Linux startup workflow now verifies the actual Node pin,
executes runtime/cache/port tests, installs frozen dependencies and checks the
lockfile stayed unchanged. On each OS it generates the real Prisma client,
builds database/API outputs, deliberately removes only the generated
`env.schema.js` in the disposable CI checkout, invalidates the stale dev cache,
recompiles, and requires the generated configuration successfully. Production
API and web builds also run on both OS runners.

The preserved browser gate reproduces the old generated-Vite-config failure
before exercising the actual fixed dev command. Additional tests:

1. Start the real dev server with controlled API transport failure, navigate
   into the account flow and edit an input successfully.
2. Build the current isolated web source from scratch, preview that production
   bundle, and perform the same interaction while API transport fails.
3. Occupy a TCP port with a test-owned HTTP listener, assert Vite exits nonzero
   rather than reusing/falling back, and prove the existing listener is alive.

Timing evidence starts at the owned server process spawn and ends after
navigation plus the editable input acknowledgement, not at “Vite ready”. JSON
records the OS, actual Node, mode and scoped failure; screenshots/logs are
attached. This transport-fault test does **not** claim successful authentication
or actual backend availability. Historical mocked Admin screenshots remain
explicitly mocked, not a new real-service acceptance claim.

`node scripts/dev/api-output-check.cjs simulate-missing-output` is fault
injection for disposable CI only and rejects execution without `CI=true`.
It is not a user troubleshooting command. Never run it on an active deployment.

## Local evidence and remaining gates

Executed in the available Linux workspace, **Node 22.16.0**, not the candidate:

```sh
node --test scripts/runtime/toolchain.test.cjs scripts/dev/preflight.test.cjs scripts/dev/compose-smoke-context.test.cjs
node scripts/runtime/toolchain.cjs --declarations
git diff --check
```

Result at submission: 32/32 tests PASS, zero failures/skips; declaration-only
check PASS; diff whitespace check PASS. The test fixtures that supply 24.21.0
verify validator behavior; they do not represent a locally executed Node 24
runtime. Browser-test syntax transpilation had zero syntax diagnostics; full
semantic typecheck/browser execution was not available locally.

The local container could not resolve external package hosts and had no pnpm,
Node 24, Docker daemon or database services. Consequently clean installation,
application build, actual new browser tests, native bindings and image boots
were not claimed locally. The final PR body/comment must link actual hosted
results for its exact head; the baseline's successful Node 20 runs are not
substitutes. Keep failed, queued, cancelled and missing evidence non-PASS.

The existing full Linux CI, database/Redis/S3/scanner integration, security,
Docker API/migrator and Compose gates are preserved and now use the candidate.
The added Windows steps prove real emission and builds when green, but do not
by themselves prove positive live Windows API startup against Postgres/Redis.
Windows live-service acceptance, dedicated web/devcontainer image boot and
real staging remain explicit unclosed gates unless separately executed and
recorded. A preview server is not production ingress, TLS, SMTP or staging.

## Safe operator commands after selecting the candidate

Use the existing nvm/Volta workflow to select the checked-in exact version;
verify `node --version` prints `v24.21.0`, then run from the repository root:

```sh
node scripts/runtime/toolchain.cjs
pnpm install --frozen-lockfile
pnpm dev:doctor
pnpm dev
```

These commands do not provision databases or select a hosting vendor. Start
only the project's authorized local dependencies using its existing runbook.
An occupied API port may indicate an existing related Docker API or an unrelated
process: identify it before stopping anything. No blanket `taskkill node`,
`killall`, volume removal, `db push`, forced migration reset or cache-wide
filesystem cleanup is appropriate.

To run the isolated browser regression after installing its Chromium dependency:

```sh
pnpm --filter @homeservicemarketplace/web exec playwright install chromium
pnpm --filter @homeservicemarketplace/web test:startup
```

The production-preview case creates its own fixture-origin bundle from current
source. No real credentials or production API origin are needed for that bounded
test. Real API success requires the separate integration journey.

## Rollback and closure

Revert this PR normally if candidate gates fail; do not rewrite shared history
or delete data. Reinstall/rebuild using the selected runtime only after retaining
local environment files and volumes. Do not call the old end-of-life runtime a
newly approved production fallback merely because it is the previous source pin.

R02 closes only after the dependency and final-source Windows/Linux/dev/build/
production/image/interactive gates are accepted. This submission records a
candidate implementation, not completion of R03-R10 or production readiness.
