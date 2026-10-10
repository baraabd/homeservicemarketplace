# R18 — Deployment runbook

Not executed: no authorized target exists (`HOSTED_STAGING_ACCEPTANCE.md`).
This is the procedure for the owner's operator once one does. It reuses
`infra/production/` and adds no vendor.

## Preconditions

1. The source SHA is a merge commit on `develop` (or the release branch the
   owner names) with every required check green (`BRANCH_PROTECTION_EVIDENCE.md`).
2. `GO_NO_GO.md` says GO for this SHA, and for production
   `PRODUCTION_RELEASE_APPROVED=true` is recorded by the owner.
3. A backup taken in the last hour, with its identifier recorded.
4. The previous release's three image digests are recorded as the rollback target.

## Build once

From `apps/api/Dockerfile` build the API runner and migrator targets, and from
`apps/web/Dockerfile` the web image, all with `SOURCE_SHA=<full sha>`. Supply
`VITE_API_URL` (HTTPS API origin, no `/v1`) and an explicit
`VITE_PROVIDER_ONBOARDING_V2`. Push to the approved registry and record the
three digests and the SBOM. Fill `RELEASE_MANIFEST.json`. Production uses the
same digests as staging; never rebuild for production.

## Roll out (staging first, then production through its approval gate)

1. Prepare the release JSON for the launcher (`infra/production/STAGING.md`,
   "Images and manifest"); digests only, no mutable tags.
2. Run the launcher's checks; stop on any refusal.
3. Run the migrator image once (forward-only migrations).
4. Replace the API (and its workers), then the web image.
5. Wait for `/health/ready` on every instance before routing traffic.
6. Smoke with synthetic accounts: login with OTP, a request, a bid, a
   message, a notification. No demo users, no seeds, no destructive tests.
7. Watch error rate, latency, readiness, outbox backlog and scanner health.

## Stop conditions → `ROLLBACK_RUNBOOK.md`

Readiness not green within the agreed window; 5xx above the owner's
threshold; a failed smoke step; a failed migration.
