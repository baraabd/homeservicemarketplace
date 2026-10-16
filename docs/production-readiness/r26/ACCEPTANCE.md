# R26 acceptance ledger

Status: INTEGRATION_PENDING / EXTERNAL_BLOCKED. Draft review only. No merge, deployment, hosted acceptance or release acceptance is authorized by this ledger.

## Source identity

- G1 frozen runtime: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- G1 complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Published coordination base: `0568739096ceeaf0cfc79034626886e258fe4328`.
- Final published source: the exact PR `Final SHA` and R26 artifact `sourceSha`, verified against its current head. CI evidence for a previous head does not accept a successor.
- Contracts/schema/lockfile: unchanged from G1. No migration.

## Local execution

Pinned Node 24.21.0 / pnpm 10.32.1, independent worktree dependencies and generated Prisma client. No local PostgreSQL, Redis or Docker daemon available. Database skips in hermetic tests are not integration passes.

| Command                                                                                                               | Observed result                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                      | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/database generate`                                                             | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                 | PASS                                                                                                                                |
| `VITE_API_URL=http://127.0.0.1:4326 VITE_PROVIDER_ONBOARDING_V2=true pnpm --filter @homeservicemarketplace/web build` | PASS; existing large-chunk advisory retained                                                                                        |
| `pnpm --filter @homeservicemarketplace/web typecheck:e2e`                                                             | PASS                                                                                                                                |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs`                                              | PASS, 17 tests                                                                                                                      |
| `pnpm security:audit`                                                                                                 | PASS, current full dependency tree: 0 info/low/moderate/high/critical; not a GitHub alert inventory                                 |
| `pnpm --filter @homeservicemarketplace/api test --runInBand` with ephemeral fixture env                               | PASS, 258 suites / 4,559 tests; 89 database/service suites / 1,638 cases skipped locally and explicitly not credited as integration |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                                                 | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/web test --run`                                                                | PASS, 204 files / 2,475 tests                                                                                                       |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs .github/scripts/wave-gate.test.mjs`           | PASS, 42 tests                                                                                                                      |
| `node .github/scripts/sprint-registry.mjs`                                                                            | PASS; validates records, not sprint acceptance                                                                                      |
| Affected eslint                                                                                                       | PASS                                                                                                                                |
| Final API build, complete app lint, formatting and tree secret scan                                                   | Required before publication; final result recorded in PR                                                                            |

The parser regression was first run before remediation and failed on unsafe/generic boundary behavior. After the typed HttpException implementation, a development-only assertion expecting no redundant safe `details` object failed; the assertion now verifies the exact authored safe object, while production still requires omission. The first full API suite invocation lacked required fixture environment and aborted at config validation; rerun uses a generated ephemeral JWT secret and unused loopback database URL, never a user's environment.

## Required final-head evidence

1. Existing full CI, dependency/secret scans, official CodeQL security-result check (not only the workflow job), governance, auth lifecycle, startup and staging boundaries.
2. `R26 application security acceptance`: real PostgreSQL/Redis authorization plus R18 last-admin race, compiled API bounds/CORS, enforced CSP violations and real cookie/private PDF/gallery previews in Chromium.
3. Artifact `r26-security-<head>`: sanitized `boundaries.json`, `browser.json` and synthetic PDF/gallery screenshots. Count unrun/skipped scenarios explicitly. Raw Playwright traces are disabled because they contain session and private-media data.
4. Repository-wide current CodeQL/dependency/secret alert IDs, severity, affected ref and remediation/disposition, reconciled with the deployed source. **Missing; EXTERNAL_BLOCKED**, owner/security administrator. Available connector endpoints do not expose those alert inventories. A clean new scan is not an empty alert list.
5. Hosted source/build/image identity, approved CDN/upload origins, HTTPS edge and secure-cookie browser acceptance. **Missing; EXTERNAL_BLOCKED**, deployment owner. No deployment was attempted.

## Environment fingerprint, without secrets

Disposable hosted CI runner; Postgres 16, Redis 7, Mailpit v1.31.1; database `r26_security_ci`; ports 4326/5326; explicit loopback CORS; HttpOnly session cookies and CSRF enabled; verification/work-access enabled; existing scanner test driver forbidden in hardened runtimes; actual malware acceptance remains the retained ClamAV/storage CI. No production credential, real account, live rail or business-policy approval is implied.
