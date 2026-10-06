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

| Outcome               | Meaning                                                                   | What the caller gets                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED_COMMITTED` | PostgreSQL acknowledged COMMIT                                            | the callback's value; only now is it final                                                                                                                                                                                                                                                                    |
| `CONFIRMED_ABORTED`   | the server rejected a statement or COMMIT; it rolled the transaction back | a rejection. A serialization conflict is the only classified abort: `P2034` at COMMIT or on a model query, which existing callers map to 409 so the user reloads and decides; on a raw statement Prisma reports it as `P2010` with `meta.code = '40001'`. Today's SERIALIZABLE callers use model queries only |
| `OUTCOME_UNKNOWN`     | the connection was lost while COMMIT was in flight                        | a rejection that is **not** `P2034`. HTTP returns the opaque 500 `INTERNAL_ERROR`, which claims neither success nor rollback                                                                                                                                                                                  |

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
(backend parked inside the deferred trigger) instead of a fixed delay. It
proves only that injected case: a backend terminated inside a deferred trigger
cannot have committed. It does not prove that every real connection loss
around COMMIT means nothing committed.

Positive controls keep the absence checks honest: T11 commits the same
operation afterwards and finds exactly one notification and one announcement
with the same `aggregateId` filter; the browser spec resolves the provider's
user id (fixture email → user → the booking's provider profile, exactly one
row) before the mutation, and the committed start adds exactly one
announcement with that actor.

T6 accepts exactly two classifications of the serialization failure:
`P2034`, or `P2010` with `meta.code = '40001'` (raised when the raw statement
on the test's synthetic table detects the conflict; reproduced locally).

Not covered by a new test here: T9 is the ledger case above; T10 (required
audit failure) and T12 (outbox recovery) rely on the existing R15/R17-B suites;
T13 is the browser case.

### Local evidence and the source it was taken on

All local runs: Windows 11, Node 24.21.0, pnpm 10.32.1, disposable PostgreSQL
16 / Redis 7 / Mailpit containers.

On `53e8f2c` (Prisma 6.12.0, before the dependency remediation):

- `database`, `api`, `web` typecheck and lint (web: 0 errors, 34 existing
  warnings); `migrate diff` empty; `migrate deploy`, seed and
  `verify:migrations` on a fresh database.
- API, all suites with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1`, four
  shards, two workers (host memory): 5431 passed, 33 skipped, **15 failed** of 5479. This run is **not green**. The failures are recorded as separate
  findings below; hosted CI on the same tree passed the full suite in its
  normal configuration (5446 passed, 33 skipped).

On `9cb2354` plus the uncommitted control edits that became the next commit
(Prisma 6.12.0 with the dependency remediation):

- full `pnpm install --frozen-lockfile` (not offline, scripts enabled);
  `security:audit:test` 39/39; `security:audit` and `security:audit:prod`
  0 of every severity (2026-10-06 14:14 UTC — advisory data changes over time);
- every consumer resolves the corrected versions (express → proxy-addr 2.0.8,
  pino-pretty → fast-copy 4.1.0, @tailwindcss/node → source-map-js 1.2.2,
  load-nyc-config 1.1.0 → js-yaml 4.3.2 → argparse 2.0.1; no lockfile
  reference to the old versions);
- compatibility probes against the installed packages, 21/21: Express
  `trust proxy` at 0/1/2 hops with an IPv4-mapped IPv6 hop (the API's
  `TRUST_PROXY_HOPS` mode), proxy-addr subnet trust for mapped addresses,
  `load-nyc-config` with `.nycrc.yml`, `.nycrc.yaml`, JSON, `package.json` and
  invalid YAML (rejected with `YAMLException`), pino-pretty and fast-copy on
  nested and circular values, source-map-js round trip and version rejection.
  The repository has no nyc config file and CI does not collect coverage, so
  CI itself does not exercise the YAML path;
- `api` typecheck, `web` `typecheck:e2e`, ESLint on both changed specs;
- `platform-transaction-commit.integration.spec.ts` 10/10 twice;
- API and web rebuilt on the new tree; the browser spec 1/1.

Not run locally: the Docker image build and boot (host memory); the hosted
_Docker cold build + production boot_ job builds the Alpine image.

### Separate findings (not caused by and not fixed by this change)

1. **Windows ENOTDIR** — `restricted-erasure.spec.ts` fails on Windows hosts,
   also on the baseline; green on Ubuntu CI. Environment-specific; owner: the
   restricted-media area.
2. **R17-B outbox timing, local only** — two B-1 cases failed intermittently on
   this host, also when the suite ran alone. Measured: PostgreSQL `now()` about
   250–320 ms behind the host clock. `availableAt` is stamped by the Prisma
   engine from the host clock (`@default(now())`); the claim compares it with
   the claiming transaction's start time (`NOW()`). That makes a just-written
   event briefly not due, which matches the symptom, but the causal link was
   **not proven** (no run with corrected clocks), and retry, lease, reclaim and
   dead-letter behaviour under skew was **not tested**. Open; owner: R17-B
   outbox.
3. **Parallel interference, local only** — `provider-journey` (11) and
   `onboarding-review-submit` (1) failed when sharded with other suites and
   passed alone (15/15, 51/51). The conflicting fixture, row, worker or lock
   was **not identified**. Passing alone does not make the interference
   harmless. Open; owner: provider onboarding/verification tests.
4. **Booking-start error UX** — after the rejected start the provider sees no
   explicit error message; the screen only does not claim success. Owner: the
   provider booking job-actions surface (R12 area). Not changed here.

## Rollout and rollback

Change set on this branch: the Prisma pin (`packages/database/package.json`
and lockfile), the dependency remediation (root `pnpm.overrides` and
lockfile), the tests, the CI step and these documents.

- Rollout: dependency changes only; regenerate the client (the Dockerfile and
  CI already run `prisma generate`).
- Rollback: revert the branch's merge commit (or the individual commits) and
  regenerate. No schema or data change to undo. Reverting the Prisma pin
  **reintroduces the silent false success**; reverting the remediation
  reintroduces the four advisories it removes.

## Post-merge gate

After the owner merges: fetch `origin/develop`, identify the merge SHA, confirm
`packages/database/package.json` pins 6.12.0 and the root overrides are
present, the lockfile resolves them, and the hosted _Integration & E2E_ and
_Phase 5 real-route_ jobs on that SHA executed (not skipped)
`platform-transaction-commit.integration.spec.ts` and
`platform-transaction-commit.real-api.spec.ts`. Only then is PLATFORM-TX-1
accepted and R17-C may change production code.
