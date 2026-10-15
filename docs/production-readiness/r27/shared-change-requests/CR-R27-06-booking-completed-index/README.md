# CR-R27-06 — index the admin completed-bookings list

- **Paths:** `packages/database/prisma/schema.prisma` (`model Booking`) plus a
  new forward migration. This belongs to the coordinator's migration lane only.
- **State:** plan measured; after-state **not** measured.

## Measured

`GET /v1/admin/financials/bookings` is served by
`BookingRepository.listCompletedBookingsForAdmin`:

```sql
WHERE "deletedAt" IS NULL AND status = 'COMPLETED'
ORDER BY "updatedAt" DESC, id DESC
LIMIT n
```

Its generic plan is a `Seq Scan on "Booking"` (5,418 rows in the lane
dataset). `Booking` has indexes on `[providerId, status]`,
`[seekerUserId, status]`, `[requestId]` and `[deletedAt]`. None of them
serves this filter together with this order.

This is a read over booking rows. It does not touch the R15 ledger, amounts
or any money table.

## Proposed change

```prisma
@@index([status, updatedAt(sort: Desc), id(sort: Desc)])
```

Generate the migration with `prisma migrate dev` on a disposable database.
For a large production table, consider a hand-reviewed `CREATE INDEX
CONCURRENTLY` migration, following the repository's constraint-migration
checks (`verify:migrations`).

## Related observation (not measured)

The list pages with `cursor: { id }` while ordering by `updatedAt`, so a
booking updated during an admin's paging moves between pages. The lane had
0 completed bookings, so this page walk was not exercised. A
completed-booking fixture is needed before anything is claimed about it.

## Tests

- Forward migration, `prisma validate` and the drift check.
- `query-profile.mjs` with completed bookings in the dataset: no seq scan for
  "admin financial bookings".

## Rollback

Drop the index in a forward migration.
