# R29 containment and rollback

This PR is unmerged, has no schema/migration and does not mount an active rail.
Closing the Draft abandons this isolated source without data or resource action.
A later rollback uses a normal reviewed revert; no force push, history rewrite,
shared DB reset, volume deletion or manual ledger edit is permitted.

After separately approved integration, disable new Stripe collection dispatch
and ingress through the coordinator's reviewed configuration/route rollout.
Preserve all durable attempts, original provider keys, external IDs, verified
inbox rows, refund reservations, ledger postings, audit and outbox history.
Pause/refence worker scheduling before replacement; do not erase unknown
outcomes or recreate old operations after the provider idempotency window.

Inventory actual remote payments/refunds before recovery. Query authoritative
provider state using least-privilege time-bounded test credentials. Correct
local consequences only through the approved existing R24/R32 transaction
boundaries; never insert a balancing entry simply to make counts agree.

Keep the previous manual rail available if coordinator integration regresses;
no automatic fallback may move an existing Stripe obligation to another rail.
Rollback does not revoke or grant verification/work access, change refund
policy, enable live funds or mark G3 accepted. Only task-owned temporary
verification dependencies/logs may be removed; no unrelated process is stopped.
