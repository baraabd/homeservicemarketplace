# Rollback and revocation

This BLOCKED record authorizes no deployment and grants no Wave 2 start.
If a published claim becomes stale, mark G1 BLOCKED through a reviewed successor
record, clear all startable lanes/frozen authorization, preserve the old record
and immutable evidence, and notify lane owners through the approved process.
No message to another person is sent by this task.

For the CR-R20-01 source repair, a reviewed revert restores the previous
controller behavior without a migration. It also restores the size-check gap
and incorrect PDF error headers, so prefer a forward repair. Do not remove
restricted-read authorization, auditing or no-store headers as a workaround.

The registry/validator changes can be reverted as one coherent reviewed change;
never revert only the validator to permit an unsupported acceptance claim.
Existing G0 and historical lane evidence are preserved. No database reset,
ledger rewrite, object deletion, schema rollback, role grant or live-money flag
change is part of this procedure. After any application/config/schema/dependency
change, repeat affected evidence on the new exact source before certifying it.
