ARG NODE_VERSION=20-alpine

# ---------------------------------------------------------------------------
# builder — install, generate, and build the workspace.
#
# D-8 root cause (fixed here) was an ORDERING bug, not a missing flag.
#
# The previous Dockerfile ran `pnpm install --frozen-lockfile` in a `deps`
# stage that had copied ONLY the package.json manifests. pnpm executes
# workspace lifecycle hooks during install, and `packages/contracts` declares
#     "prepare": "pnpm run build"   →   tsc -p tsconfig.build.json
# whose tsconfig and sources were not copied until the *next* stage. Every
# cold `docker build --no-cache` therefore died with:
#     packages/contracts prepare: error TS5058: The specified path does not
#     exist: 'tsconfig.build.json'
#
# `--ignore-scripts` is deliberately NOT used to paper over this: it would
# also skip the dependency install/postinstall hooks that produce required
# artifacts (argon2's native binding via node-gyp-build, the Prisma engines
# download), and `pnpm rebuild -r` re-triggers the very same workspace
# `prepare` hook, so it does not actually avoid the problem.
#
# The fix is to copy the sources BEFORE installing, so every lifecycle script
# — workspace and dependency alike — runs with its inputs present. The cost is
# a coarser Docker layer cache on manifest-only changes; correctness of the
# cold build is the requirement, and `--no-cache` ignores that cache anyway.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /workspace
# python3/make/g++ back argon2's node-gyp-build fallback compile; openssl is
# what Prisma probes to select its query-engine binary target on Alpine.
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Sources first. .dockerignore keeps node_modules / dist / .env out, so this
# is the checkout, not the host's build state.
COPY . .

# Scripts intentionally ENABLED. Runs: workspace `prepare` (contracts build),
# argon2 `install` (node-gyp-build), @prisma/engines `postinstall`.
RUN pnpm install --frozen-lockfile

# Prisma client codegen — schema lives in packages/database/prisma.
RUN pnpm --filter @homeservicemarketplace/database exec prisma generate

# Build in dependency order: contracts → database → api. `nest build` is
# invoked directly rather than via the api's `build` script (which re-runs
# build:deps) so the ordering is explicit and nothing is built twice.
RUN pnpm --filter @homeservicemarketplace/contracts build
RUN pnpm --filter @homeservicemarketplace/database build
RUN pnpm --filter @homeservicemarketplace/api exec nest build

# Self-contained production bundle: prod dependencies only, workspace deps
# materialised as real directories carrying the dist/ output built above.
#
# --legacy is required and deliberate. From pnpm v10 `pnpm deploy` refuses to
# run unless the workspace sets `inject-workspace-packages=true`
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). Turning that on repo-wide would
# replace the workspace symlinks with hard copies for every developer, so a
# rebuild of packages/contracts would no longer be visible to apps/web without
# reinstalling — a real regression in the local workflow to satisfy a
# packaging step. --legacy is pnpm's supported escape hatch and still produces
# the same self-contained bundle.
RUN pnpm --filter @homeservicemarketplace/api deploy --prod --legacy /out

# Self-contained MIGRATION bundle (Sprint 4). Deliberately NOT --prod: the
# Prisma CLI is a devDependency of the database package, and the CLI is the
# entire point of this bundle. `files` in that package.json already limits it
# to dist/, prisma/ (schema + migrations) and generated/.
RUN pnpm --filter @homeservicemarketplace/database deploy --legacy /migrate \
 && test -x /migrate/node_modules/.bin/prisma \
 && test -d /migrate/prisma/migrations \
 && echo "migration bundle carries the prisma CLI and the migrations"

# Fail the BUILD — not the first request — on the regressions this image
# previously shipped:
#   D-7  `Cannot find module 'express'`: express was only a transitive
#        dependency of @nestjs/platform-express, which pnpm's strict layout
#        does not expose to the app.
#   D-8  a missing Prisma client / query engine in the deployed bundle.
#   D-8  application SOURCES and the TypeScript toolchain shipped in the
#        runtime image: apps/api had no `files` field, so `pnpm deploy`
#        copied src/, test/, and the tsconfigs alongside dist/.
#
# The Prisma client is generated into packages/database/generated (see the
# generator `output` in schema.prisma) rather than into pnpm's virtual store,
# so `pnpm deploy` carries it as ordinary package files and nothing has to be
# stitched into node_modules by hand.
RUN set -eux; \
    node -e "console.log('express resolves at', require.resolve('express', { paths: ['/out'] }))"; \
    GEN=/out/node_modules/@homeservicemarketplace/database/generated/prisma; \
    test -f "$GEN/index.js"; \
    ls "$GEN" | grep -q 'libquery_engine.*\.node'; \
    node -e "require('$GEN'); console.log('prisma client + engine load from the deployed bundle')"; \
    test ! -d /out/src; \
    test ! -d /out/test; \
    test ! -d /out/node_modules/typescript; \
    echo "deployed bundle carries no sources and no TypeScript toolchain"

