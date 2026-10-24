# R35 — Preflight acceptance and executed checks

**Runtime implementation NOT_STARTED. No functional SOURCE_VERIFIED,
SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED claim.**

Inspection parent: `73a4a64a77844db7815466f47d8afdefb0b35c2f`;
tree: `04fbecf5ff028f95136cdddca5aeb7bb7451e09f`.
The G3 frozen base is absent. Final documentation SHA/tree and remote run IDs
are recorded in the PR, avoiding a self-referential hash in this tree.

## Actual commands and findings

The following existing, unmodified commands ran on the observed source with
task-local Node 24.21.0. The one common governance run is referenced by both
R34 and R35; it is not two independent executions or product acceptance.

| Command                                          | Exit | Result                                                   |
| ------------------------------------------------ | ---- | -------------------------------------------------------- |
| `node --test .github/scripts/*.test.mjs`         | 0    | 500 passed, 0 failed/cancelled/skipped/todo              |
| `node .github/scripts/g2-record.mjs --check`     | 0    | Consistent G2 ACCEPTED record; not remote authentication |
| `node .github/scripts/g3-record.mjs --check`     | 0    | Consistent G3 BLOCKED; Wave 4 and final G4 blocked       |
| `node .github/scripts/g3-record.mjs --ready R34` | 1    | R34 is not authorized to start                           |
| `node .github/scripts/g3-record.mjs --ready R35` | 1    | R35 is not authorized to start                           |
| `node .github/scripts/sprint-registry.mjs`       | 0    | Registry consistent, not sprint acceptance               |
| `node .github/scripts/production-governance.mjs` | 0    | Repository governance files valid, not branch protection |

Both readiness failures are actual blockers, not successful start checks.
All five R29–R33 PRs were independently re-read as merged and each merge was
checked with `git merge-base --is-ancestor <merge-SHA> <observed-SHA>`,
exit 0. Those facts do not close G3's external/policy/integration categories.

Separate worktrees use Node 24.21.0 / pnpm 10.32.1 and independent node_modules.
Only immutable package downloads are cached together. Both frozen installations
completed with exit 0 and unchanged lockfile; normal preinstall, Husky preparation
and contracts build passed. Existing ignored build-script warnings for
`@parcel/watcher@2.6.0` and `unrs-resolver@1.12.2` remain; no build approval
setting changed. Document formatting, normal hooks, exact-tree secret scans
and final documentation checks are reported in the PR metadata.
The executed installation command is:

```sh
pnpm install --frozen-lockfile --store-dir /workspace/scratch/b5653dea7992/wave4-pnpm-store --reporter=append-only
```

Tooling is task-local; no machine-wide NVM/package-manager version is changed.
Package/lock/schema/contract digests in the preflight record are actual
observed bytes. No .env, credentials, production DB or user session is read.

## Evidence not executed

Application lint/typecheck/unit/build beyond normal installation scripts, real
PostgreSQL/Redis/storage/ClamAV, independent Stripe/manual sandbox operations,
new browser journeys, AR/EN/RTL/keyboard/engine tests, screenshots and hosted
bundle/API parity: **NOT RUN in this preflight**. There is no implemented
runtime change to certify and G3 forbids starting the lane.

Final-PR CI and official CodeQL are independently required. They must reference
the exact final documentation head. A green documentation PR cannot certify
R35, create a frozen G3 source, or authorize merge/deployment/live activation.
Missing/pending/failed/cancelled/skipped checks are not counted as successful.

No mandatory test was removed, weakened or replaced. No test was added merely
to mirror the new documentation. Failures, exit codes, null acceptance counts
and non-secret configuration fingerprints are retained in
[evidence/preflight.json](evidence/preflight.json).
