# R28 — Rollback and stop conditions

## This configuration-only change

No infrastructure, database, account, DNS, bucket, image registry, secret or running
application was changed by R28. No migration was added. Rollback of this lane is
therefore a reviewed source revert of its 12 exact files; it requires no resource
deletion, database rollback or credential invalidation.

Before integration, the coordinator can decline the draft PR or supersede the
prepared inputs with a reviewed corrective commit on the same R28 branch. After a
separately authorized merge, revert the identified R28 commit through the normal
PR process. Do not reset a shared branch, force-push, delete peer work, pop another
session's stash or destroy shared volumes. Preserve acceptance history and the
original/follow-up source identities.

CR-001 has not changed the shared workflow, Compose overlay or applied edge. If
the coordinator later integrates those changes, their rollback belongs to that
integration commit and must preserve any peer changes in the same files.

## A later authorized hosted rollout

The following is a handoff requirement, not an action performed or newly authorized
by this PR. Retain `infra/production/STAGING.md`, `staging.cjs` and the existing R18
release/initialization rules as the rollout authority.

Before applying anything, the operator must have the separately approved exact
account/resources/region/cost, reviewed plan fingerprint, prior and candidate
immutable image digests/source identity, protected secret versions and recovery
evidence. Confirm that the previous release is compatible with the database state;
do not assume that rolling images back reverses a schema migration.

Stop before rollout if the plan hash changes, independent origins disagree, image
provenance is missing, the API/migrator target or grants are unverified, the network
boundary is wrong, rotation/deployment serialization is unavailable, actual worker
stop grace is insufficient, or the selected target lacks explicit authority.

If a separately authorized rollout fails, preserve sanitized failure evidence and
the cooperative lock state. The operator investigates the actual rollout owner;
there is no automatic stale-lock expiry. Use an explicitly reviewed rollback through
the existing launcher and approved immutable artifacts. Do not restore a database
over production as a diagnostic action. Any restore goes to the independently
approved R36 isolated resources with outbound delivery and live rails disabled.

Keep old secret snapshots protected for the agreed rollback window; never overwrite
active snapshots or delete credentials merely because a new file exists. Revoke or
retire versions only through the selected secret operator's authorized process.

## Verification after a source revert or later rollback

For a source-only revert, inspect the exact diff and rerun the affected existing
staging/governance checks. No hosted smoke is claimed from a Git operation.
For a real runtime rollback, the release owner must verify HTTPS source identity,
health/readiness, actual cookies/CORS/transport behavior, durable pending work and
restricted media using the approved target. Preserve R18 no-demo-provider and
last-admin-floor behavior and all existing money/verification decisions.
