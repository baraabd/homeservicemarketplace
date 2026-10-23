# CR-001 — R32 serialized integration

Status: APPROVED_FOR_IMPLEMENTATION by the owner-delegated coordinator before
runtime edits. Exact files, writers and expiry are in `../OWNERSHIP.md`.

## Minimal patch and reason

1. Extend the existing MoneyCommandService, not a second financial authority.
   Reservation creates MoneyDispatch with its existing stable outbound key and
   an identifiers-only R22 outbox intent in the same transaction as request
   authorization, reserved capacity, command and audit. External I/O stays
   outside transactions. Recovery preserves the preclaim dispatch state so an
   uncertain/reclaimed operation is queried before any further action.
2. Invoke MONEY_REFUND_CONFIRMATION_PARTICIPANT only after authoritative success
   and the existing linked partial compensation, inside that same PrismaTx.
   Missing policy/participant or failed audit/consequence rolls back local
   success; durable verified provider evidence remains retryable.
3. Register the R32 policy, services/controller and outbox consumer in the one
   existing composition boundary. The consumer's after-commit accelerator is
   backed by bounded restart-safe discovery of unresolved MoneyDispatch rows.
   Defaults remain unavailable for unapproved policies, adapters and entitlement
   consequences. No live rail, payout, verification or work-access grant.
4. Extend the existing R24 HTTP fixture's exact port allowlist with the already
   frozen confirmed-refund participant. Preserve prior tests and add rollback,
   concurrency, authorization, ambiguity and duplicate-result regressions.
5. Recheck the original ledger posting before initial submission and before
   compensation, acquiring its row lock before a separate reversal read.
   Preserve authoritative proof when a subsequent reversal blocks local posting;
   use the existing REFUND_WITHOUT_COMPENSATION exception and audit authority.
   Resolve the latest applicable immutable reviewer command after callback loss,
   retaining the original dispatch/provider identity. Redact unexpected command
   failures; retain all rollback assertions and require private errors to be absent.

## Publication history authorization R32-G2-02

The coordinator authorizes an ordinary fast-forward of this unpublished branch
from frozen source `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644` to the already
owner-merged G2 publication `986b4707776711e80564f0642133ede90ba16f3c`, preserving
and verifying the complete working patch before the first R32 commit. Exactly
13 intervening documentation/evidence records differ, all already covered by
R32-G2-01. No executable source, dependency, schema, contract or CI changes are
imported. This satisfies the unchanged R27 PR-base ancestry check. It creates
no merge commit and changes neither `develop` nor the frozen-source identity.
The exact branch and checkpoint procedure are recorded in `../OWNERSHIP.md`.

## Verification and consequences

No dependency, lockfile, contract version, schema or migration changes are
requested. Preserve all existing financial identity/immutability constraints.
Run frozen install, formatting, affected lint/typecheck/unit/build, real
PostgreSQL/Redis route and recovery tests, security scans, full applicable
final-PR CI and official CodeQL. Record exact outcomes in `../ACCEPTANCE.md`.
UI/browser visual checks are not applicable to a backend-only change.

R29/R30/R31 imports from unmerged branches are prohibited. The assembled Wave 3
candidate supplies real transport and the approved transactional entitlement
participant; G3/R34 must establish cross-rail sandbox/accounting acceptance.

## Rollback

Disable the R32 dispatcher and configured ports before reverting source.
Retain reservations, dispatch keys, terminal observations, audit and immutable
ledger postings. Reconcile ambiguous external operations using their original
identity; never release capacity because of timeout or automatically reverse
posted history. No schema rollback is introduced.
