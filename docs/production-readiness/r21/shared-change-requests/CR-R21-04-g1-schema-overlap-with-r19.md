# CR-R21-04 — G1: merge R21's schema lease with R19's

| Field     | Value                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Paths     | `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/` (coordinator-owned) |
| Requested | 2026-10-14, R21                                                                                      |
| Blocks    | the Wave 1 integration candidate (G1), not R21's isolated branch                                     |
| Migration | none new; ordering of two existing lane migrations · Dependency: R19 (PR #159), not imported by R21  |

## Situation

`WAVE_01.md` (coordinator branch `coord/post-r18-g0`) gives R19 an exclusive
lease on `schema.prisma`. R21 also changes that file under a lease the owner
confirmed on 2026-10-14 (see `OWNERSHIP.md`). Two lanes therefore wrote the
same coordinator-owned file in Wave 1. That breaks single-writer ownership,
and the coordinator has to resolve it at G1.

The two changes are semantically disjoint:

| Lane            | Change to `schema.prisma`                                                                                                                               | Migration directory                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R19 (`fcdf1de`) | relations on `User`, `SupportTicket`, `ProviderProfile`, `MediaAsset`, `LedgerTransaction`; 9 `Money*` enums and 11 models appended after `LedgerEntry` | `20261014090000_r19_subscription_money_foundation` |
| R21             | 4 `Email*` enums and 3 `Email*` models appended after `LedgerEntry`; no relation to any existing model                                                  | `20261013120000_r21_email_delivery`                |

No model, enum, table, index or constraint name is shared. R21's tables do
not reference `User` or any money table.

## Expected integration conflict

Both lanes append at the same place (end of file, after `model LedgerEntry`),
so Git reports a textual conflict there. Resolution: keep both blocks
whole, R19's first and then R21's (or the other way round; Prisma does not
depend on order), with one blank line between them.

## Migration ordering

R21's directory timestamp (`20261013120000`) sorts **before** R19's
(`20261014090000`). Neither migration has been applied to any shared or
hosted database. If R19 reaches `develop` first, and any environment applies
it before R21 lands, R21's migration would become an earlier-named pending
migration. Prisma `migrate deploy` still applies it, but `migrate dev`
history checks and reviewers then see an out-of-order history.

Request: at G1, if R19 merges first, the coordinator renames R21's
directory to a timestamp after R19's (for example
`20261014100000_r21_email_delivery`) **before** any environment applies it.
The SQL is unchanged. Renaming an unapplied migration does not edit an
applied one.

## Verification at G1 (on the integrated candidate)

1. `prisma validate` and `prisma generate` succeed.
2. `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow>` reports an empty migration. This is the existing CI "Assert migrations and schema.prisma agree" step.
3. `migrate deploy` on a fresh database applies both lanes' migrations.
4. `r21-durable-mail` and `r21-mail-feedback` integration suites, plus R19's money suites, pass on the same candidate SHA.

## Related follow-up (not part of this CR)

The `account.payment_status` email template has no producer at base. R19
introduces payment intents and subscriptions. Wiring a payment-status
notification to R21's outbox handler is a separate, later change that the
owner must authorize. R21 does not consume R19 code.
