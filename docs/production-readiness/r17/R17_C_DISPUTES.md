# R17-C — Dispute authority, concurrency and participant/admin journeys

Branch `feat/r17-c-dispute-authority`. Base
`develop@a8dc1a2c545805e409b0464d54faa9abb5f6d63a` (tree
`a37ca165e5691b5302b880d4243035a9ddb32a5e`). Policy sources:
`R17_C_DISPUTE_POLICY.md`. Command matrix: `R17_C_AUTHORITY_MATRIX.md`.

## Baseline gate (accepted before any change)

PLATFORM-TX-1 (#144) is merged as `a8dc1a2`. Push runs for that SHA:

| Workflow                            | Run id      | Jobs                          |
| ----------------------------------- | ----------- | ----------------------------- |
| CI                                  | 37520483563 | 17/17 success (incl. CI gate) |
| CodeQL                              | 37520482900 | 1/1 success                   |
| Production governance               | 37520483036 | 1/1 success                   |
| Web development startup             | 37520482968 | Windows + Ubuntu success      |
| Authentication lifecycle acceptance | 37520482902 | 1/1 success                   |
| Staging release boundary            | 37520482952 | 4/4 success                   |

Both PLATFORM-TX-1 specs executed. The integration spec passed in
_Integration & E2E_ (5446 passed, 33 skipped). The browser spec ran in
_Phase 5 real-route_, because the generic Playwright job skips it by design.
Prisma is pinned at 6.12.0 on develop.

Duplicate-work check: no R17-C branch, PR or worktree existed before this one.

## Results

| ID       | Finding                                                                                                                       | Result                                                                                                                                                      | Evidence                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1      | Two admins resolve the same legacy ticket concurrently: both succeed, second overwrites; a PATCH can reopen a resolved ticket | **REPRODUCED_DEFECT → FIXED**                                                                                                                               | Baseline: 3 race cases failed (both 200; final `IN_REVIEW` after a resolve). Fixed: one 200, one 409, one event/audit/notice/outbox (I, H, B) |
| C-2      | Legacy notice "resolved: refund" and admin labels `RESOLVED_REFUND` imply money moved                                         | **REPRODUCED_DEFECT → FIXED** (wording); stored enum values preserved                                                                                       | Baseline notice text captured by the I case; admin EN/AR labels in unit + browser                                                             |
| C-3      | Legacy admin `open` accepted any `openedById`; admin authority is role-only                                                   | opener: **REPRODUCED_DEFECT → FIXED**; role-only authority: **POLICY_BLOCKED** (decision 1)                                                                 | Baseline: an outsider was recorded as opener. HTTP: non-admins 403, missing CSRF 403, anonymous 401, revoked session 401                      |
| C-4      | Reviewer decisions write no `AuditEvent`; history immutability; legacy resolve copied free text into audit metadata           | free-text audit: **REPRODUCED_DEFECT → FIXED**; workspace audit: **ALREADY_CORRECT** under current policy; DB immutability: **POLICY_BLOCKED** (decision 4) | see C-4 below                                                                                                                                 |
| C-5      | Evidence reads not tied to case assignment                                                                                    | **POLICY_BLOCKED** (decision 2); participant/foreign/unscanned/erased paths **ALREADY_CORRECT**                                                             | existing `dispute-workspace.integration.spec.ts` (ClamAV); source read below                                                                  |
| C-6      | Intake/workflow windows unseeded                                                                                              | **POLICY_BLOCKED** (decision 3)                                                                                                                             | settings fail closed (existing intake spec "closes intake without a valid policy")                                                            |
| C-7      | Workspace journey (intake → decision → appeal → closure, EN/AR, 6 widths, axe, ClamAV)                                        | **ALREADY_CORRECT**; unchanged by R17-C, still executed in the same CI job                                                                                  | CI `dispute-workspace` job                                                                                                                    |
| B-4      | Provider-opener legacy notices linked into `/home/…` (seeker app)                                                             | **REPRODUCED_DEFECT → FIXED**                                                                                                                               | Deep link names the opener's experience. Shared resolver unit-tested for both. HTTP: the notice appears in the provider scope only            |
| B-13     | Intake notice and the dispute opt-out                                                                                         | **POLICY_BLOCKED** (decision 5)                                                                                                                             | unchanged                                                                                                                                     |
| C-8 (D4) | A second active ticket on a booking surfaced the unique-index error as a 500                                                  | **SOURCE_CONFIRMED_ONLY → FIXED** (409, no constraint text on the wire)                                                                                     | I + H. Not run against the baseline                                                                                                           |
| —        | Legacy routes reaching workspace cases                                                                                        | **ALREADY_CORRECT**: every legacy query filters `workspace IS NULL`                                                                                         | I + H: 404 on read and decide; workspace untouched                                                                                            |

### Root cause (C-1)

`AdminDisputesService.resolve` and `update` read the ticket with a plain
`findFirst`, checked its status in application code, then updated by id
unconditionally. Under READ COMMITTED, two transactions both read `OPEN`. The
second `UPDATE` waits for the first to commit and then overwrites it, so every
side effect is written twice.

**Fix.** `DisputeRepository.lockForDecision` locks `Booking` and then
`Dispute` (`FOR UPDATE`) and re-reads under the lock. It uses the same order
as intake and the workspace, so no path can deadlock against it. The second
admin waits, sees the terminal status and receives `409`. No schema change or
second concurrency layer was needed. The workspace already serializes through
`Booking → DisputeWorkspace` locks, `expectedRevision` and receipts.

### C-4 detail

- Legacy `ADMIN_DISPUTE_RESOLVED` metadata contained the free-text
  `resolution`. It now records `resolutionLength` with the ids and statuses.
  `AdminAuditService` writes through the repository without the IAM
  allowlist, so the service itself must keep metadata to ids. Older audit rows
  are not rewritten.
- Workspace decisions are recorded as actor-attributed, revisioned
  `DisputeWorkspaceEvent` rows, in the same transaction as the decision, with
  an outbox announcement. ADR-12A and Sprint 12C designate this durable event
  as the case's audit history. Evidence reads write `DISPUTE_EVIDENCE_READ`.
  No current repository rule requires a second `AuditEvent` per workspace
  command, so none was added (no duplicate audit trail).
- Immutability is application-level only. No code path updates or deletes
  workspace events. The database role **can**, and private-text erasure
  rewrites `rationaleCipher` on decision records by design. Database-enforced
  append-only history needs a retention decision first.

### C-5 detail

Evidence bytes are streamed only through the API; there is no signed or
public URL, so there is no post-issuance revocation gap. Authorization and the
audit row precede storage I/O and are re-checked after it. Participants read
their own originals and explicitly shared redacted derivatives only. Unscanned,
quarantined, erased or expired evidence is reported as not found. Reviewers
need `dispute:evidence:view`. Whether reviewers must also be **assigned** is
undecided, so nothing was broadened or narrowed.

## Real-service evidence (local, throwaway PostgreSQL 16 + Redis 7)

| Spec (`apps/api/test/integration/`)              | Level | Cases               | Baseline                                                               | After                         |
| ------------------------------------------------ | ----- | ------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `r17-disputes.integration.spec.ts`               | I     | 15                  | 14 run: **6 failed** (C-1 ×3, C-3, C-2, C-4), 8 passed; D4 added later | 15/15, three consecutive runs |
| `r17-dispute-legacy-http.integration.spec.ts`    | H     | 7                   | not run on baseline (written against the fix)                          | 7/7                           |
| `r17-dispute-legacy-browser.integration.spec.ts` | B     | 1 (5 checked steps) | —                                                                      | 1/1                           |

Notes on the I suite:

- **Synchronization.** A gate pauses each decision right after its read,
  inside its transaction. The second decision is released only once it is
  paused at the same read (baseline) or once PostgreSQL reports it blocked
  behind the first (`pg_blocking_pids`). No sleeps are used.
- **COMMIT failure (D15/D16).** A test-only deferred constraint trigger,
  scoped to the test's own dispute id, rejects the COMMIT. The caller is
  rejected and nothing persists: no status change, history, audit,
  notification, outbox row, decision or receipt. A clean retry then lands
  exactly once. For the workspace, the same idempotency key after a confirmed
  abort is a first execution (`replayed: false`), and a later retry replays.
- **Statement failure (D14).** An FK violation on the last write rolls back
  the status, event and audit rows.

HTTP suite (real AppModule, password/OTP sessions, guards, CSRF):

- anonymous 401, non-admin 403, missing CSRF 403;
- forged opener 400, unknown booking 404, duplicate active ticket 409;
- two admins concurrently: 200 + 409 with one set of side effects, and the
  same decision after a fresh login;
- the provider opener's notice is truthful and appears in the provider
  experience only;
- legacy routes return 404 for workspace cases;
- a session revoked by logout-all while the page is open gets 401 and no
  write;
- COMMIT rejected over HTTP: 5xx, no database detail on the wire, nothing
  stored, and the retry returns 200.

Browser suite (real Vite web, real login/OTP, no interception):

- decision outcomes are labelled as intent, never as executed refunds, and
  the raw enum never reaches the screen;
- the admin's decision is refused after another admin decided: `409`, a
  conflict alert that survives the authoritative read-back, the terminal
  state shown, no "Saved";
- a hard reload shows the committed decision;
- Arabic labels at 320/390/430/768/1024/1440 with no page overflow and zero
  axe violations (WCAG 2.2 AA tags) on the drawer.

Screenshots were inspected:

- `legacy-conflict-en-1440.png`: alert, terminal notice, "Decision: declined".
- `legacy-ar-390.png`: RTL drawer and labels.

Two local accessibility defects on this drawer were found by axe and fixed:

- the backdrop carried a prohibited `aria-label`; it is now `aria-hidden`;
- timeline timestamps used `slate-400` at 11 px, which failed contrast; they
  now use `slate-500`.

Regression, local:

- dispute suites (intake, workspace, decision boundaries, private lifecycle,
  HTTP, admin-disputes e2e and unit, platform COMMIT): 146 passed, 4 skipped.
  The skips are the browser and worker suites gated to the CI dispute job.

## Local preflight (Windows 11, Node 24.21.0, pnpm 10.32.1)

| Check                                                       | Result                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                            | pass                                                                                                                                                   |
| Prisma generate / migrate deploy / build / seed (fresh DB)  | pass                                                                                                                                                   |
| contracts build                                             | pass                                                                                                                                                   |
| API `tsc --noEmit` (src + test)                             | pass                                                                                                                                                   |
| API eslint (changed files)                                  | pass                                                                                                                                                   |
| API build                                                   | pass                                                                                                                                                   |
| API hermetic unit suite                                     | 4061 passed, 1444 skipped (DB-gated), **1 failed**: `restricted-erasure.spec.ts` ENOTDIR, the known Windows-only baseline failure (green on Ubuntu CI) |
| web `tsc -b`, `typecheck:e2e`                               | pass                                                                                                                                                   |
| web eslint (changed files)                                  | 0 errors; 1 pre-existing warning (`set-state-in-effect`, unchanged line)                                                                               |
| web vitest                                                  | 191 files, 2388 passed                                                                                                                                 |
| web build (`VITE_API_URL` as in CI)                         | pass                                                                                                                                                   |
| governance scripts `node --test .github/scripts/*.test.mjs` | 120 passed                                                                                                                                             |
| `production-governance.mjs`, `release-baseline.mjs`         | pass                                                                                                                                                   |
| dependency-audit policy tests                               | 39 passed                                                                                                                                              |
| `security:audit` / `security:audit:prod`                    | 0 findings at every severity                                                                                                                           |

Not run locally: the full gated integration suite (memory-constrained host;
see R17-B), Docker cold build, compose smoke, CodeQL and secret scan. These
are hosted CI evidence only.

## CI wiring

The _Dispute journey_ job (Postgres, Redis, ClamAV, Chromium) gets one new
step after the C-7 step, which is left unchanged:

- it runs the three R17-C specs;
- it fails closed unless exactly 23 cases pass with 0 failed, pending or todo;
- it uploads `r17c-dispute-real-evidence` (`if-no-files-found: error`): the
  jest JSON, screenshots, axe and overflow JSON. No cookies, tokens, traces or
  private evidence are uploaded.

The job timeout rose from 20 to 30 minutes for the extra step. The I and H
specs also run in _Integration & E2E_ automatically.

### Login budget shared by suites (found by hosted CI on `21ae5e8`)

The first hosted run failed the new HTTP and browser specs, and the existing
`dispute-workspace-http` spec, with `Login HTTP 429`. The cause was the tests,
not the product: login allows 10 attempts per minute per client IP, every
suite connects from 127.0.0.1 against one Redis, and the R17-C HTTP spec added
9 logins. The rate limit is unchanged. Instead:

- the R17-C HTTP spec now logs in 7 times;
- the shared test `login` helper and the browser child honour the server's
  `Retry-After` on a 429 (bounded to three attempts);
- the CI step runs the browser spec in its own invocation before the HTTP
  spec, and sums both reports for the fail-closed 23-case check.

## Schema, contracts, flags

No migration, no Prisma schema change, no contract change, no feature flag.
The legacy statuses keep their stored values.

## Known limitations

- Legacy admin tickets still authorize by role, not permission (decision 1).
- The legacy admin table at 320–430 px is cramped: identifiers wrap per
  character inside cells, though the page does not overflow. Timeline event
  types (`RESOLVED`, `OPENED`) are untranslated. Both are pre-existing
  presentation issues, outside this unit's scope (no redesign).
- Server-written legacy notices are English only (R17-B decision 4).
- The browser case covers the admin journey. The participant deep-link follow
  is covered by the resolver unit test and the HTTP experience-scope
  assertion, not by a browser click-through.
- Local runs used a 1.8 GB-free host. The first browser attempts failed on
  dev-server cold start and a 15 s OTP client timeout, not on product
  behavior. Hosted CI is the authoritative browser run.

## Rollback

Revert the R17-C commits. No data migration is involved. Rows written while
the fix was live (notice wording, `resolutionLength` audit metadata) remain
valid under the old code.
