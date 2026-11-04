# K09 rollback and forward repair

## This change

K09 adds files only under `docs/production-readiness/ksa-launch/K09/`. It has no
runtime, schema, migration, contract, dependency, workflow or infrastructure
effect. To roll back, revert the K09 commit, or close the PR unmerged. No data,
resource or flag needs restoring.

## Boundaries for the future lanes (not executed)

- **R36 restore** must write only to restore identities that were proven
  disjoint from the source before the first write. The forward repair for a
  failed rehearsal is to discard the restore target. It must never write back
  to the source, and it must never run `migrate reset` or a destructive seed.
- **Application rollback** redeploys prior immutable images without running
  their migrator (F-07). The forward schema stays in place. Database or
  financial recovery is a separate, owner-approved procedure. Legacy money
  values are never reinterpreted.
- **Unknown external outcomes** (provider-accepted payment, refund or mail
  absent from a snapshot) go to reconciliation and are never replayed
  automatically.
- **R37 load/fault runs** stop at the first breached abort threshold, on
  operator stop, or when the authorization window expires. Recovery follows
  the per-fault recovery action in the authorization record.
