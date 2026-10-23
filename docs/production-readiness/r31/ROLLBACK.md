# R31 rollback and compatible recovery

## Before merge or deployment

This task opens a review branch/PR only. Closing that PR leaves deployed
behavior unchanged. No merge, deployment, live collection, production
permission grant or hosted resource was performed by R31.

## If an authorized release later needs rollback

Use an ordinary reviewed corrective commit or revert on the deployment branch;
do not rewrite history or force-push. Restore the previous compatible release
only after checking pending lifecycle events and its consumer registration.
Keep immutable database records and the existing ledger authority intact.

1. Disable new collections through the existing authorized configuration and
   stop new plan/transition publication. R31 itself leaves those live defaults
   unavailable. Do not edit payment or ledger rows to simulate a rollback.
2. Remove the My Plan entry/route and additive read composition if needed. This
   does not revoke, extend or refund a paid period. Preserve the existing auth
   and permission boundaries.
3. Restore the unavailable R24 activation participant only in a compatible
   composition. New confirmations must fail closed if a required participant
   is absent; they must never bypass entitlement work to make collection pass.
4. Inventory pending `money.subscription.expiry-due.v1` and
   `money.subscription.reminder-due.v1` events by stable period identity. Keep a
   compatible handler registered while draining/replaying them through the
   existing worker controls, or pause their dispatch under the operations
   runbook. Removing a handler with pending events can produce dead letters.
5. Preserve plan versions, subscriptions, immutable periods, confirmations,
   ledger transactions, coupon redemptions, usage and internal `r31_` operation
   receipts. Do not delete receipts: they prevent repeated old policy effects
   from acting on a later renewal.
6. Re-run permission/ownership, confirmation rollback, usage concurrency,
   replay/expiry ordering and affected browser/security checks on the actual
   corrective head. Obtain separate owner authorization for release actions.

There is no R31 schema migration or dependency downgrade to reverse. Existing
clients tolerate additive read DTO exports. A future schema/policy change must
define its own forward-repair and compatibility plan.

## Disposable verification cleanup

The browser harness owns its temporary PostgreSQL database, private fixture
credentials, build directory, browser contexts and process groups. It closes
the Nest fixture, drops only its named disposable database, terminates only
spawned process groups and removes private temporary files in `finally`.
Failure or timeout in cleanup makes the verification fail.

Local R31 PostgreSQL and Redis instances were provisioned only for this task
on loopback ports 5531 and 6431. Stop those exact owned processes after tests;
never flush a shared Redis server, drop an operator database, delete unrelated
volumes or kill a process based only on a port number. Sanitized summaries and
screenshots are separate from credentials and may be retained as evidence.

## Coordinator handoff

The coordinator integrates R31's existing activation token and exported usage/
lifecycle services with accepted R29/R30/R32/R33 source in a separate G3
candidate. Verify both actual collection rails, refund consequences and
cross-role reads before changing integration acceptance. A rollback of R31
does not grant permission to release unassigned peer lanes or change G2's
frozen source identity.
