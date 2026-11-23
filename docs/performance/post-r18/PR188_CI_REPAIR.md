# PR #188 — isolated database cleanup correction

## Scope and ownership

Mode A, under the owner's request to repair the open PR and verify G3.
The coordinator assigns this session exclusive edits to:

- `apps/api/test/support/isolated-database.ts`
- `apps/api/test/support/isolated-database.spec.ts`
- this record

The existing dependency hold document remains in this PR. No application,
database schema, role grants, workflow, timeout or financial policy is changed.

## Observed failure

On source `ea1122178f631e29f769e5bf3c12cf8a7a6dc56f`, CI run
`40019069600`, job `120645522083`, all 16 R30 service assertions passed.
Suite teardown failed with PostgreSQL SQLSTATE `42501`: `DROP DATABASE ...
WITH (FORCE)` attempted to terminate a backend the non-superuser fixture owner
could not signal. The R30 browser step did not run in that failed job.

The fixture already closes its application and Prisma clients. A normal
`DROP DATABASE` preserves PostgreSQL's own background-worker handling and
refuses remaining client connections instead of attempting broad termination.
The precise identity of the transient backend was not captured in the failing
job; no claim is made that a specific worker was observed.

PostgreSQL 16 documents the permission boundary in
[DROP DATABASE](https://www.postgresql.org/docs/16/sql-dropdatabase.html).
The implementation's `TerminateOtherDBBackends` separately checks signaling
privileges when FORCE is used. This repair uses ordinary owner-authorized
database deletion after disconnecting owned clients; it does not add
`SUPERUSER` or `pg_signal_backend`, suppress cleanup errors or skip tests.

## Acceptance and rollback

With Node 24.21.0 and pnpm 10.32.1, all seven focused regression tests passed
twice. They verify disconnect-before-drop, exact created-database scope,
propagation of a refused drop, cleanup retries, migration/setup failures,
repeated disposal and refusal outside the non-production integration gate.
These are unit checks with mocked database clients, not real-service evidence.
The API TypeScript check and production build, changed-file ESLint and Prettier,
all 480 governance tests and the repository/baseline/G3 consistency validators
also passed. Jest reports its existing ts-jest `isolatedModules` deprecation.

PostgreSQL and Docker are unavailable locally. Final-source CI must rerun R30
service and browser evidence and all applicable checks. Earlier source results
remain historical.

Revert this test-helper correction if required; the prior FORCE-related
permission failure may recur. G3 remains blocked on R29, approved refund
policy/consequences and combined real-sandbox acceptance. R34 has not started.
