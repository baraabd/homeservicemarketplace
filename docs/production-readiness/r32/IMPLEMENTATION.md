# R32 — Refund eligibility and durable recovery

## Scope and current state

R32 implements provider-subscription refunds over the accepted R24 financial
authority and frozen rail/confirmation-participant ports. Delivery mode is A:
backend correctness and integration. The implementation is locally verified;
assembled Wave 3 rail acceptance remains INTEGRATION_PENDING, POLICY_BLOCKED
and EXTERNAL_BLOCKED. No live money, payout, escrow, identity decision, account
grant, merge or deployment is authorized by this work.

| Identity                                          | Value                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Branch                                            | `feat/r32-refund-recovery`                                                                     |
| Session                                           | `r32-20261023-1db81624b1de`                                                                    |
| Initial checkout / frozen G2 source               | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                                                     |
| Frozen source tree                                | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                                                     |
| Owner-merged publication / PR comparison baseline | `986b4707776711e80564f0642133ede90ba16f3c`                                                     |
| Publication tree                                  | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                                                     |
| Public contract                                   | `hsm.money.v1`, unchanged                                                                      |
| Schema/migrations                                 | Accepted 72-migration history; no schema or migration change                                   |
| Final commit and complete tree                    | Bound to the PR's exact Final SHA and Production governance source artifact; see ACCEPTANCE.md |

The assigned branch began at the frozen source. Before the first R32 commit,
the coordinator advanced its unpublished history to the already owner-merged
G2 publication. The intervening 13 paths contain documentation/evidence only.
The checkpoint covered 39 changed tracked/untracked files and verified every
working-file SHA-256 was unchanged. No merge commit, rebase, force push,
unmerged peer import or write to `develop` occurred. This preserves the frozen
implementation source and satisfies R27's unchanged PR-base ancestry gate.
See [OWNERSHIP.md](OWNERSHIP.md) and
[CR-001](shared-change-requests/CR-001-integration.md) for the exact leases.

## Existing authorities and bounded changes

`MoneyCommandService` remains the only refund command/transaction owner.
`LedgerService.post` remains the posting authority. R32 adds policy evaluation,
durable delivery orchestration, redacted operator recovery and composition;
it does not introduce another ledger, payment state machine or refund table.

| Area                         | Files / responsibility                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Eligibility                  | `refunds/refund-eligibility.policy.ts` and adjacent tests: approved immutable policy source, original obligation, fresh actors and capacity     |
| Delivery                     | `refunds/refund-orchestrator.service.ts`, `recovery/refund-outbox.consumer.ts` and adjacent tests: R22 delivery plus bounded recovery discovery |
| Operator surface             | `recovery/refund-recovery.service.ts`, `refunds/refund.controller.ts` and tests: scope/revision, dry-run, approval, audit and redaction         |
| Composition                  | `refunds/refunds.module.ts` and test; leased MoneyModule/AppModule files bind existing authorities and register one consumer                    |
| Operator CLI                 | `scripts/production/refund-recovery/inspect.cjs` and test: protected credentials and authenticated real HTTP                                    |
| Shared financial integration | Leased `application/money-command.service.ts` and test: atomic outbox, claim semantics, confirmed consequence, reversal fence and safe errors   |
| Real service regressions     | Dedicated R32 integration spec; leased R24 fixture and regression spec preserve prior invariants and supply an explicit consequence component   |
| Governance/evidence          | Six R32 evidence files and the exact leased post-R18 records; accepted-source identities and historical results remain intact                   |

The complete exact path list is in OWNERSHIP.md. No root dependency manifests,
lockfile, shared public contract, R15 ledger implementation, schema/migration,
CI workflow, frontend or sibling lane implementation is modified.

The first PR performance run exposed R21 mail-worker statements in R27's
database-wide request captures. The coordinator's additional R32-CI-01 lease
covers exactly the fixed measurement environment and its runtime regression
test. It adds the missing `MAIL_DISPATCHER_ENABLED=false` alongside existing
worker switches for every measured source. Production behavior, immediate OTP
mail and the original query/bundle budgets are unchanged. ACCEPTANCE.md retains
the failed run and artifact evidence; this brings the authorized diff to 39 files.

## Eligibility from an explicit policy

The default `REFUND_POLICY_SOURCE` returns no policy. A configured source must
resolve through the caller's Prisma transaction and retain immutable policy
versions for later confirmed-result recovery. The evaluator requires explicit
approval/version, plan version, method, SANDBOX scope, currency, reason codes,
window, partial-refund permission, separation requirements and entitlement
policy version. An unlimited window is an explicit `null`, never a default.

The currently supported fee/tax/pro-rata options are accepted only when
explicitly supplied: `NO_DEDUCTION`, `NO_ADJUSTMENT`, and `NONE`. They are
implementation capabilities, not commercial decisions. Other models fail
closed. No policy seed or production configuration is supplied.

