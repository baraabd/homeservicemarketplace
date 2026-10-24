# G3 inspection rollback

This PR changes only nine coordination/evidence documents. It has no database,
runtime, queue, scheduler, UI, contract, dependency or feature-flag effect.

Before merge, the owner can leave the Draft PR unmerged or close it. After an
authorized merge, use an ordinary reviewed revert of this documentation commit;
do not reset history or force-push. The revert restores older prose and therefore
also restores stale merge descriptions: preserve the verified R30–R33 facts in
any replacement record.

No database rollback, migration, ledger rewrite, payment reversal, storage
cleanup, volume deletion, shared Redis flush or process termination is needed.
The G3 decision remains BLOCKED before and after this change; Wave 4 is never
released by it. Existing G1/G2 frozen source and owner-publication identities
are not changed.
