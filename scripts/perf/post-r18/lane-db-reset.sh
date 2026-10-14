#!/usr/bin/env bash
# R27 — recreate the lane's disposable database, then migrate and seed it.
# Refuses to act on anything but the hsm-r27-perf-postgres container.
set -euo pipefail
cd "$(dirname "$0")/../../.."
container=hsm-r27-perf-postgres
docker inspect "$container" >/dev/null
docker exec "$container" dropdb -U r27 --if-exists --force hsm_r27_perf
docker exec "$container" createdb -U r27 hsm_r27_perf
# The database scripts read DATABASE_URL from the worktree's root .env.
grep -q '127.0.0.1:54397/hsm_r27_perf' .env || { echo 'root .env does not point at the lane database' >&2; exit 1; }
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed >/dev/null
echo 'lane database recreated, migrated and seeded'
