# G3 acceptance evidence

Decision: **BLOCKED**. No SANDBOX_ACCEPTED, HOSTED_ACCEPTED, RELEASE_ACCEPTED or Wave 4 start authorization is asserted. Source: `134301e255d339d2b31acd7038787a2c3924210d`, tree `f1fddb0a55a234e141697cc0b045be3733059c55`; evidence-only successors must retain and recheck the code tree.

Local runs use Node 24.21.0 / pnpm 10.32.1. Exact command/result inventory and sanitized configuration fingerprint: [LOCAL_CHECKS.json](evidence/LOCAL_CHECKS.json). Full default API run initially passed 5,463 tests with 1,872 infrastructure-gated skips after supplying synthetic test boot configuration. The final default-suite repeat passed 5,464 tests with the same 1,872 infrastructure-gated skips, 310 passed suites and 101 skipped suites. Twenty focused policy/module tests also passed. Later additive schema/DB-fixture corrections passed typecheck; real database execution remains required. Affected web tests passed 97, governance/security-runner tests passed 546, and official SDK offline signature cases passed 14, all with zero failures/skips in those focused runs.

Frozen install, generated Prisma client, schema syntax validation, affected lint/typecheck/build and dependency audit were executed. Web lint reports 34 existing warnings, zero errors; no warning budget changed. The full dependency audit reports zero info/low/moderate/high/critical findings. A tracked-tree Gitleaks scan at the first implementation commit inspected 2,891 files / 25,932,492 bytes with zero findings; final evidence-tree scan is recorded separately.

## Required evidence not established locally

- Real PostgreSQL/Redis/storage tests: local services are absent. Ten new integration cases are included under the existing RUN_DB_INTEGRATION gate; CI must execute them, not count their default skips as acceptance.
- Real Stripe sandbox payment/refund/missed-webhook recovery: credentials absent. Offline SDK signatures and transport doubles are explicitly component evidence, not external funds evidence.
- Approved manual settlement/receipt authority and refund policy: absent. Synthetic fixture approvals are not product or operational approval.
- Real-route payment UI, AR/EN/RTL/mobile/keyboard/zoom/browser-engine evidence: not run for the new checkout locally. No new browser screenshot was inspected and no screenshot/trace is presented as proof. Existing My Plan browser CI should be repeated on the candidate and an authorized Payment Element journey added to the sandbox run.
- Hosted acceptance: environment absent. The built bundle's API URL is an isolated local build target, not evidence of a reachable API.
- Final PR CI/CodeQL and comparison results: see final PR check IDs/status; a green isolated lane is not G3 acceptance.

## Failures retained in the record

Initial typecheck found a branded-money-string test fixture; fixed with toMoneyWire. Initial full default tests failed to load three existing suites because DATABASE_URL/JWT_ACCESS_SECRET were absent; rerun with synthetic boot-only configuration passed. Initial Prisma validation lacked DATABASE_URL; syntax-only rerun with a synthetic loopback URL passed without connecting to a database. An initial Gitleaks command referenced an absent config; the repository tracked-tree scanner then ran successfully. R27 negative-test error text was updated from three to four dependency files without weakening the assertion. The audit tool generated an untracked report in the root; it was moved outside the source tree and the exact allowlist check passed.

`node .github/scripts/g3-record.mjs --check` passes consistency. `--ready R34` exits 1 intentionally: acceptance and verified publication are still missing. No accepted SHA or active R34 implementation lease is fabricated.

A task-owned empty orphaned Prisma generation lock from the earlier completed generation was quarantined outside the worktree; the waiting repository generator reacquired its lock normally and completed. No peer process was stopped and no generation guard was disabled.
