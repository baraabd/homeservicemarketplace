# Operator-managed staging releases

This repository does not select a hosting provider, country, paid service, DNS record
or secret manager. The release launcher is a controlled application rollout onto an
already-authorized target, not an infrastructure provisioning script. R03 acceptance
requires real evidence from that selected target, not a successful CI smoke test.

## Existing topology to supply

The application image contains the API and the currently configured outbox/scanning
workers. The static web image has no server credentials. The one-shot migrator is a
separate image with a separate database identity. Postgres, authenticated TLS Redis,
durable S3-compatible storage with public/restricted/portfolio-staging separation,
a verified SMTP transport and ClamAV must already be available on the target.
Mongo remains optional and must not be silently enabled. Verification, work access
and payment flags are not enabled by this rollout code.

Supply an existing Docker network and a local Docker context on the deployment host.
SSH/TCP daemon contexts are rejected because file-backed Compose secrets refer to paths
on the daemon host; validating a different client's files would be misleading. The
reference deployment binds API and web to loopback only. An existing approved HTTPS
edge must route the declared API origin (including /health and /v1) and web origin.
Do not expose the API's raw HTTP port publicly or bypass certificate validation.

## Secret files

Use absolute canonical paths outside the checkout. Populate files through the chosen
secret manager or protected operator mechanism. They must not enter Git, image build
arguments, PR comments, artifacts or chat. File-backed Compose secrets are mounts,
not an encrypted secret manager. On POSIX hosts the launcher refuses access for
"other" users. Set ownership/group ACLs so the exact non-root image user can read its
mounted file; do not fix permission errors by making files world-readable. On Windows,
review the actual host ACL and Docker mount behavior; a successful syntax test does
not certify ACL isolation.

The API file must explicitly contain NODE_ENV=production, APP_ENV=staging, the actual
FRONTEND_URL and DATABASE_URL. Its optional PORT must be 4000. Cross-origin deployments
must include the exact web origin in CORS_ORIGINS. All additional API settings are
validated by the built env schema and strict runtime policy. Supply strong real JWT
secrets, secure cookies, durable storage, the required worker/scanner settings and mail
configuration; no development example file is a deployment-ready secret set.

The migration file contains **only DATABASE_URL**. It must use a different database
username and the same logical database/schema as the application. The reference
Prisma native-engine DSNs require `sslmode=require&sslaccept=strict` exactly once.
Supply any provider-required CA configuration without disabling verification. Matching
names do not prove that two endpoints reach the same physical database: independently
verify the target, role memberships/grants and migration authority. The application
role must not own the schema or have migration/superuser privileges. No grants are
created or certified by the launcher. Redis's reference configuration uses TLS plus
password authentication; alternative identity integrations need an explicit reviewed
implementation, not an empty password workaround.

Keep release input files immutable throughout a rollout. The launcher detects changed
bytes before migration and before application replacement, but an operator able to
modify files between a check and a read is outside this cooperative deployment lock.
Do not rotate credentials concurrently with deployment.

## Images and manifest

Build the API runner and migrator targets from `apps/api/Dockerfile`, and the web image
from `apps/web/Dockerfile`, using the **same accepted full source SHA** as SOURCE_SHA.
For the web build supply VITE_API_URL as the exact HTTPS API origin WITHOUT `/v1` (request paths already include that prefix), and an
explicit approved VITE_PROVIDER_ONBOARDING_V2 value. Publish only to the approved
registry after reviewing CI/security evidence and applicable authorization. Capture
all three registry digests and verify their provenance. Digest pinning prevents tag
drift; self-declared OCI labels alone are not signed provenance.

Create a release JSON document with exactly these fields. The following is a field
contract, not an executable deployment file; replace descriptions with actual approved
values of the indicated type:

| Field | Required value |
| --- | --- |
| schemaVersion | number 1 |
| sourceSha | full 40-character lowercase Git SHA |
| dockerContext | explicit local daemon context name |
| projectName | unique hsm-staging-* name, never the developer Compose project |
| externalNetwork | existing approved Docker network name |
| images | object with distinct api, migrator, web image references, each ending in @sha256 plus a 64-character digest |
| secretFiles | object with api and migration absolute protected external file paths |
| ports | object with api and web distinct integer host ports from 1024 to 65535; always bound to loopback |
| webOrigin, apiOrigin | canonical HTTPS origins without path, credentials, query or fragment |
| onboardingV2 | explicit boolean corresponding to the compiled web bundle |

## Operator actions

`node infra/production/staging.cjs --check /secure/release.json` validates manifest and
local file constraints **without Docker, image pulls, migrations or deployment**. Its
CONFIGURATION_ONLY result does not certify the actual built API configuration.

Only after explicit deployment authorization, use `--apply /secure/release.json` with
the exact `projectName@sourceSha` as the final argument. This is an operator confirmation
barrier, not RBAC and not a substitute for protected environments. Keep the checkout
and operator credentials under trusted control. The launcher checks the existing
context/network, parses Compose without printing expanded secrets, pulls immutable
images, validates image labels, runs the actual networkless API preflight, executes
migrations once, starts API/web with readiness checks and verifies HTTPS health, web
build identity and unauthenticated CORS. It does not deploy on merge or PR events.

The local project lock refuses overlapping applies and never auto-expires a crashed
process's lock. Investigate the host, containers and database migration state before
an authorized operator removes a stale lock. A timeout/failure may leave a one-shot
container or changed application state: no migration retry, rollback, down command,
volume deletion or cleanup is silently attempted. Docker diagnostics can contain
configuration data; inspect them privately, never post raw diagnostics or secret files.

## Separate live acceptance

Liveness answers whether the process is running. Readiness checks the database/Redis
(and Mongo only when enabled) required to serve requests. SMTP, S3 and scanner health
are separate release/operations diagnostics; they must not make a liveness restart
loop. A good liveness/readiness response does not prove mail or upload correctness.

Use a real approved test inbox to complete registration/verification; verify TLS mail
and delivery, not just transport construction. Exercise public and restricted synthetic
uploads with owner, authorized reviewer/provider, wrong user and unauthenticated
clients. Verify scanner verdicts and worker delivery. Inspect effective bucket/DB
permissions and recover an approved test backup. Run authenticated browser journeys
from the deployed bundle to verify cookies, CSRF, CORS, V2 flag source and persistence.
Never make restricted identity documents public to pass an image-viewing check.
Record sanitized target-specific evidence linked to the deployed source and digests.

The launcher deliberately reports DEPLOYED_NOT_ACCEPTED even after its limited live
checks succeed. Full sprint closure is tracked in
`docs/production-readiness/r03/ACCEPTANCE.md`.
