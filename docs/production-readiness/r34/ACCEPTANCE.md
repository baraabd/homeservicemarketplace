# R34 — Executed preflight evidence, 2026-10-25

**Runtime implementation NOT_STARTED; G3 start authorization BLOCKED.**

Inspection base: `c9de08d07b12871db8801fb9662b14de83a2c391`.
Inspection tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
The approved frozen G3 source/tree remain null. Final documentation source/tree,
hook/security results and final-PR CI references are recorded in the PR body,
avoiding a self-referential hash in this tree.

## Checks executed in this session

The repository-pinned Node 24.21.0 and pnpm 10.32.1 were installed in a task-local
directory. The Node archive checksum and pinned pnpm SHA-512 were verified;
no machine-wide version or package pin changed. This worktree has its own
node_modules and package store.

| Command                                                                                                            | Exit | Actual result                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `node scripts/runtime/toolchain.cjs`                                                                               | 0    | Exact executing Node and repository runtime declarations verified.                                                                   |
| `pnpm install --frozen-lockfile --store-dir /workspace/scratch/d7bae9e98d6c/r34-pnpm-store --reporter=append-only` | 0    | Normal preinstall, Husky preparation and contracts build completed; lockfile unchanged.                                              |
| `node --test .github/scripts/*.test.mjs`                                                                           | 0    | 500 passed; 0 failed/cancelled/skipped/todo.                                                                                         |
| `node --test scripts/production/stripe-sandbox/verify-external.test.cjs`                                           | 0    | 49 passed; 0 failed/cancelled/skipped/todo. These validate the runner with synthetic inputs; they are not 49 real Stripe operations. |
| `node .github/scripts/g2-record.mjs --check`                                                                       | 0    | G2 record consistency; no independent remote authentication claim.                                                                   |
| `node .github/scripts/g3-record.mjs --check`                                                                       | 0    | Consistent BLOCKED G3, Wave 4 and final G4 join.                                                                                     |
| `node .github/scripts/g3-record.mjs --ready R34`                                                                   | 1    | **FAIL: R34 is not authorized to start.** This is an actual start blocker.                                                           |
| `node .github/scripts/sprint-registry.mjs`                                                                         | 0    | Registry consistency only.                                                                                                           |
| `node .github/scripts/production-governance.mjs`                                                                   | 0    | Governance-file validation only; not branch protection or acceptance.                                                                |

The commands, exit codes, counts and SHA-256 log digests are preserved in
[preflight.json](evidence/preflight.json). The 549 passing tests are two distinct
existing tooling suites; there are zero executed R34 product scenarios.

The first restricted execution could not launch child processes (`spawnSync
EPERM`). It reported 13 test-file wrappers with 9 passing and 4 failing; those
wrapper counts are not individual test coverage. Direct diagnostic runs exposed
the subprocess failure. The unchanged original commands were rerun with approved
subprocess permission, yielding the complete 500 and 49 case inventories above.
Initial failures are retained separately and no test, assertion, timeout, hook
or gate was changed. Installation retains the existing ignored-build-script
warnings for `@parcel/watcher@2.6.0` and `unrs-resolver@1.12.2`.

## Current merged-source GitHub observations

On inspection source `c9de08d07b12871db8801fb9662b14de83a2c391`, the complete
returned inventory contains **32/32 successful emitted check runs** and
**8/8 successful Actions workflow runs**. Main CI is run `40146699753`; the
CodeQL analysis workflow is run `40146699702`. These are observations of the
merged prerequisite source, not of the later documentation PR head.

There is no separately emitted `github-advanced-security` CodeQL result check
on this merge source in the observed inventory. Do not reuse the older #198
head's zero-annotation result as merge-source evidence. A Vercel check suite
(`108815569875`) is queued with no emitted check run; deployment is not verified.
The stored inventory includes annotation counts and does not assert zero
repository-wide security findings. No remote checks were rerun by this audit.

The G3 canonical record still has seven mandatory categories NOT_RUN. Existing
workflow success, prior synthetic/manual runs and artifact metadata do not
replace missing independent Stripe operations, approved policy or inspected
browser evidence. The earlier #196 preflight is historical and not counted as
an execution in this session.

## Evidence not executed or accepted

No R34 runtime changes are authorized, so application lint/typecheck/unit/build
beyond the install's contracts build, real PostgreSQL/Redis/storage/ClamAV,
independent payment/refund/statement operations, actual Admin actions,
AR/EN/RTL/mobile/zoom/keyboard browser journeys, screenshots and hosted checks
are **NOT_RUN in this session**. No credentials or private .env were read.

The final documentation PR stays Draft. Its own configured CI and official
CodeQL must be checked on its exact final head; prerequisites' green checks
cannot certify a new head. No functional SOURCE_VERIFIED, SANDBOX_ACCEPTED,
HOSTED_ACCEPTED, RELEASE_ACCEPTED, merge or deployment is asserted.
