# R29 acceptance record

Decision: **PARTIAL IMPLEMENTATION / SOURCE_VERIFIED components /
INTEGRATION_PENDING / EXTERNAL_BLOCKED / POLICY_BLOCKED**. No real Stripe
operation, hosted acceptance or G3 acceptance is claimed. Keep the PR Draft.

## Identities

Frozen G2 source `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`, tree
`43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`. Actual implementation base
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c`, tree
`54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`. Final containing source/tree and
final-head remote runs are reported in the one English R29 PR body.
Local run namespace: `r29-20261023-b3dda4f7`. Worktree:
`/workspace/scratch/b3dda4f7b9ef/hsm-r29`. No shared node_modules/cache/build
output, user DB, copied .env, external account or live credential was used.

## Executed checks

All commands use the task-local pinned Node/pnpm PATH. Counts overlap; do not
sum separate focused and whole-package runs as unique coverage.

| Command / check                                                                                                             | Observed result                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                            | Exit 0; independent worktree, 1166 locked packages / 6 projects; no manifest/lockfile change                       |
| `pnpm --filter @homeservicemarketplace/database generate`                                                                   | Exit 0; guarded Prisma 6.12.0 generation                                                                           |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                            | Exit 0                                                                                                             |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                       | Exit 0 after branded money-wire fixture correction                                                                 |
| `pnpm --filter @homeservicemarketplace/api build`                                                                           | Exit 0; normal dependency build chain                                                                              |
| Focused Jest command below                                                                                                  | Exit 0; 9 passing suites, 140 passing assertions; 1 DB suite / 6 assertions not run                                |
| `pnpm --filter @homeservicemarketplace/api test --json --outputFile=/workspace/scratch/b3dda4f7b9ef/r29-api-all-final.json` | Exit 0; 303 passing suites / 5412 passing assertions; 99 conditional suites / 1862 assertions not run, zero failed |
| Governance/script tests below                                                                                               | Exit 0; 494 passed, zero failed/skipped                                                                            |
| Official SDK signature harness below                                                                                        | Exit 0; 14 passed, zero failed/skipped; zero external requests                                                     |
| Actual StripeConstructor TypeScript compatibility                                                                           | Exit 0 against installed official 23.0.1; no structural cast or vendoring                                          |
| `pnpm security:audit`                                                                                                       | Exit 1; two HIGH occurrences of one existing Zod advisory                                                          |
| `pnpm security:audit:prod --output /workspace/scratch/b3dda4f7b9ef/r29-audit-production.json`                               | Exit 1; one HIGH production Zod occurrence                                                                         |
| Secret scan / normal commit hooks / final remote CI                                                                         | Final source result is recorded in the PR; no future pass inferred in this source snapshot                         |

```sh
pnpm --filter @homeservicemarketplace/api exec jest --testPathPatterns='adapters/stripe|webhooks/stripe|r29-stripe-sandbox.integration' --json --outputFile=/workspace/scratch/b3dda4f7b9ef/r29-tests.json
node --test .github/scripts/*.test.mjs scripts/production/stripe-sandbox/verify-sandbox.test.cjs scripts/security/secret-scan-tree.test.cjs
node scripts/production/stripe-sandbox/verify-sandbox.cjs --offline-signatures --sdk-root /workspace/scratch/b3dda4f7b9ef/toolchain/r29-stripe-sdk
pnpm exec tsc --noEmit --strict --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --target es2022 --module commonjs /workspace/scratch/b3dda4f7b9ef/r29-sdk-type-compatibility.ts
node .github/scripts/g2-record.mjs --ready R29
node .github/scripts/production-governance.mjs
node .github/scripts/sprint-registry.mjs
node .github/scripts/release-baseline.mjs
```

The standalone SDK installation used
`pnpm --dir /workspace/scratch/b3dda4f7b9ef/toolchain/r29-stripe-sdk add stripe@23.0.1 --save-exact`.
It is isolated verification tooling, not a substitute for CR-001's production
dependency integration. The compatibility file imports the actual Stripe class
and assigns it to the owned StripeConstructor type with no casts.

Full API tests required an explicitly generated process-only JWT secret and
a compile-only database URL on loopback port 1. No database could be contacted
there. Neither variable is copied from the user, printed, saved in Git or used
as real persistence proof. Standard Jest parallelism is unchanged.

## Retained failures and corrections

- Initial typecheck rejected plain strings in branded MoneyWire and implicit
  callback types. Corrected using the published `toMoneyWire` constructor and
  explicit test input types; no shared contract weakened.
- Actual Stripe 23 constructor compatibility rejected zero-argument account
  retrieval. Corrected to the official direct-account `retrieve(null)` call.
- First governance run correctly found the R29 ACTIVE_STATUS row still PLANNED.
  Root recorded a single-row lease, synchronized it, and all 494 checks passed.
- First broad API run: 5400 passed, zero failed assertions, 1862 conditional,
  but three suites failed to initialize because DATABASE_URL/JWT_ACCESS_SECRET
  were absent. After explicit nonservice fixture env, all 5412 enabled cases
  passed. No worker reduction, new exclusion or timeout increase.
- Initial isolated SDK install found its task directory absent (exit 1); creating
  that directory and repeating installed exactly one official package.
- Existing ts-jest isolatedModules deprecation warning is retained. HTTP
  negative tests intentionally exercise parser 413/415 errors.
- Full and production audit failures remain unresolved. Zod 3.25.76 in API and
  Zod 4.3.6 below eslint-plugin-react-hooks are covered by
  GHSA-mrhx-c7xc-m3w5; patched version is reported as >=4.6.6. CR-001 assigns
  remediation to the concurrent dependency owner; audit exceptions are not added.

## Evidence limits

The unit SDK and persistence objects are labeled contract doubles. The official
SDK harness verifies real cryptography against synthetic test envelopes, not
a provider-sent payment. Six new integration cases exercise actual AppModule
HTTP/auth, PostgreSQL/Redis and real R31 activation when RUN_DB_INTEGRATION=1;
that suite still uses a labeled SDK double. Local DB/Redis binaries and a
non-root UID are absent, so those cases are explicitly NOT_RUN locally.

No actual sandbox payment/authentication/decline/cancellation/async-payment or
partial/full-refund flow ran. No external statement, real missed-webhook replay,
normal browser checkout or Admin exception flow ran. No screenshot was produced
or inspected; AR/EN/RTL/mobile/keyboard checks are NOT_RUN because no frontend
was changed and the real purchase-surface decision/integration is missing.
No hosted environment, storage pipeline or financial acceptance is claimed.
Real matched/unmatched counts and unresolved exception severity: NOT_MEASURED.

Required final-PR CI and official CodeQL are checked on the published head;
source/pending/failure outcomes remain separate from sandbox/hosted acceptance.

## Nonsecret environment fingerprint and local artifact digests

```json
{
  "node": "24.21.0",
  "pnpm": "10.32.1",
  "prisma": "6.12.0",
  "sdk": "23.0.1",
  "apiVersion": "2026-09-30.endive",
  "live": false,
  "sandboxAccountAssigned": false,
  "database": "unconnected compile-only loopback port 1",
  "redis": "not provisioned",
  "storage": "task worktree only",
  "uidMapping": "root only, one UID",
  "jwt": "random ephemeral process-only unit fixture",
  "nodeModules": "independent task worktree"
}
```

Canonical environment SHA-256: `dcd38e818d532aaa749259e25c51a4c0b8e92bec46724595561a3c61434391a4`.

| Local artifact                         | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `r29-install.log`                      | `6f6bdfa72b972e2d884fee54824030c6c9381f0a694248bebf628d2d32e4c42c` |
| `r29-sdk-install.log`                  | `c4fe5d2a2e076b35cc0bacf67f0ef84f57a7e9e7b318cb2ebe8483004142e8ff` |
| `r29-generate.log`                     | `fee8973cdfcad619aa91c0e0b0eb7d65edb8326cb8ec4ac8f773bdc23c86a0dc` |
| `r29-lint.log`                         | `25d4f1cdb79f8d4d54a40593bbbb215fbd19d7f2fd725e6b9f8657e2ad71b57a` |
| `r29-tests.json`                       | `d6e35a2303846d4ffcd98b1c349930658f4011d76736efe397ba8db2f452b8e3` |
| `r29-api-all-final.json`               | `553b0865c6376f2b9413b531e123a157eeb931715b4f3d1ffe2227184b6356a1` |
| `r29-governance-final.log`             | `074b2ccb4dfd4975752213158a9571210994041721fed7e9d4a0a458fcc323b6` |
| `r29-sdk-type-compatibility-final.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `r29-audit-full.json`                  | `024ec798f3f1376b2f42303d4168b54b27d4a1a3da5402c7920475dd308344a4` |
| `r29-audit-production.json`            | `5c747b026c636a23f05649ff2708a798dbd84f8cf9fbd0767e9a5c07f5bafd7b` |

Raw environment, credentials, traces and logs are excluded from Git.
