# Sprint 2 — constraints, before and after

## Where the invariants lived

Every invariant below was already "enforced" before this sprint — in the
service layer, as a `SELECT` followed by an `INSERT` inside a transaction.
Under PostgreSQL's default READ COMMITTED isolation that pattern is not atomic:
two concurrent callers both read "nothing there" and both write. The check is
not wrong, it is simply not a constraint, and nothing below the service layer
knew the rule existed.

| #   | Invariant                                             | Before                                                                                                                                                     | After                                                                                                                                                              | On conflict             |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 1   | One live PENDING application per (provider, category) | Service-layer `findFirst`, then insert. Comment in `schema.prisma` said "enforced in the service layer"                                                    | `provider_category_application_one_pending_uniq` — partial UNIQUE on `("providerProfileId","serviceCategoryId") WHERE status='PENDING' AND "supersededAt" IS NULL` | Auto-remediated, logged |
| 2   | Email is unique                                       | `User.email @unique` — **case-sensitive**, so `A@x.com` and `a@x.com` were two accounts                                                                    | `user_email_lower_uniq` — UNIQUE on `LOWER(email)`                                                                                                                 | **Deploy aborts**       |
| 3   | One default address per user                          | `AddressesService` demoted the previous default in a transaction                                                                                           | `address_one_default_per_user_uniq` — partial UNIQUE on `("userId") WHERE "isDefault" IS TRUE AND "deletedAt" IS NULL`                                             | Auto-remediated, logged |
| 4   | One active bid per (provider, request)                | `BidRepository.findActiveBidForRequest`, then insert. Its own comment noted "the database has no partial-unique index on this and Prisma can't express it" | `bid_one_active_per_provider_request_uniq` — partial UNIQUE on `("providerId","requestId") WHERE status <> 'WITHDRAWN' AND "deletedAt" IS NULL`                    | **Deploy aborts**       |

The service-layer checks were all **kept**. They turn the common sequential
case into a clean 409 instead of a constraint violation, and they mean that
losing an index degrades the invariant rather than removing it. The database is
now the authority; the service is the friendly front for it.

### Why every predicate is partial or an expression

Each one has a case it must _not_ catch, and a plain `@@unique` would catch it:

- **#1** — a plain unique on `(providerProfileId, serviceCategoryId)` would
  permanently bar a provider from re-applying after a rejection.
- **#3** — without `"deletedAt" IS NULL`, a soft-deleted former default would
  occupy the slot forever and the user could never have a default again.
- **#4** — without excluding `WITHDRAWN`, withdraw-then-resubmit would break.
- **#2** is an expression index, because the rule is about `LOWER(email)`
  rather than about a column.

Both properties — that the constraint holds, and that the exclusion works —
are pinned by tests in `apps/api/test/integration/sprint02-constraints.integration.spec.ts`.

### The Prisma consequence

Prisma can express none of these. That has two effects, and both matter:

1. **`prisma migrate diff` ignores them entirely.** Verified empirically before
   any of this was designed: a probe migration containing a partial unique and
   an expression index still produced `-- This is an empty migration.` That is
   what lets the CI drift gate stay green with four unmanaged indexes in the
   database. (Sprint 7.3's `Conversation_bookingId_live_unique` already relied
   on the same property.)
2. **Prisma will never recreate them.** They exist only because these
   forward-only migrations created them, and a schema edit cannot restore one.
   `docs/sprint-02/ROLLBACK.md` covers what that means for a forward fix.

## Race-test results

All four invariants are driven with genuinely concurrent writers — `Promise.all`
over independent transactions against a real PostgreSQL 16. Awaiting them in
sequence would pass against the _old_ code and prove nothing.

| Race                                                    | Attempts | Winners | Result                                                       |
| ------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------ |
| Two simultaneous applications, same provider + category | 2        | 1       | Loser gets `409 CONFLICT`, not a 500. One live PENDING row   |
| Two simultaneous "make this my default address"         | 2        | 1       | Exactly one default remains                                  |
| Two simultaneous bids, same provider + request          | 2        | 1       | Seeker sees the provider once, at one price                  |
| Direct insert bypassing the service                     | 2        | 1       | `P2002` — the rule holds even for code that never learned it |

