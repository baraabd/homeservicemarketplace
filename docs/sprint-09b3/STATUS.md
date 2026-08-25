# Sprint 9B.3 — restricted evidence upload: STATUS

Resume point for a new session. A new session should be able to continue from
this file without re-deriving anything.

Design and threat model: `RESTRICTED_EVIDENCE_UPLOAD.md` beside this file.

## Branch and baseline

- Branch: `feat/sprint-09b3-restricted-evidence-upload`.
- Base: `origin/develop` at `a51b1a6` (the 9B.2 squash-merge), which is the
  merge base — 0 behind, 15 commits ahead, 32 files changed.
- The LOCAL `develop` ref is stale at `4ca7136` and predates the 9B.2 merge.
  Measure against `origin/develop`; `git log develop..HEAD` locally reports 76
  commits, which is the staleness, not this sprint. Left alone deliberately:
  this branch does not update `develop`.
- The older `feat/sprint-09b-provider-verification-experience` remote ref still
  points at the pre-merge `e0e0697`. Deliberately NOT force-updated.
- Four user stashes untouched throughout.

## Commits (oldest first)

| SHA       | What                                                           |
| --------- | -------------------------------------------------------------- |
| `8d379bb` | evidence limits through `ADMIN_SETTINGS_SCHEMA` (7 tests)      |
| `309ddf7` | pure prepare/finalize policy (31 tests)                        |
| `d0449a7` | restricted storage abstraction + read-path repair (25 tests)   |
| `d89fd78` | schema for prepared uploads (2 migrations)                     |
| `2b304c0` | prepare / content / finalize services and routes               |
| `e924120` | end-to-end regressions (40 tests)                              |
| `258fc5b` | status checkpoint                                              |
| `9732d1e` | M4 — sweep abandoned evidence preparations (14 tests)          |
| `1ca053f` | M5 — HTTP-boundary proof that PENDING is unreadable (17 tests) |
| `449f44c` | fix the reverse-geocode race in the web drag test              |
| `ddb2edd` | correct the stated grace period (300s, not 60s)                |
| `0c175b0` | M5 — evidence log/PII hygiene gate (7 tests)                   |
| `9ab9124` | design doc + this checkpoint                                   |
| `f6a8445` | own the S3 source stream when an upload fails (3 tests)        |
| `4b7f209` | race-free directory enumeration in the guardrail (+1 test)     |

## CI round two — what `9ab9124` got wrong

The first pushed SHA failed CI in `Verify API`:

```
FAIL test/e2e/admin-verification.e2e.spec.ts
ENOENT: no such file or directory, open '/tmp/hsm-stage-.../staged.bin'
```

An admin authentication suite blamed for a storage adapter's file handle. It
was simply the suite running when someone else's stream finally touched disk.

`S3RestrictedStorageAdapter.putObjectFromFile` built its body inline as
`Body: createReadStream(sourcePath)`. `createReadStream` schedules its `open()`
immediately, so the stream touches the file whether or not anyone reads it.
When `send()` REJECTS BEFORE consuming the body — which the contract suite
deliberately simulates — the stream is orphaned: unread, undestroyed, and
carrying no `'error'` listener. The contract suite's `afterAll` then removes the
staging directory, the pending open finds nothing, and an `'error'` event with
no listener is an uncaught exception in whatever is running next.

Fixed in `f6a8445`: the stream is a named local, destroyed in a `finally` on
both paths, with a listener so a late fs error on a stream nobody is reading
cannot take the process down. Still streaming, still O(chunk) — no `readFile`,
no Buffer, no delay, no retry, no global handler. Pinned by
`s3-restricted-storage.stream-ownership.spec.ts`, whose second test reproduced
the exact CI `ENOENT` (and killed the worker) before the fix.

CodeQL alert #7 `js/file-system-race` was raised on the same file: the walker
called `readdirSync(dir)` then `statSync(full)` — a check/use pair with a
window between them. Fixed in `4b7f209` with a single
`readdirSync(dir, { withFileTypes: true })` enumeration, which also stops the
walker following symlinks out of the audited tree (`statSync` follows them,
`Dirent` does not). Resolved by code, not dismissed; a second test proves the
guardrail still detects a planted offending import.

