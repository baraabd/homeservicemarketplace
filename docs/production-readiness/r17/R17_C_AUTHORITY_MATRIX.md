# R17-C — Dispute command authority matrix

Base `develop@a8dc1a2`, plus the R17-C changes. One row per command. Every
mutation runs in a single `TransactionRunner` transaction (Prisma 6.12.0: a
rejected COMMIT rejects the caller, per PLATFORM-TX-1).

Test levels: **U** unit with mocked collaborators; **I** real PostgreSQL
service-level; **H** real AppModule over HTTP with real login, guards and
CSRF; **B** real browser plus real API and database.

Lock order on every path is `Booking` then the case row (`DisputeWorkspace`
or `Dispute`). No path takes them in the opposite order.

## Participant (canonical intake and workspace)

| Command           | Route                                         | Actor / relationship                                                                     | Start state / revision                                          | Persistent result + history                                          | Notification / outbox                                                        | Read-back                 | Tests         |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------- | ------------- |
| Open dispute      | `POST /v1/me/disputes`                        | Session user who is the booking's seeker or provider; booking locked, membership re-read | eligibility from the intake setting; actor-bound intent receipt | `Dispute` + `DisputeEvent OPENED` (receipt) + workspace when enabled | counterparty notice (no narrative) + `dispute.intake.opened.v1`              | `GET /v1/me/disputes/:id` | I, H, B (C-7) |
| Draft save        | `POST /v1/me/disputes/drafts/:bookingId`      | Session participant                                                                      | `version` compare                                               | encrypted `DisputePrivateDraft`                                      | —                                                                            | `GET …/drafts/:bookingId` | I, H, B       |
| Workspace command | `POST /v1/me/disputes/:id/workspace/commands` | Historical **and** current participant (workspace and booking both match)                | `expectedRevision`; receipt `dw_<sha(dispute, actor, key)>`     | per command, `DisputeWorkspaceEvent` (revision + 1)                  | neutral EN/AR notices (preference honoured) + `dispute.workspace.changed.v1` | `GET …/workspace`         | I, H, B       |
| Evidence upload   | `POST /v1/me/disputes/:id/workspace/evidence` | Participant                                                                              | case not closed                                                 | encrypted object + `DisputeEvidence STORED`                          | via workspace event                                                          | after scan → CLEAN        | I (ClamAV), B |
| Evidence read     | `GET …/workspace/evidence/:evidenceId`        | Author; counterparty only for a shared redacted derivative                               | CLEAN, not erased, within retention                             | `AuditEvent DISPUTE_EVIDENCE_READ`; re-checked after storage I/O     | —                                                                            | bytes streamed (no URL)   | I             |

## Reviewer (canonical workspace, `/v1/admin/dispute-workspaces`)

All reviewer actions resolve **fresh** database permissions inside the
transaction. `dispute:read:any` is the floor; without it the case is reported
as not found.

| Command             | Required                                                                                                    | Allowed start state                           | Result                                                                 | Tests               |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| ASSIGN              | `dispute:assign`; assignee holds a decision permission; not a participant; appeal: not the original decider | any open state                                | `assignedToUserId`                                                     | I, B                |
| REQUEST_INFORMATION | assigned + `dispute:request`                                                                                | GATHERING/PROPOSED/APPEALED                   | `DisputeInformationRequest` with a deadline                            | I, B                |
| PROPOSE             | assigned + `dispute:propose`                                                                                | GATHERING/PROPOSED/APPEALED                   | encrypted proposal; older offers SUPERSEDED                            | I, B                |
| DECIDE              | assigned + `dispute:decide` (+ `dispute:exception:approve` for POLICY_EXCEPTION)                            | GATHERING/PROPOSED; no open requests          | `DisputeDecisionRecord` (+ appeal window), state DECIDED. **No money** | I (R17-C D7–D16), B |
| DECIDE_APPEAL       | assigned + `dispute:appeal:decide`; not the original decider                                                | APPEALED                                      | superseding decision record                                            | I, B                |
| CLOSE               | assigned + `dispute:close`                                                                                  | DECIDED; window passed; fulfilments confirmed | state CLOSED; `Dispute.status = RESOLVED`; retention clock starts      | I, B                |
| Evidence read       | `dispute:evidence:view` (assignment **not** required — C-5)                                                 | CLEAN                                         | audited read                                                           | I                   |

Concurrency for every workspace command: the booking and workspace row locks
serialize commands, and `expectedRevision` refuses the second command
(`409 STALE_REVISION`). A unique-key race maps to `409 CONCURRENT_COMMAND`. An
identical retry with the same key replays the stored receipt
(`replayed: true`) after authorization is evaluated again. The same key with a
different payload gives `409 INTENT_REUSED`. R17-C evidence: D9/D10, D11 (with
a revoked grant on replay), D15/D16.

## Legacy admin tickets (`/v1/admin/disputes`) — disputes with no workspace

Guards: `JwtAuthGuard` (session row validated on every request) plus
`RolesGuard('admin')` (role from the token; role mutations revoke sessions)
plus `CsrfGuard` on mutations. No permission check (P9, DECISION_NEEDED).
Every query filters `workspace IS NULL`, so these routes cannot read or change
a workspace case.

| Command     | Route                                 | Actor / relationship                                                           | Start state                         | Transaction (R17-C)                                                           | Result + history                       | Audit                                                        | Notification                                                                                                                        | Tests      |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| List/detail | `GET /v1/admin/disputes[/:id]`        | admin role                                                                     | —                                   | read only, page ≤ 100, keyset cursor; detail events ≤ 20                      | —                                      | —                                                            | —                                                                                                                                   | U, H       |
| Open        | `POST /v1/admin/disputes`             | admin; acting admin from the session; **opener must be a booking participant** | booking exists; no active dispute   | participant check in the transaction; unique index → `409`                    | `Dispute OPEN` + `DisputeEvent OPENED` | `ADMIN_DISPUTE_OPENED` (ids)                                 | —                                                                                                                                   | U, I, H    |
| Update      | `PATCH /v1/admin/disputes/:id`        | admin                                                                          | not terminal; cannot enter terminal | **`lockForDecision`**: Booking then Dispute `FOR UPDATE`, re-read             | field + one event per changed field    | `ADMIN_DISPUTE_UPDATED` (ids, lengths)                       | opener, on status change; link to the opener's experience                                                                           | U, I       |
| Resolve     | `POST /v1/admin/disputes/:id/resolve` | admin; `resolvedById` from the session                                         | OPEN / IN_REVIEW                    | **`lockForDecision`**; the second admin waits, then sees the decision → `409` | status + `DisputeEvent RESOLVED`       | `ADMIN_DISPUTE_RESOLVED` (ids, statuses, `resolutionLength`) | opener: "decision recorded … does not move money", `/home/bookings/:id` or `/provider/bookings/:id` + `notification.created` outbox | U, I, H, B |

Legacy retries carry no idempotency key. A retried resolve after a lost
response is refused with `409` (already decided), so no second decision or
side effect is written. The client re-reads the dispute on any outcome.

## Not authorized anywhere

Refund, payout, capture or ledger execution; a client-supplied actor, role,
reviewer, assignment, status or price; public evidence URLs.
