# R28 — Rollback and stop conditions

## 2026-10-22 test-harness repair

The PR #181 repair adds one test path to the earlier nine-file diff. Its bounded
commit changes the R11 integration fixture and the existing R28 evidence only.
If necessary, revert that repair through a reviewed corrective commit while
preserving the earlier database-owner/CREATE contract. Reverting it reintroduces
request-owned listener closure and early-rejection cleanup races; it does not
change any deployed application, database schema or stored data. Rerun the
unchanged R11 real-database suite and final-head CI after a source revert.

## This configuration-only change

No infrastructure, database, account, DNS, bucket, image registry, secret or running
application was deployed by R28. No migration was added. The original 12-file
configuration implementation and the later authorized source/CI repairs have
separate commit identities. Roll back only the intended bounded source change;
this requires no resource deletion, database rollback or credential invalidation.

The 2026-10-18 successor changes nine existing files: three prepared platform
files, their test file and five R28 evidence documents. A reviewed revert restores
the earlier input schema and its fingerprint, but also restores its missing
database-owner/database-CREATE declarations. Preserve that known limitation and
the original denial tests; never present the older fingerprint as approval of the
new contract. Review protected target copies separately before any later rollout.

Before integration, the coordinator can decline the draft PR or supersede the
prepared inputs with a reviewed corrective commit on the same R28 branch. After a
separately authorized merge, revert the identified R28 commit through the normal
PR process. Do not reset a shared branch, force-push, delete peer work, pop another
session's stash or destroy shared volumes. Preserve acceptance history and the
original/follow-up source identities.

CR-001 sections 0 and 1 were applied by the separately authorized current-base/CI
repair documented in PR_REPAIR_20261018.md. This successor does not revert those
workflows or the OTP/realtime correctness repairs. Owner-merged G2 at
`75bd688e7254b84316b32f82b0f6ee337249b977` also applies the API's 30-second Compose
stop grace; preserve that baseline when reverting this nine-file successor.
Selected edge/secret integration and actual shutdown evidence remain pending;
any later integration has its own rollback and must preserve peer changes.

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