Note for a future session: `canonical-axes.spec.ts:59` carries the identical
`statSync(full).isDirectory()` pattern. CodeQL has not flagged it and it was
left untouched as out of scope, but it is the same latent defect.

## Test counts

| Point                           | Suites  | Tests                |
| ------------------------------- | ------- | -------------------- |
| Recovered baseline              | 136     | 2145                 |
| At `0c175b0`, DB+Redis gates ON | 142     | 2259                 |
| At `4b7f209`, hermetic          | **143** | **2077 + 186 gated** |

The hermetic figure is the one measured locally against the final SHA: 128
suites passed, 15 DB-gated suites skipped by their `RUN_DB_INTEGRATION` gate,
0 failed. The gated run for the final SHA is green in CI's
`Integration & E2E (real Postgres / Redis)` job rather than re-measured here.

0 failed, 0 unjustified skips, normal workers, and — checked explicitly after
`f6a8445` — 0 forced-worker-exit warnings and 0 `staged.bin` ENOENT lines.

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

**Cleanup grace is 300 seconds.** A finalize that passed the expiry check
microseconds earlier is still doing a `head()` plus a database write; sweeping
at the instant of expiry would delete the object underneath it.

## Work status

### M4 — cleanup / compensation sweep — DONE (`9732d1e`)

`EvidenceCleanupService.sweepExpiredPreparations()`: bounded batches (default
100, max 500), object deleted FIRST then the row claimed conditionally so two
concurrent sweeps delete once and report once. Refuses finalized, already
deleted, no-expiry, in-grace, `PUBLIC`, and other-case assets. Tolerates an
already-missing object; a storage failure leaves the row for the next run. No
HTTP route. 14 integration tests including forced storage failure, retry, and
concurrent sweeps.

### M5 — privacy and boundary proof — DONE (`1ca053f`, `0c175b0`)

17 HTTP-boundary tests: `PENDING`, `QUARANTINED` and `SCAN_FAILED` unreadable
(including by the owner), cross-owner refused, reviewer-without-permission
refused, revocation honoured between requests, unknown id answered exactly as a
forbidden one (no existence oracle), audit rows for both ALLOWED and DENIED, no
full IP or raw user agent recorded.

7 log-hygiene tests capturing every Nest `Logger` and `console.*` write during
real HTTP flows, over the success path AND the failure paths (rejected bytes,
denied read, sweep whose storage delete throws a raw driver error naming the
object). Scans for storage key, sha256, filename, owner id, storage root,
document body, and credential-shaped material. Two anti-vacuity anchors: a
tripwire that plants a known string through the same logger and requires the
scan to find it, and the sweep test asserting its warn line IS present while the
key inside the thrown error is not.

### M6 — local gates — DONE

Every CI-equivalent gate below was run locally against this branch's content.
See "Gate results" for exact numbers.

Docs: `RESTRICTED_EVIDENCE_UPLOAD.md` covers storage architecture, the upload
sequence, streaming and size enforcement, scan-state semantics, the
authorization model and non-enumerating 404s, audit and PII prohibitions, the
cleanup/compensation design, the threat model before/after, tests mapped to
threats, 9B.4 scanner responsibilities, and the rollback plan.

## Gate results

| Gate                                             | Result                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| API suite, DB+Redis gates ON                     | 142 suites / 2259 tests / 0 failed / 0 skipped          |
| API hermetic (gates OFF)                         | 127 passed / 15 gated suites skipped                    |
| API lint / typecheck / build                     | pass                                                    |
| Web unit                                         | 64 files / 676 tests                                    |
| Web lint / typecheck / build                     | pass (32 pre-existing warnings, 0 errors)               |
| Playwright browser E2E                           | 246 passed                                              |
| Auth-cookie contract (real browser)              | 8 passed                                                |
| Contracts build                                  | pass                                                    |
| Database validate/generate/tc/build              | pass                                                    |
| Migration drift vs schema.prisma                 | PASS (empty migration)                                  |
| `verify:migrations` harness                      | ALL CHECKS PASSED                                       |
| Fresh database migrate:deploy                    | 41 migrations applied                                   |
| Production boot (host, built dist)               | health/live ok, health/ready postgres+redis up          |
| Evidence routes in the real graph                | 4/4 registered (401 at the guard; control is 404)       |
| Docker cold build (`--no-cache`)                 | pass                                                    |
| Docker production boot                           | healthy, ready, uid 100 (non-root), no MODULE_NOT_FOUND |
| Docker graceful SIGTERM                          | exit code 0                                             |
| Compose smoke (ISOLATED project)                 | 29 assertions passed                                    |
| `pnpm audit --prod --audit-level high`           | No known vulnerabilities found                          |
| Trivy image scan (CRITICAL/HIGH, ignore-unfixed) | exit 0, none                                            |
| Gitleaks full history                            | 10 findings, all pre-existing (see below)               |
| Lockfile `--frozen-lockfile`                     | pass                                                    |
| Prettier over changed files                      | all 26 clean                                            |

