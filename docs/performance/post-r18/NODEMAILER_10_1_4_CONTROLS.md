# Serialized PR repair — 2026-10-24

Mode A. The owner authorized repair of all open PRs for later owner merge.
Root is the sole writer; the exact shared-path lease is recorded in PR #191
under gates/g3/PR_REPAIR_2026-10-24.md before edits.

Accepted develop: fa556f50216d188303de26dce9805717b17107e7.
Bring accepted dependencies/workflows into this branch with a normal merge,
keeping original history. No peer product source, force push, gate waiver,
merge to develop, deployment or live operation.

Shared test fixes preserve real behavior: canonical datetime-local values preserve
nonzero seconds while matching Chromium's zero-second normalization; the R27 same-browser
account switch awaits the final Admin sign-out navigation and a real 204,
without reloading the SPA or clearing caches.

Final source/check/run/artifact identities are recorded in this PR body.
G3 acceptance remains subject to real integrated provider/policy evidence.

## Confirmed causes and repairs

- R30 datetime-local: the first minute-only correction was rejected by real CI
  because it could backdate settlement before intent creation. The follow-up
  preserves nonzero seconds and removes only zero seconds. Financial guards,
  input, route, assertions and timeout remain unchanged.
- R27 same-browser account switch: await successful logout response and its
  final `/login?app=admin` destination before starting the next login. Keep the
  same SPA and caches; no reload, storage clear or authorization bypass.
- Admin OTP mailbox: inspect all recipient-matching messages, consume only the
  message containing the text OTP, preserve notifications and other users'
  messages, and reject HTTP failures. Four regression cases use explicit HTTP
  fixtures. They are not real SMTP or authentication acceptance.
- Security: the full audit identified HIGH GHSA-27r3-jxmh-p828 in body-parser
  2.3.0. Apply a scoped `body-parser@>=2.0.0 <2.4.0: 2.4.0` override. Lock changes
  are limited to that parser and its selected transitive dependencies.
  Official release inspected: https://github.com/expressjs/body-parser/releases/tag/v2.4.0
  (published 2026-10-22). No audit suppression or budget change.
- Immutable performance controls allow a nonempty subset of the three
  dependency paths to change, while verifying all three resulting blob hashes,
  exact parent/tree identity, ancestor relationship and unchanged runtime source.
  Added positive subset, empty-change and unchanged-blob tampering coverage.

## Local executed checks

Environment: Linux disposable worktrees, pinned Node 24.21.0 and pnpm 10.32.1;
independent node_modules/generated outputs. No production env or credentials.
No database or Redis service was available locally. CI owns disposable real
services. Test-only local API configuration is distinct per lane. Web build used
`VITE_API_URL=http://127.0.0.1:4327` (build input, no service acceptance).

The identical shared source was checked in #191/#190 and the two dependency
variants in #193/#195; this is explicitly shared-source evidence, not five
independently executed end-to-end runs.

