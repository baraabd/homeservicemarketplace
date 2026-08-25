# Sprint 9B.3 — restricted evidence upload: STATUS

Resume point for a new session. A new session should be able to continue from
this file without re-deriving anything.

## Branch and baseline

- Branch: `feat/sprint-09b3-restricted-evidence-upload`, created from `309ddf7`.
- Base: `a51b1a6` (PR #42 squash-merge of 9B.2 into `develop`). 0 behind.
- The older `feat/sprint-09b-provider-verification-experience` remote ref still
  points at the pre-merge `e0e0697`. Deliberately NOT force-updated.
- Four user stashes untouched throughout. Worktree clean.
- Nothing pushed yet. No PR yet.

## Commits (oldest first)

| SHA       | What                                                         |
| --------- | ------------------------------------------------------------ |
| `8d379bb` | evidence limits through `ADMIN_SETTINGS_SCHEMA` (7 tests)    |
| `309ddf7` | pure prepare/finalize policy (31 tests)                      |
| `d0449a7` | restricted storage abstraction + read-path repair (25 tests) |
| `d89fd78` | schema for prepared uploads (2 migrations)                   |
| `2b304c0` | prepare / content / finalize services and routes             |
| `e924120` | end-to-end regressions (40 tests)                            |

## Test counts

| Point              | Suites  | Tests    |
| ------------------ | ------- | -------- |
| Recovered baseline | 136     | 2145     |
| Now                | **138** | **2210** |

All green, 0 skipped, normal workers, real Postgres + Redis.

## Decisions already made (do not relitigate)

**Scan state.** A newly uploaded, unscanned object is `PENDING`, never
`QUARANTINED`. `QUARANTINED` means "failed scanning" and carries the longest
retention as attack evidence; stamping it on an unscanned file fabricates a
verdict and holds an innocent provider's passport under the malware policy.
`PENDING` already delivers the guarantee — `evidence-read.policy.ts` denies
anything not exactly `CLEAN`. Pinned by `evidence-upload-policy.spec.ts`.

**Storage.** `RestrictedObjectStoragePort` is a SECOND, narrow port, not more
methods on `StoragePort`. `StoragePort` is browser-direct URLs; restricted
evidence must never produce a URL, so the port has no method that could make
one. Both backends selected by the same `STORAGE_DRIVER`. Local defaults to
`.restricted-uploads` (sibling of `.media-uploads`, not a child); S3 defaults to
`S3_RESTRICTED_BUCKET`.

The 9A defect — `evidence-read.controller` injecting `LocalDiskStorageAdapter`
and calling `absolutePathForKey()`, broken under `STORAGE_DRIVER=s3` — is FIXED
and guarded by an architecture test that fails if any file under
`provider/verification` imports the local adapter again.

**Migrations are forward-only.** `20260825120000` was already applied when the
slot design settled, so the extra columns went into `20260825123000` rather than
being appended. Prisma identifies an applied migration by NAME; appending left
the schema half-built while `migrate status` said "up to date".

## Remaining work

### M4 — cleanup / compensation sweep — NOT STARTED

Expired, non-finalized preparations must have their staged/promoted objects
deleted, idempotently, in bounded batches, tolerating "already missing", never
touching finalized documents or another case's objects. No public endpoint.
Query shape is ready: index
`MediaAsset(verificationCaseId, uploadCompletedAt)` plus `uploadExpiresAt`.

Note: in-request compensation already exists and is tested — if the object
lands and the row update fails, the object is deleted before the error
surfaces. M4 is the periodic sweep for uploads simply abandoned.

### M5 — remaining tests — PARTIAL

Done: 40 integration/HTTP tests, 25 storage contract tests (both backends).
Missing: the repository's PII/log-scanning gate run against evidence success
AND failure paths; a test proving `PENDING` is unreadable through the real read
route (the policy unit test covers the rule, not the route).

### M6 — gates, docs, push, PR, CI — NOT STARTED

None of the 25 local CI-equivalent gates has been run for this branch beyond
API lint/typecheck/test and the database gates. Still to run: web lint /
typecheck / unit / build, Playwright, auth-cookie contract, Docker cold build
and boot, Compose smoke, dependency/secret/container scans, lockfile, format.

**Compose smoke warning.** `pnpm smoke:compose` ends with
`docker compose down -v --remove-orphans`. Run earlier in this project, it
DESTROYED the developer's local Postgres volume and the dev database had to be
rebuilt from migrations + seed. Run it only with an isolated project name and
disposable volumes, or in a throwaway environment.

Docs still to write: upload sequence, storage architecture, Local vs S3,
authorization model, non-enumerating 404s, MIME/signature/size controls,
scan-state semantics, temporary-object lifecycle, cleanup/compensation, audit
design, PII prohibitions, threat model before/after, tests mapped to threats,
9B.4 scanner responsibilities, rollback plan.

## Blockers

None external. The work is incomplete, not blocked.
