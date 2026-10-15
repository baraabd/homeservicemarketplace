# R22 — risks and known deviations

| #   | Risk                                                                                                                                                                                                                                                          | Likelihood / impact        | Mitigation / owner                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| R1  | **Transaction timeout raised from 5 s (implicit) to 15 s.** Slow handlers hold a pooled connection three times longer.                                                                                                                                        | medium / medium under load | Alert `OutboxHandlerNearTimeout`; CR-02 makes it configurable; handlers should chunk (contract §2)                 |
| R2  | **Outcome mislabel at the deadline boundary.** An abandoned delivery that commits just as the deadline fires is counted `lease-lost` instead of `processed`. The data is correct (`PROCESSED`, one effect); only the metric is off for that event.            | low / low                  | Documented; fixing it needs a status read-back. Deferred                                                           |
| R3  | **Heartbeat keeps a stuck-but-alive worker's leases.** Bounded: the delivery deadline abandons a hung handler, so the worker moves on and the heartbeat stops with the batch. A fully blocked event loop stops the heartbeat too, and then the leases expire. | low / low                  | Deadline + DB-clock reclaim                                                                                        |
| R4  | **Replay execution is unavailable** until CR-01 (enum) and CR-03 (permission) are integrated, and the owner grants the permission to a named role.                                                                                                            | certain / ops              | Dry-run works now; fail-closed by design                                                                           |
| R5  | **Replay redelivers into current state.** A handler that reads stale assumptions from the payload could misbehave when an old event is replayed.                                                                                                              | low / medium               | 30-day age limit; contract §3 requires identifiers-only payloads and current-state reads; operator reviews dry-run |
| R6  | **Process-suite child workers in shared CI DBs** claim any due row, like the Sprint 6 suite. A producer suite that enqueues without the `outbox` lock could see its event dead-lettered by the child (no handler).                                            | low / test-only            | Children run only during the exclusive `outbox` lock and only in CR-04's serial step after the parallel run        |
| R7  | **`R22_APPLY_CR01_IN_TEST=1` is irreversible** on the target DB (`ALTER TYPE ADD VALUE`).                                                                                                                                                                     | n/a                        | Opt-in; documented as disposable-DB only; identical to CR-01's statement                                           |
| R8  | **Lenient env parsing of new timing keys** (until CR-02): a typo silently uses the default.                                                                                                                                                                   | low / low                  | Defaults are safe; CR-02 adds strict validation                                                                    |
| R9  | **Windows-only local evidence for signal shutdown.** Locally the process suite used IPC because Windows cannot deliver SIGTERM to a Node child. The SIGTERM path (`main.ts` `enableShutdownHooks`) runs only on Linux.                                        | medium / low               | CR-04 runs the suite on Linux CI with SIGTERM                                                                      |
| R10 | **Full gated API suite under parallel load on this host** hits 120 s advisory-lock acquisition timeouts in unrelated suites. See ACCEPTANCE §3 for the measured outcome and serial re-runs.                                                                   | host-specific              | Hosted CI required before acceptance                                                                               |
| R11 | No hosted, staging or production evidence of any kind.                                                                                                                                                                                                        | certain                    | HOSTED_ACCEPTED is a later gate                                                                                    |

Unresolved owner decisions from R16 and R18 (payout policy, D-2/D-3 dispute
worker mode, live money) are untouched and remain open.

## 2026-10-15 corrective follow-up

The table above preserves original risks and original evidence status.
Current verification and limitations are in ACCEPTANCE §5 and the corrective
PR's final-head CI record. Merging #158 did not integrate CR-01 through CR-05
in the inspected develop source.

- **Bounded scheduling does not cancel transport I/O.** A timed-out callback
  can settle later and may retain resources until its transport ends. The
  worker observes late rejection and never starts the remaining callbacks.
  Transport owners must use real request timeouts/cancellation. A blocked
  JavaScript event loop also cannot execute a timer until it yields.
- **A callback may be dropped.** The shared publication budget starts after
  the transaction commits. Expiry preserves PROCESSED and durable effects;
  it does not retry accelerators or provide durable email/payment delivery.
  Required external work needs an existing durable domain intent. Never
  replay committed financial effects to compensate for a missed push.
- **Two separate time budgets.** The transaction and post-commit phase each
  use the existing delivery deadline (20 s default). Shutdown retains its
  own independent grace/fencing behavior. Existing transport slowness can
  now produce an explicit warning and an omitted later accelerator.
- **Acceptance remains incomplete.** Local service executables were missing;
  the added real-Postgres cases require hosted evidence. CR-04 is still needed
  for Linux independent-process crash/SIGTERM coverage. CR-01/03 still block
  authorized audited replay execution, while replay continues to fail closed.
- **Rollback is scoped.** Reverting this callback correction preserves R22's
  lease protections but restores the callback starvation bug. Reverting the
  entire original sprint also reintroduces stale-writer defects; see ROLLBACK.