| Exact command                                                                                                                                | Executed scope and result                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                                             | Each of the five PR worktrees and dependency-control worktrees; exit 0                                       |
| `pnpm --filter @homeservicemarketplace/web test`                                                                                             | #191: 221 files, 2674 passed, 0 failed                                                                       |
| `pnpm --filter @homeservicemarketplace/web exec vitest run src/test-harness/otp-mailbox.test.ts`                                             | #191: 4 passed, 0 failed, explicit HTTP fixtures                                                             |
| `pnpm --filter @homeservicemarketplace/web typecheck:e2e`                                                                                    | #191: exit 0                                                                                                 |
| `pnpm --filter @homeservicemarketplace/web lint`                                                                                             | #190: exit 0                                                                                                 |
| `pnpm --filter @homeservicemarketplace/web build`                                                                                            | #190: exit 0; existing large-chunk warning retained                                                          |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                             | #193: exit 0                                                                                                 |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                        | #193: exit 0                                                                                                 |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                            | #193 after parser update: exit 0                                                                             |
| `pnpm --filter @homeservicemarketplace/api test --runInBand --json --outputFile=/workspace/scratch/b3dda4f7b9ef/repair193-security-api.json` | #193 with isolated test-only config: 5419 passed, 0 failed, 1862 conditional/pending; no local DB acceptance |
| `node --test .github/scripts/*.test.mjs`                                                                                                     | #191: 500 passed, 0 failed                                                                                   |
| `pnpm security:audit:test`                                                                                                                   | #191: 39 passed, 0 failed                                                                                    |
| `node --test scripts/security/secret-scan-tree.test.cjs`                                                                                     | #191: 7 passed, 0 failed                                                                                     |
| `pnpm security:audit`                                                                                                                        | Both dependency variants (#191/#195): zero findings at every severity                                        |
| `pnpm security:audit:prod`                                                                                                                   | Both dependency variants (#191/#195): zero findings at every severity                                        |

Initial failed diagnostics are retained: full API test without required local
config exited 1; #195 typecheck before generating its own Prisma client exited
2; the initial audit exited 1 on the real HIGH parser advisory. These are not
reported as passing attempts. The pure mailbox regression module avoids a
Playwright-runtime import side effect discovered during its first draft.

Local `playwright install chromium` exited 1: the download returned an invalid
ZIP. Local real-browser and real-service checks are unavailable, not PASS.
Inspected previous CI artifacts: #192 Windows cold-start screenshot shows the
actual startup recovery screen (artifact 12531388573); #190 Admin API logs
confirm delivery/acceptance before mailbox polling failed (artifact 12531835336).
Raw logs, mailbox contents and session traces are not committed.

## Acceptance, publication and rollback

Final source/tree SHA and final-head CI run/artifact IDs belong in the live PR
body after publication, avoiding a self-referential commit hash. Normal local
hooks run before publication, and the published Git tree must equal the checked
tree. Pending or failed hosted checks remain explicit until verified.

No schema migration, contract version, feature flag, price, eligibility or live
rail change. No automatic balancing entries, payout, transfer, permission grant,
merge to develop or deployment. G3 remains blocked by its existing integration,
independent provider sandbox evidence and policy requirements. CI green alone
does not accept G3 or release R34–R38.

Rollback: revert the repair commit on the same PR branch through a new commit;
restore the previous dependency-control record/workflow together if reverting
its matching dependency update. No database rollback is needed. Reverting the
parser fix reintroduces its HIGH advisory and must not be released.

## Frozen comparison identities

```json
{
  "schemaVersion": 1,
  "experiment": "r27-body-parser-2.4.0-nodemailer-10.1.4",
  "advisory": "GHSA-27r3-jxmh-p828",
  "priorBaseline": "0be750b996dcd1ae1090f8cc5addb665445a6538",
  "originalPrBase": "fa556f50216d188303de26dce9805717b17107e7",
  "dependencySha256": {
    "apps/api/package.json": "4983c28e4ec895212432b17e33dd90be0127bb8bc3b05abbbd7864bbc8ddac5d",
    "package.json": "93bde3b306781e63235e7539c90d61d620933f6fd7b20c89e0ed45744a3deb4d",
    "pnpm-lock.yaml": "a87b3cf166454d4c6967e2c1048520c0f339d63d8c1936f4f4e988e7b9b1cd79"
  },
  "baseline": {
    "commit": "9a21338367e7cebdf9ccd38d3c3d625e841c9ade",
    "tree": "f73366d8c09d66823925fde29166110ec0c07452",
    "parent": "0be750b996dcd1ae1090f8cc5addb665445a6538"
  },
  "repair": {
    "commit": "c956d16c33a4e4df03ca01e451d56eb2e0bb369d",
    "tree": "4209292cc5f63ed7c44a8478cda4fe92cae3ec36",
    "parent": "c838d49788d058e98a626af285e933363d82d75a"
  }
}
```

Configuration fingerprint (SHA-256 of nonsecret test configuration): `5c73452ab5ac3b9fc90ac940aa4b96a96cb02ecf16435923c38db530d1078973`.

## Nodemailer variant

Keep the original Nodemailer 10.1.4 update. Its comparison baseline and repair control have identical dependency inputs, including the parser security fix. The prior Nodemailer-only control `0be750b996dcd1ae1090f8cc5addb665445a6538` is preserved as historical provenance, not used as the final comparison.

## Follow-up verification correction

Shared coordinator commit 61fb7a6b9591d89bd4f94f49519bd26278362917 corrects
settlement time precision and hardens the legacy CommonJS test boundary.
See the shared G3 PR repair evidence for the failed R30 run, Windows diagnostic
limits and 12 passing local regression tests. Final-head browser/service CI is
required; no prior green run is substituted for this source tree.