# ---------------------------------------------------------------------------
# migrator — one-shot schema deployment job. Sprint 4.
#
# Migrations must NOT run from the API's entrypoint. With more than one
# replica, every replica would race the same `migrate deploy` against the same
# database on every rollout, and the loser of that race either blocks on
# Postgres' advisory lock or dies. The application container's job is to serve
# traffic; applying schema is a separate job that runs to completion FIRST.
#
# Compose expresses that with `depends_on: { api-migrate: service_completed_
# successfully }`, so `--scale api=N` still applies migrations exactly once.
#
# Idempotent by construction: `prisma migrate deploy` applies only the
# migrations absent from the `_prisma_migrations` table and exits 0 when there
# is nothing to do, so re-running the job — on every boot, on a retry, on a
# redeploy of an unchanged image — is a no-op.
#
# Built FROM builder because that stage already has the resolved workspace,
# the Prisma CLI, and the engines. The runner image deliberately carries none
# of those (no CLI, no npm), which is precisely why the API cannot migrate
# itself even if someone tried.
#
# NOTE: `prisma migrate deploy` is invoked directly rather than through the
# package's `migrate:deploy` script, because that script wraps the command in
# `dotenv -e ../../.env` and there is no .env file in an image — DATABASE_URL
# arrives from the container environment.
# ---------------------------------------------------------------------------
# Built from a clean base rather than FROM builder. Inheriting the builder
# gave a working but 2.59 GB job image carrying python3/make/g++, the pnpm
# store, and every workspace package — a compiler toolchain shipped to
# wherever migrations run, pulled on every deploy. The bundle below is the
# schema, the migrations, and the Prisma CLI, and nothing else.
FROM node:${NODE_VERSION} AS migrator
# openssl is what the Prisma engines link against on Alpine.
RUN apk add --no-cache openssl \
  && addgroup -S migrate \
  && adduser -S -G migrate migrate
WORKDIR /migrate
COPY --from=builder --chown=migrate:migrate /migrate ./
# Same non-root posture as the runtime image: a job holding database
# credentials is exactly the wrong place to run as uid 0.
USER migrate
# No tini: a one-shot job with no children and no signal handling to get
# wrong. It runs, exits with prisma's status, and Compose gates the API on
# that status being 0. The CLI is invoked from the bundle's own .bin rather
# than through pnpm, which is not installed here.
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner — non-root, production dependencies only, no sources, no toolchain.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NODE_OPTIONS="--enable-source-maps"
WORKDIR /app
# openssl is a RUNTIME requirement of the Prisma query engine on Alpine.
RUN apk add --no-cache tini openssl \
  && addgroup -S app \
  && adduser -S -G app app

# Remove the npm / corepack toolchain the base image bundles.
#
# The container's only job is `node dist/main.js`; it never installs
# anything. But the bundled npm ships its own vendored dependency tree
# (node-tar, sigstore, glob, minimatch, cross-spawn, ip-address, ...) and an
# image scanner reports every advisory in it — a long tail of CRITICAL/HIGH
# findings for code that can never execute here. Deleting it removes those
# findings honestly (the code is gone, not suppressed), takes a package
# manager off the attack surface of a production container, and shrinks the
# image. The final `command -v npm` check fails the build if a future base
# image puts it back somewhere else.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /opt/yarn-* \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
  && ! command -v npm
COPY --from=builder --chown=app:app /out ./

# Media upload root for STORAGE_DRIVER=local. Sprint 4.
#
# Created and chowned HERE, in the image, on purpose. When Docker first
# populates an empty named volume it copies the image's directory — contents
# AND ownership — into it, so the volume comes out owned by `app`. Create it
# only in Compose and the volume is root-owned instead, the non-root process
# gets EACCES on the first PUT, and the failure surfaces as a broken upload
# rather than as a permissions problem.
#
# It is also a deliberate, absolute path rather than the default
# `<cwd>/.media-uploads`, so uploads land on a mount that can be a volume and
# not inside the application bundle.
RUN mkdir -p /var/lib/hsm/media && chown -R app:app /var/lib/hsm
ENV LOCAL_STORAGE_DIR=/var/lib/hsm/media

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
