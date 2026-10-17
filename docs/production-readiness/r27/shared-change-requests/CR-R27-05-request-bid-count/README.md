> **Current G1 continuation:** The current-source baseline reproduced this
> finding. The minimal runtime patch is now implemented under the exact
> lease in `../../G1_HANDOFF.json`; affected local tests pass. Fresh real-service
> baseline/after and browser evidence are pending in Draft #173. The earlier
> measurements and proposal below are retained as historical context.

# CR-R27-05 — count bids for the page, not the whole Bid table

- **Path:** `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
  (requests persistence owner). The `_count.bids` projections with a
  relation `where` are at lines 142-148 and 332-338.
- **State:** root cause measured; after-state **not** measured.

## Measured

Lane dataset: 10,836 requests, 43,344 bids, 5,418 bookings
(`query-profile-baseline.json`).

- `GET /v1/me/requests` runs 5 statements and spends **77.65 ms** of database
  time on one request. Every other profiled list spent under 30 ms, and most
  under 3 ms.
- Its generic plan is a `Seq Scan on "Bid"` (estimated 28,896 rows) feeding
  the count.

Prisma renders a filtered `_count` as a join to a grouped aggregate over the
related table. That aggregate is not limited to the page's request ids, so
its cost grows with the platform's total bids, not with the seeker's own
data. The statement count stays bounded (5 → 5), which is why a query-count
assertion alone does not catch this.

## Proposed change

Remove `_count` from the list `findMany`. After it, run one grouped count
limited to the page:

```ts
const counts = await db.bid.groupBy({
  by: ['requestId'],
  where: {
    requestId: { in: rows.map((r) => r.id) },
    deletedAt: null,
    status: { not: 'WITHDRAWN' },
  },
  _count: { _all: true },
});
```

Then map the counts onto the rows. This adds one statement, which stays
bounded and independent of page size. The existing
`@@index([requestId, status])` serves the scan. The wire contract
(`bidsCount`) and its meaning are unchanged.

## Tests

- Repository integration: `bidsCount` is identical for requests with 0 bids,
  1 bid, and withdrawn or deleted bids.
- `query-profile.mjs`: no `Seq Scan on Bid` for "seeker requests"; page-size
  invariance is `bounded`; DB time reported before and after on the same dataset.

## Rollback

Revert; no schema change.