## Pre-existing conditions — NOT introduced by this branch

**Dev-tree audit advisories.** `pnpm audit` over the full tree reports
`{low:6, moderate:22, high:28, critical:1}` across vite, postcss, tar, undici,
brace-expansion and friends. All dev-only; the blocking gate is `--prod`, which
reports zero. This matches the baseline documented in `ci.yml`.

**Gitleaks findings.** 10 `generic-api-key` hits, all dummy secrets in existing
spec files. Every one lives in a commit that is an ancestor of the base
(`6d63dc35`, `f3cce56e`, `37c90005` — April to August). This branch introduces
**zero** new findings; the new log-hygiene spec's `AKIA` regex does not trigger.

**Repository-wide `format:check`.** 793 files fail `prettier . --check`. This is
a pre-existing CRLF/baseline condition and is NOT a step in any CI workflow —
`ci.yml` and `reusable-verify.yml` run lint/typecheck/test/build only. Do not
mass-format; all 26 files changed by this branch are Prettier-clean.

## Environmental interference — resolved

A stray container `docker-api-1` (image `hsm-api:dev`, compose project
`docker`, created 2026-08-25 11:11 UTC) was running a **real** API against the
shared dev Postgres. Its outbox worker polls the same queue the
`outbox.integration.spec.ts` suite uses, claimed that suite's `test.parallel`
events, found no handler registered for them, and dead-lettered them — 75 DEAD
against 45 PROCESSED. The container's own logs show exactly 75
`outbox.no_handler` lines for `test.parallel`, matching the failure count.

This was NOT a defect in this branch and NOT a test-isolation defect: the suite
takes an exclusive advisory lock, which cannot exclude a separate OS process.
The suite passes 21/21 alone. `OUTBOX_WORKER_ENABLED` defaults to `true`
(`env.schema.ts`), which is why an idle dev container is enough to do this.

Resolved by stopping only that container, with the user's authorization. It is
currently `exited (0)`. Postgres, Redis, Mongo, Mailpit and all 15 volumes were
verified untouched before and after.

To restart it when convenient:

```
docker start docker-api-1
```

Re-running the API suite while it is up will reproduce the outbox failure. Stop
it again, or run the API gates with it down.

## Compose smoke — how to run it SAFELY

`scripts/ci/compose-smoke.sh` ends with `docker compose down -v
--remove-orphans` and derives its project name from `infra/docker`, which is
**the same project as the developer's running stack**. Run as-is on a developer
machine it destroys `docker_postgres_data`. It has already done so once in this
project; the dev database had to be rebuilt from migrations + seed.

It was run for this sprint against an isolated copy instead:

- a generated compose file with every `container_name:` removed (those are
  absolute and would collide with the running stack) and host ports remapped to
  55432 / 57017 / 56379 / 51025 / 58025, API on 4002;
- project name `hsmsmoke9b3`, so its volumes are `hsmsmoke9b3_*` and `down -v`
  can only reach them;
- the script's hardcoded `MAILPIT=http://localhost:8025` repointed at the
  isolated mailpit.

Result: 29 assertions passed; `docker volume ls` was byte-identical before and
after; the dev database still held its data.

The generated files were temporary and are not committed. Hardening the real
script so it refuses to tear down the default developer project is a worthwhile
follow-up and is **not** part of this sprint.

## Blockers

None external.
