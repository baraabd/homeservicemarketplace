# Sprint 2 — rollback and forward-fix plan

Covers the five migrations added in `feat/sprint-02-provider-category-moderation`:

| #   | Migration                                                     | Kind                             |
| --- | ------------------------------------------------------------- | -------------------------------- |
| 1   | `20260822090000_sprint02_moderation_schema`                   | additive schema (Prisma-managed) |
| 2   | `20260822091000_sprint02_one_pending_category_application`    | constraint + auto-remediation    |
| 3   | `20260822092000_sprint02_case_insensitive_unique_email`       | constraint + refusal guard       |
| 4   | `20260822093000_sprint02_one_default_address_per_user`        | constraint + auto-remediation    |
| 5   | `20260822094000_sprint02_one_active_bid_per_provider_request` | constraint + refusal guard       |

## The stance

**These migrations are forward-only.** There are no `down` scripts, and adding
some later would be worse than not having them.

Three of the five are additive (a nullable column, a new table, new enum
values) and nothing needs undoing. The other two touched rows, and the honest
undo for those is not "drop the index" — it is "restore the rows to what they
were", which requires knowing what they were. That is exactly what
`DataRemediationLog` records, and it is why the recovery procedures below are
queries rather than a reverse migration.

`ALTER TYPE ... ADD VALUE` cannot be undone in PostgreSQL at all without
rebuilding the type and every column that uses it. Any `down` script claiming
to reverse migration 1 would be lying.

## What each migration does to existing data

| Migration | Touches rows? | If it finds conflicts                                                         |
| --------- | ------------- | ----------------------------------------------------------------------------- |
| 1         | No            | n/a                                                                           |
| 2         | Yes           | Collapses duplicate PENDING applications to the earliest; logs each one first |
| 3         | No            | **Aborts the deploy**                                                         |
| 4         | Yes           | Demotes all but the most recently updated default; logs each one first        |
| 5         | No            | **Aborts the deploy**                                                         |

The split is deliberate and is the main judgement call in this sprint.

Automatic remediation is used only where the change destroys nothing and no
human judgement is required. Demoting an address default flips one boolean —
the address, its label, and its coordinates are untouched, and the user can
re-pick in one tap. Collapsing a duplicate application marks the loser
superseded — it keeps `status = 'PENDING'`, which is what it honestly was, and
simply stops holding the queue slot.

Refusal is used where resolving a conflict means making a decision that belongs
to a person:

- **Email collisions** are two real accounts with their own sessions, bookings,
  bids, and history. There is no mechanical rule for which is "the" account.
  Picking one silently would either strand someone's history or hand one person
  another's.
- **Duplicate active bids** are live commercial offers. Retracting one changes
  what a provider has offered and what a seeker may accept, and can change who
  wins a job. Unlike a boolean, that is not undone by setting it back — a
  seeker may already have acted on what they saw.

Neither case may be decided by a migration at 3am during a deploy.

## Before deploying: the preflight

Run this against the target database **before** the deploy. It is read-only and
answers "will migration 3 or 5 stop the release", which is the only question
that matters for scheduling.

```sql
SELECT 'M2 duplicate PENDING applications (auto-remediated)' AS check, COUNT(*) AS groups FROM (
  SELECT 1 FROM "ProviderCategoryApplication"
  WHERE status = 'PENDING' AND "supersededAt" IS NULL
  GROUP BY "providerProfileId", "serviceCategoryId" HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'M3 case-insensitive email collisions (BLOCKS DEPLOY)', COUNT(*) FROM (
  SELECT 1 FROM "User" GROUP BY LOWER(email) HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'M4 users with >1 default address (auto-remediated)', COUNT(*) FROM (
  SELECT 1 FROM "Address" WHERE "isDefault" IS TRUE AND "deletedAt" IS NULL
  GROUP BY "userId" HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'M5 duplicate active bids (BLOCKS DEPLOY)', COUNT(*) FROM (
  SELECT 1 FROM "Bid" WHERE status <> 'WITHDRAWN' AND "deletedAt" IS NULL
  GROUP BY "providerId", "requestId" HAVING COUNT(*) > 1) x;
```

Non-zero on either BLOCKS row means the deploy will stop at that migration with
an actionable message. Resolve it first with the runbook below.

## Runbook — migration 3 aborted (email collisions)

The migration prints colliding **account ids**, never email addresses:
migration output lands in CI logs and those are not a place to spill a list of
real users' addresses.

1. List the affected accounts and how much history each carries:

   ```sql
   SELECT u.id, u."createdAt", u.status,
          (SELECT COUNT(*) FROM "Session" s WHERE s."userId" = u.id)         AS sessions,
          (SELECT COUNT(*) FROM "Booking" b WHERE b."seekerUserId" = u.id)   AS bookings,
          (SELECT COUNT(*) FROM "ServiceRequest" r WHERE r."seekerUserId" = u.id) AS requests
   FROM "User" u
   WHERE LOWER(u.email) IN (SELECT LOWER(email) FROM "User" GROUP BY 1 HAVING COUNT(*) > 1)
   ORDER BY LOWER(u.email), u."createdAt";
   ```

2. Decide, per pair, **with a human**. Usually one account is a typo-era
   duplicate with no activity; if both are active, this is a support
   conversation, not a data fix.

