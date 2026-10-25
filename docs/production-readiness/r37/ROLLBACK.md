# R37 — Preflight rollback and future test-stop boundary

## This documentation change

Only the seven paths in [OWNERSHIP.md](OWNERSHIP.md) are added. Revert the
documentation commit through normal review if required. No application, schema,
migration, package, gate, environment or feature flag changes accompany it.
The G3 and R16/R18 restrictions remain in effect before and after a revert.

No deployment, hosted test, fault, service provision, real account grant or
financial operation occurred. There is no runtime rollback to execute and no
hosted cleanup or destructive resource operation is authorized.

## After an authorized future R37 run

The approved target record must define a bounded stop and restoration action
for each fault before execution. On expired authority, source/digest mismatch,
unexpected target, budget exhaustion or safety breach: stop new workload,
cancel/drain owned in-flight connections within the approved bounds, notify the
named operator through the approved incident procedure and preserve evidence.

Restore only the exact resource changed by that run, using the approved action.
Observe recovery, pool/queue drain and absence of duplicate durable financial or
notification effects. Do not kill unrelated processes, flush shared Redis,
reset a working database, remove volumes, expose private media or re-enable an
unchecked scanner fallback. Preserve dead letters and ambiguous external
operation identities; the responsible owner decides any later recovery.

Returning the implementation lease or reverting a harness never rolls back
financial history and never establishes hosted acceptance. No deployment or
live activation is permitted by this document.
