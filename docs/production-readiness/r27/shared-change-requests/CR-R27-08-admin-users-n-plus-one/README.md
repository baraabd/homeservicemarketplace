# CR-R27-08 — batch the admin user list's per-row reads (N+1)

- **Paths:** `apps/api/src/modules/admin/users/admin-users.service.ts`
  (`list` line 66, `toSummary` lines 300-304), plus a batched finder in
  `UserRepository` and `AdminAccessRequestRepository`
  (`apps/api/src/infrastructure/persistence/**`). These belong to the admin
  and IAM persistence owner.
- **State:** N+1 measured; after-state **not** measured.

## Measured

`GET /v1/admin/users` with 15 users on the page ran **52 statements** for
one request (`query-profile-baseline.json`, both phases). The breakdown:

- `SELECT UserRole ×15` and `SELECT AdminAccessRequest ×15`: two per row,
  from `toSummary()`;
- the user page query, the session and permission reads, and role lookups.

`list()` maps every row through `toSummary()` inside `Promise.all`. At the
maximum `limit=100` that is at least 200 per-row statements, started
concurrently, competing for the Prisma pool with every other request.

The page-size invariance probe (limit=5 vs limit=20) was implemented
afterwards, to make this a dataset-independent assertion. It could not run
locally (host memory; see `../../RISKS.md`), so the 52-for-15 count is the
measured evidence.

## Proposed change

1. `UserRepository.listRolesForUsers(userIds)`: one `userRole.findMany({
where: { userId: { in } }, include: { role: true } })`, grouped in memory.
2. `AdminAccessRequestRepository.findLatestByUserIds(userIds)`: one query
   returning the latest request per user. For example, `DISTINCT ON
("userId") … ORDER BY "userId", "createdAt" DESC` via `$queryRaw`, or a
   `findMany` ordered by `createdAt` desc and reduced in memory. Pick the
   form that keeps the existing ordering semantics.
3. `list()` calls both once per page; `toSummary(u, roles, latest)` becomes
   synchronous. The response shape and field semantics (including the
   "never requested" `null`) stay the same.

## Tests

- Unit: `list()` makes exactly one call to each batched finder, whatever the
  page size; the summaries are identical to today's for users with no
  roles, several roles, no request, and several requests (latest wins).
- `query-profile.mjs` page-size probe for "admin users": `bounded`, with the
  statement count independent of `limit`.

## Rollback

Revert; no schema change.