**The race test found a real defect.** The `P2002 → 409` mapping never fired:
against a real database Prisma reports `meta.target` as a **column list**
(`["providerProfileId","serviceCategoryId"]`), not the index name, and the
detector only understood the name form. The unit test passed because it
fabricated a `meta` shape PostgreSQL never emits. In production, any provider
who double-clicked Apply would have received an opaque 500. Both shapes are
pinned now, the real one first.

## Contract changes

`@homeservicemarketplace/contracts`:

| Change                                     | Kind                    | Notes                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProviderCategoryApplicationSummary`       | added                   | Provider's own view of an application. Deliberately narrower than the admin's `PendingCategorySummary` — no `providerProfileId`, no display name                                                                                                            |
| `ApplyForCategoryResponse`                 | added                   | `{ application }`. Does **not** return the profile: applying changes nothing about what the provider can do                                                                                                                                                 |
| `ListMyCategoryApplicationsResponse`       | added                   | `{ items }`, session-scoped, unpaginated                                                                                                                                                                                                                    |
| `ListMyCategoryApplicationsQuery`          | added                   | Optional `status` filter                                                                                                                                                                                                                                    |
| `ProviderProfileSummary.pendingCategories` | **optional → required** | An optional field that was never populated is indistinguishable from "nothing is pending", which is the exact distinction the Skills screen needs. Every profile response now carries it, empty array included                                              |
| `ProviderCategoryApplicationStatus`        | moved                   | Canonical declaration moved from `admin/category-applications/enums/` to `provider/profile/enums/`; the admin path re-exports it, so no consumer import moved. The row is a _provider's_ application — admin moderates that lifecycle rather than owning it |

`ProviderProfileSummary.serviceCategories` is unchanged in shape but changed in
meaning: it is now admin-granted only, and moves in response to an approval or
an explicit removal — never as a side effect of a profile PATCH.

### HTTP surface

| Method  | Path                                         | Status               | Notes                                                                                            |
| ------- | -------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `POST`  | `/v1/me/provider/categories/applications`    | added                | **201**, not 200 — applying is not being granted                                                 |
| `GET`   | `/v1/me/provider/categories/applications`    | added                | Session-scoped                                                                                   |
| `PATCH` | `/v1/me/provider/profile`                    | **behaviour change** | A `categoryIds` entry the provider does not already hold is now **403**. Removals still accepted |
| `PATCH` | `/v1/admin/category-applications/:id/review` | unchanged shape      | Now writes an audit record in the same transaction as the grant                                  |

The 403 is a breaking change for any client that sent a full desired category
set. The web app is updated in the same commit range; a third-party client
would need the same split.

## Migration evidence

`pnpm --filter @homeservicemarketplace/database verify:migrations` builds
throwaway databases and drives four scenarios. 29/29 checks pass:

- **A — empty database**: all five migrations apply; all four indexes exist
  with the expected predicates.
- **B — upgraded database with auto-remediable conflicts**: row counts
  unchanged before and after (nothing deleted); exactly one live PENDING
  application remains and it is the _earliest_; superseded rows keep
  `status='PENDING'` (no fabricated REJECTED decision) and point back at the
  survivor; a non-conflicting application in another category is untouched;
  exactly one default address remains and it is the most recently updated;
  every mutated row is in `DataRemediationLog` with its prior values.
- **C — email collision**: migration refuses, names the constraint, identifies
  the accounts **by id and not by email address**, leaves the index absent and
  both accounts intact.
- **D — duplicate active bids**: migration refuses, names the constraint,
  retracts nothing, leaves the index absent.

C and D assert the opposite property from B — that the migration _stops_. A
refusal that quietly degraded into "applied anyway" would be the worst outcome
of the four, so the failure path is tested as deliberately as the success path.