3. Apply the decision through the application where possible (account closure
   leaves the audit trail). Where a direct edit is unavoidable, soft-delete the
   redundant account rather than hard-deleting it — but note that migration 3's
   index is deliberately **unscoped**, matching the existing `User_email_key`,
   so a soft-deleted row still occupies its address. Re-key it explicitly:

   ```sql
   UPDATE "User"
   SET email = email || '.merged-' || to_char(NOW(), 'YYYYMMDD'),
       "deletedAt" = NOW()
   WHERE id = '<redundant-account-id>';
   ```

4. Re-run the preflight, then re-run the deploy.

## Runbook — migration 5 aborted (duplicate active bids)

1. List the affected pairs:

   ```sql
   SELECT "providerId", "requestId", COUNT(*) AS active_bids,
          array_agg(id ORDER BY "submittedAt") AS bid_ids
   FROM "Bid"
   WHERE status <> 'WITHDRAWN' AND "deletedAt" IS NULL
   GROUP BY 1, 2 HAVING COUNT(*) > 1;
   ```

2. Retract the surplus bids **through the application** — the provider's
   withdraw endpoint — so the parties are notified and the timeline records it.
   A raw `UPDATE ... SET status = 'WITHDRAWN'` silently changes a live offer and
   should be the last resort.

3. Re-run the preflight, then re-run the deploy.

## Recovery — undoing an automatic remediation

Every row an automatic remediation touched was written to
`DataRemediationLog` **before** it was changed, with its prior values in
`before`. Nothing was deleted, so recovery is an update, not a restore.

See what a migration did:

```sql
SELECT entity, "entityId", action, before, details, "createdAt"
FROM "DataRemediationLog"
WHERE migration = '20260822093000_sprint02_one_default_address_per_user'
ORDER BY "createdAt";
```

Restore demoted addresses (migration 4). Note this **re-creates the conflict**
the constraint forbids, so drop the index first and put it back afterwards, or
restore selectively for one user at a time:

```sql
-- inspect first; this will fail against the live constraint if two rows for
-- one user are restored at once, which is the constraint doing its job
UPDATE "Address" a
SET "isDefault" = (l.before ->> 'isDefault')::boolean
FROM "DataRemediationLog" l
WHERE l.entity = 'Address'
  AND l."entityId" = a.id
  AND l.migration = '20260822093000_sprint02_one_default_address_per_user';
```

Restore superseded applications (migration 2):

```sql
UPDATE "ProviderCategoryApplication" p
SET "supersededAt" = NULL, "supersededById" = NULL
FROM "DataRemediationLog" l
WHERE l.entity = 'ProviderCategoryApplication'
  AND l."entityId" = p.id
  AND l.migration = '20260822091000_sprint02_one_pending_category_application';
```

## Forward-fix — if a constraint turns out to be wrong in production

Do **not** edit an applied migration; Prisma records its checksum and a changed
file makes `migrate deploy` refuse to run at all. Write a new migration.

Dropping a constraint is a one-liner, and it is the right move if the
constraint is rejecting legitimate traffic:

```sql
-- new migration, e.g. 202608xxxxxxxx_relax_<constraint>
DROP INDEX IF EXISTS "address_one_default_per_user_uniq";
```

Two things to know before doing that:

- **Prisma will not notice.** All four constraints are partial or expression
  indexes, which Prisma cannot represent in `schema.prisma`. They are invisible
  to `prisma migrate diff` — which is what lets the CI drift gate stay green —
  and it also means Prisma will never recreate one for you. They exist only
  because these migrations created them.
- **The application-level checks are still there.** Dropping an index returns
  the invariant to being best-effort under concurrency; it does not disable it.
  The service-layer `SELECT`-then-`INSERT` guards were kept precisely so that
  losing a constraint degrades rather than breaks.

Blast radius if a constraint fires wrongly in production:

| Constraint                                       | Symptom                                                                 | Severity                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `provider_category_application_one_pending_uniq` | Provider sees "already applied" on a category they have not applied for | Low — mapped to a clean 409, no data at risk                         |
| `user_email_lower_uniq`                          | Registration rejected for an address that differs only in case          | Medium — blocks signup for affected addresses                        |
| `address_one_default_per_user_uniq`              | "Set as default" fails                                                  | Low — retryable, no data at risk                                     |
| `bid_one_active_per_provider_request_uniq`       | Provider cannot submit a bid                                            | **High — blocks revenue**; check for a stale non-withdrawn bid first |

## Verifying a deploy

```bash
pnpm --filter @homeservicemarketplace/database verify:migrations
```

Builds throwaway databases and drives all four scenarios: empty, upgraded with
auto-remediable conflicts, upgraded with an email collision, upgraded with
duplicate bids. It asserts both that the constraints get created and that the
refusals actually refuse — a refusal that quietly degraded into "applied
anyway" would be the worst outcome of the four, so the failure path is tested
as deliberately as the success path.

Post-deploy, confirm all four indexes exist:

```sql
SELECT indexname FROM pg_indexes WHERE indexname IN (
  'provider_category_application_one_pending_uniq',
  'user_email_lower_uniq',
  'address_one_default_per_user_uniq',
  'bid_one_active_per_provider_request_uniq');
```
