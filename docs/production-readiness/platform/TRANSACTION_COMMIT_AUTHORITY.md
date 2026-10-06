# PLATFORM-TX-1 — Transaction commit authority

Status: **repaired on `fix/platform-transaction-commit-authority`, pending owner
merge.** Not accepted until the post-merge gate below passes on develop.

## The defect

With Prisma **5.22.0**, an interactive `$transaction` whose **COMMIT** is
rejected by PostgreSQL logs `prisma:error transaction failed to commit` and
then **resolves** with the callback's return value. Nothing was committed, but
the caller is told it was. Every `TransactionRunner` caller and every direct
`prisma.$transaction(async (tx) => …)` is affected.

The schema has no deferred constraints, so production exposure is a failure
that PostgreSQL can only raise at COMMIT: a serialization failure under
`SERIALIZABLE`, a deferred check added later, a storage or WAL error, or a
connection lost while COMMIT runs. Rare, but silent when it happens.

## Root cause

Upstream, not application code. `LibraryEngine.transaction('commit' | 'rollback')`
in `@prisma/client` 5.x only converted an engine response into an exception
when it carried a known error code; a COMMIT failure arrives as an unknown
error with only a `message`, which was dropped.

- Issue: prisma/prisma#17303 (unrecognized errors during interactive
  transaction commit).
- Fix: prisma/prisma#26166 "ensure also unknown errors during interactive
  transaction fail it properly", merged 2025-01-24, milestone **6.3.0**. It adds
  `else if (typeof response.message === 'string') throw new PrismaClientUnknownRequestError(…)`.
- There is no 5.x backport: 5.22.0 is the last 5.x release.

The application layers add nothing on top: `TransactionRunner.run` returns
`client.$transaction(fn, options)` unchanged, and no caller swallows its
rejection or retries automatically.

## Correction

`packages/database`: `prisma` and `@prisma/client` pinned to exactly
**6.12.0** (from `^5.22.0`), lockfile regenerated with the repository's pnpm,
client regenerated from the unchanged schema. No application source changed.

Why 6.12.0, not the newest 6.x:

| Candidate | Commit fix | Dependency audit                                                                                                                                  |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.22.0    | no         | clean                                                                                                                                             |
| 6.12.0    | yes        | clean (`security:audit`, `security:audit:prod`: 0 of every severity)                                                                              |
| 6.13.0 →  | yes        | **high**: `@prisma/config` pins `deepmerge-ts@7.1.5` exactly (GHSA-ggr8-5vv4-36mx, stack exhaustion). Every later 6.x and 7.x through 7.10.0 too. |

6.19.3 was tried first and passed every behavioural test, then failed the
production audit on that advisory. Forcing `deepmerge-ts@8` with an override
would change a major version Prisma pins exactly, with no compatibility
evidence; choosing the last version without the dependency avoids it. Prisma 7
was not considered: it is a new major with a different engine/adapter model.

Prisma 6 breaking changes checked against this repository:

- implicit many-to-many tables: none exist (no `_AB` join tables in migrations);
- `Bytes` returns `Uint8Array`: the only `Bytes` field, `User.mfaSecret`, is not
  read or written by application code;
- `NotFoundError` / `rejectOnNotFound`: not used;
- Node ≥ 18.18 and TypeScript ≥ 5.1: Node 24 locally, TypeScript 5.9.3.

`prisma migrate diff` between the migrations and the schema is still an empty
migration under the 6.12.0 CLI; no migration is added and no data is rewritten.

## Transaction outcome contract