Before reservation the evaluator checks the immutable request, original paid
intent/confirmation, posted ledger transaction, subscription period, provider
ownership, currency/amount consistency, unresolved original exceptions,
requester and reviewer permissions, active role membership, configured actor
separation and PostgreSQL time. The command owner locks the original payment
confirmation through the reserved-capacity sum and insertion. RESERVED,
DISPATCHED and SUCCEEDED amounts consume capacity; pending/unknown transport
does not free it. R24 and database invariants independently enforce the cap.

## Durable dispatch and ambiguous outcomes

Reservation, request authorization, MoneyDispatch, immutable MoneyCommand,
audit and `money.refund.dispatch-requested.v1` commit atomically. The outbox
payload contains only refund/command identifiers; its aggregate is MoneyRefund
and its dedupe key is bound to that command. Provider calls occur after commit
and outside financial locks.

The R22 handler returns an afterCommit accelerator. A separate bounded scanner
of unresolved existing MoneyDispatch rows covers a lost callback, a processed
outbox event, a restart or an expired claim. It uses the existing
`OUTBOX_WORKER_ENABLED` switch, a five-second interval, a default batch of 10
(maximum 25), and an ID cursor so blocked older rows do not starve newer work.
Multiple replicas may discover a row; the database claim admits one active
attempt. Shutdown waits at most five seconds for its current batch. Transport
adapters must still enforce their own request deadlines.

The preclaim state determines the operation. A never-dispatched record may
submit; PENDING, UNKNOWN, previous claim, external reference or observation
requires query. Every attempt keeps the original provider idempotency key.
An explicit durable QUERY command is always query-only. Scanner recovery uses
the latest applicable immutable delivery command, so an authorized reviewer B
can recover after reviewer A is revoked even if both callbacks were lost.
Fresh reviewer authority is checked before every attempt.

A timeout, malformed/misbound result or lost response remains ambiguous.
No timeout cancels a refund, expires its reservation, issues a new outbound
key or declares failure. A validated terminal observation is persisted before
the local completion transaction. Late PENDING/UNKNOWN observations cannot
erase terminal proof. Stored proof can complete locally during an adapter or
configuration outage without making another external request.

## Result-driven accounting and consequences

Only validated authoritative SUCCEEDED proof posts compensation. R32 uses the
existing independent `r24_compensate_...` key and a linked STANDARD transaction
with the partial amount and opposite original sides. It does not modify the
original posted entries or reuse the full REVERSAL primitive.

The original confirmation, refund and original ledger posting are locked in
that order. After obtaining the original posting lock, a separate query checks
for a full reversal; this observes a reversal that committed while the lock
was waiting. The lock conflicts with the existing R15 reversal trigger and
remains held through compensation, the frozen confirmed-refund participant,
refund/dispatch finalization and audit. The same original-state check runs in
a short preflight before the first outbound submission.

The confirmed-refund participant receives the captured policy version,
request/payment/refund identifiers, exact amount and compensating posting ID
inside the same PrismaTx. Missing configuration blocks initial execution.
Consequence or audit failure rolls back local completion and preserves the
earlier rail proof and reservation. A successful rail result blocked by an
original reversal/exception records one audited existing
REFUND_WITHOUT_COMPENSATION exception; no destructive history edit occurs.
See RISKS.md for a later independent full reversal after completed compensation.

## Operator API and CLI

| Route                                                                 | Authority                                                   | Behavior                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /v1/money/review/refunds/:id/recovery?paymentConfirmationId=...` | JWT, active admin, fresh `money:review:read`                | Audited, payment-scoped inspection                             |
| `POST /v1/money/review/refunds/:id/recovery`                          | JWT, active admin, fresh `money:refund:review`, cookie CSRF | Audited dry-run by default; explicitly approved QUERY/DISPATCH |

Execution requires the inspected state revision, original payment scope,
bounded approval reference and caller idempotency key. New-command revision
fencing and approval audit run inside the core command transaction. An exact
retry retains its original immutable approval/revision; fresh permission checks
still precede replay. The approval reference is provenance, not a permission
grant. There is no HTTP endpoint for asserting a provider result.

Inspection distinguishes reserved, pending, ambiguous and confirmed outcomes.
Valid persisted terminal proof with incomplete local accounting returns
`LOCAL_COMPLETION_REQUIRED`; it does not claim financial completion. No response
contains provider keys, account references, raw proof, command payloads or raw
errors. Unexpected command/audit/storage errors are safe typed INTERNAL_ERROR
responses, including in non-production environments.

The CLI defaults to audited dry-run and has an explicit `--inspect-only` mode.
It accepts credentials only from an owner-only regular file, refuses symlinks,
header injection and disabled TLS verification, uses HTTPS or literal-loopback
HTTP, disables redirects, bounds response sizes/timeouts and never retries
automatically. A lost execution response is AMBIGUOUS. Exact retries preserve
the supplied revision/key/approval so the core can identify the original command.

```bash
node scripts/production/refund-recovery/inspect.cjs \
  --api-url https://api.example.test/v1 \
  --credential-file /private/operator.json \
  --refund-id REFUND_ID \
  --payment-confirmation-id CONFIRMATION_ID \
  --inspect-only
```

Credential/approval values, command keys and provider references are never
printed. The CLI requires actual authenticated API responses; it fabricates
neither success nor a financial state.
