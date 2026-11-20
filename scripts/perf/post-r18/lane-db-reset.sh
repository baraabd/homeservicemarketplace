#!/usr/bin/env bash
# R27 — recreate the lane's disposable database, then migrate and seed it.
# Refuses to act on anything but the hsm-r27-perf-postgres container.
set -euo pipefail
cd "$(dirname "$0")/../../.."
container=hsm-r27-perf-postgres
# Validate BEFORE dropdb. Never read/copy/overwrite a developer environment.
node --input-type=module <<'NODE'
import { existsSync } from 'node:fs';
import { assertLaneService } from './scripts/perf/post-r18/lib/lane-env.mjs';
if (existsSync('.env')) throw new Error('R27 reset requires a fresh worktree without a root .env');
assertLaneService('postgres');
NODE
export DATABASE_URL='postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf'
docker exec "$container" dropdb -U r27 --if-exists --force hsm_r27_perf
docker exec "$container" createdb -U r27 hsm_r27_perf
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed >/dev/null
# The query/browser fixtures register through SMTP. Reapply their explicit
# policy after every reset, including both immutable measurement runtimes.
NODE_ENV=test APP_ENV=test node scripts/testing/email-auth-fixture.cjs --scope r27
echo 'lane database recreated, migrated and seeded'
