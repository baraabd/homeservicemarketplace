# R38 — Preflight rollback and future release boundary

## This documentation change

This PR adds only the seven files listed in [OWNERSHIP.md](OWNERSHIP.md).
There is no schema, dependency, runtime, flag, infrastructure or deployed-state
change. If this documentation is withdrawn after an authorized merge, revert
its documentation commit through the normal reviewed process. Preserve any
later evidence added by another assigned writer. Do not reset branches,
rewrite history or modify another lane to remove this preflight.

## Rollback certification remains blocked

The existing [R36 correction request](../r36/shared-change-requests/CR-001-integration.md)
identifies a concrete unresolved conflict: the R18 rollback runbook says to
reuse the old release launcher while avoiding the old migrator, but
`infra/production/staging.cjs` unconditionally executes `api-migrate` in its
apply path. R38 must not advertise applying an old manifest as a safe
application-only rollback or invent a supported rollback flag.

Before a future release is accepted, the coordinator/R36 owner must establish
a reviewed migration-free application rollback path and actual compatibility
with the database after forward migrations. Preserve the exact previous
accepted API/web/migrator digests, source identity, protected configuration
and secret-version references; retaining a migrator digest as lineage does
not authorize running it backwards.

Any authorized rehearsal uses separately approved isolated database/storage
targets with outbound side effects disabled. Verify representative durable
financial history, outbox state, restricted media, runtime API/web identity,
health/readiness and useful authenticated journeys. Do not reset the working
database, delete volumes, flush shared Redis, edit immutable ledger history or
substitute a local reversal for proof of an external refund.

The reference topology is operator-managed and can interrupt a single-replica
service during replacement. A gradual rollout or maintenance window, traffic
strategy, role checks, abort thresholds, migration owner and rollback decision
authority require target-specific approval. Existing proposed performance and
recovery numbers are not approved acceptance thresholds.

No rollout, migration, restore, rollback, public deployment or live payment
activation was executed by this preflight. `PHASE_A_READY`,
`RELEASE_ACCEPTED` and `DEPLOYED` remain distinct future states.
