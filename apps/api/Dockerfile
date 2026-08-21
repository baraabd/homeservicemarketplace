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
COPY --from=builder --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