| Outcome               | Meaning                                                                   | What the caller gets                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED_COMMITTED` | PostgreSQL acknowledged COMMIT                                            | the callback's value; only now is it final                                                                                                   |
| `CONFIRMED_ABORTED`   | the server rejected a statement or COMMIT; it rolled the transaction back | a rejection. A serialization conflict (`P2034`) is the only classified abort; existing callers map it to 409 so the user reloads and decides |
| `OUTCOME_UNKNOWN`     | the connection was lost while COMMIT was in flight                        | a rejection that is **not** `P2034`. HTTP returns the opaque 500 `INTERNAL_ERROR`, which claims neither success nor rollback                 |

- A callback's return value is provisional until the outer transaction ends;
  nothing may be sent, announced or acknowledged from inside it (R17-B's
  outbox announce already runs after commit).
- Nothing in the API retries a transaction automatically. That remains the
  rule: a non-idempotent command is never repeated after `OUTCOME_UNKNOWN`. A
  client that repeats a request relies on the existing idempotency records
  (for example the ledger's `(idempotencyKey, digest)`).
- No generic transaction journal was added; none is needed for this defect.

## Evidence

Disposable PostgreSQL 16 (`hsm-ptx-pg`, 127.0.0.1:45432), fresh databases per
suite where a suite asserts table-wide state. Before = Prisma 5.22.0, after =
Prisma 6.12.0, same test source.

| Layer | Test                                                                               | Before (5.22.0)                                                                 | After (6.12.0)                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | bare client, deferred trigger rejects COMMIT                                       | resolved with the callback value; 0 rows                                        | rejected `PrismaClientUnknownRequestError`; 0 rows                                                                              |
| 2     | `platform-transaction-commit.integration.spec.ts` (T1–T8, T11, T14)                | 6 passed, **4 failed**: T4, T8, T11, T14 resolved after a failed or lost COMMIT | 10/10, three consecutive runs                                                                                                   |
| 3     | `r15-ledger.integration.spec.ts` incl. caller-owned posting, outer COMMIT rejected | 36 passed, **1 failed** (the new case resolved)                                 | 37/37                                                                                                                           |
| 3     | `platform-transaction-commit.real-api.spec.ts` (built API, real login, Chromium)   | **HTTP 200**, body `IN_PROGRESS`, database still `SCHEDULED`                    | ≥ 500, no database detail on the wire, nothing stored, UI still offers Start Job after reload; then the real start commits once |

What each test proves is stated in the spec headers. T8 asserts the
`OUTCOME_UNKNOWN` contract (rejection, not `P2034`) and waits on a barrier
(backend parked inside the deferred trigger) instead of a fixed delay.

Not covered by an automated test here: T9 is the ledger case above; T10
(required audit failure) and T12 (outbox recovery) are covered by the existing
R15/R17-B suites rather than new ones; T13 is the browser case.

### Regression on 6.12.0 (local Windows host)

- Static: `database`, `api`, `web` typecheck pass; `api` lint clean; `web` lint
  0 errors, 34 warnings (none in changed files); Prettier clean on changed files.
- Dependencies: `pnpm install --frozen-lockfile` passes; `security:audit:test`
  39/39; `security:audit` and `security:audit:prod` 0 of every severity.
- Schema: `prisma migrate diff` empty; `migrate deploy`, seed and
  `verify:migrations` pass on a fresh database.
- API, all suites with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1`, four
  shards, two workers (host memory): 5431 passed, 33 skipped, 15 failed of 5479.
  None is attributed to the upgrade:
  - `restricted-erasure.spec.ts` (1): the known Windows-only ENOTDIR case,
    green on Ubuntu CI;
  - `r17-notifications.integration.spec.ts` (2, intermittent, also alone): this
    host's Docker VM clock runs about 0.3 s behind Windows. `availableAt` is
    stamped by the engine from the host clock and claimed against PostgreSQL
    `NOW()`, so a just-written event is briefly not due. Same behaviour on
    Prisma 5, which also stamps `@default(now())` client-side;
  - `provider-journey` (11) and `onboarding-review-submit` (1): failed only
    when sharded together with other suites; alone 15/15 and 51/51.
    Hosted CI runs the whole suite in its normal configuration and is the
    deciding evidence for these.
- Not run locally: the Docker image build and production boot (host memory);
  the hosted _Docker cold build + production boot_ job covers the Alpine image.

The clock-source mismatch (engine-side `now()` against database `NOW()`) is
recorded as a separate observation: in production it can only delay an outbox
event by the clock skew between API and database hosts, never lose it.

## Rollout and rollback

- Rollout: dependency change only; regenerate the client (the Dockerfile and
  CI already run `prisma generate`).
- Rollback: revert the commit and regenerate. No schema or data change to undo.
  Rolling back restores the silent false-success.

## Post-merge gate

After the owner merges: fetch `origin/develop`, identify the merge SHA, confirm
`packages/database/package.json` pins 6.12.0 and the lockfile resolves it, and
confirm the hosted _Integration & E2E_ job executed
`platform-transaction-commit.integration.spec.ts` on that SHA. Only then is
PLATFORM-TX-1 accepted and R17-C may start.
