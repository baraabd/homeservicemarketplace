# G3 acceptance evidence

Decision: **BLOCKED**. No SANDBOX_ACCEPTED, HOSTED_ACCEPTED, RELEASE_ACCEPTED or Wave 4 start authorization is asserted. The latest repair evidence is [PR_REPAIR_2026-10-24.json](evidence/PR_REPAIR_2026-10-24.json); its published source/tree and final-head CI are recorded in PR #198. A source document cannot contain its own final commit identity.

## 2026-10-24 PR repairs and assembled execution

The repair starts from PR #198 head `ec9d86df306b3f93bf1589bdee8dcc479c6d9809`. Its R31 browser failure was a serious axe color-contrast result while the newly added checkout buttons animated between themes. Those four controls now use the existing My Plan immediate-transition convention. The affected component/API tests passed 7/7; the pinned real browser/axe workflow must verify the final published source. The local pinned Chromium download failed at the provider CDN, so no local browser pass is claimed.

The actual assembled manual flow exposed a separate product defect: the refund orchestrator invoked the concrete subscription participant before storing the successful refund status and compensation link that participant requires. The repair stores both fields before invoking the participant, inside the same transaction. A failure still rolls back the terminal refund, compensation, subscription consequence, lifecycle receipt, audit and outbox together.

Task-owned PostgreSQL 16, Redis 7 and ClamAV with verified official signatures were available for this repair. Six G3 runtime cases passed with zero failures/skips, including two complete receipt/inspection/settlement/confirmation/activation/refund flows with real registered money participants. Both SUSPEND_SUBSCRIPTION and CANCEL_SUBSCRIPTION are exercised. A failure after the real cancellation participant proves rollback followed by recovery with the original query key. Synthetic XTS plans, approvals and settlement assertions remain explicitly synthetic.

| Local verification                                             | Passed | Failed | Skipped |
| -------------------------------------------------------------- | -----: | -----: | ------: |
| G3 additive schema and persistence against PostgreSQL          |      6 |      0 |       0 |
| G3 actual AppModule/HTTP/PostgreSQL/Redis/ClamAV lifecycle     |      6 |      0 |       0 |
| Original R30 real-service cases, unchanged                     |     16 |      0 |       0 |
| Money command and R32 recovery suites                          |     92 |      0 |       0 |
| Affected checkout component/API cases                          |      7 |      0 |       0 |
| All governance validators plus new external-runner guard tests |    540 |      0 |       0 |

TypeScript, scoped ESLint, formatting and repository/baseline/G3 consistency checks also passed. The G3/Wave gate subset passed 170 cases and is included in the 540-case governance total, not an additional independent acceptance run. CI now executes the six G3 runtime cases in the existing R30 real-services job with a separate JSON report and exact-count/zero-skip assertion. The original R30 service count remains 16 and its browser count remains unchanged.

The new external runner uses the actual AppModule and official Stripe transport, explicit approved input and an authentic provider-forwarded signature. Its 40 guard tests are part of the 540 cases above. They prove input/evidence rejection, not provider execution. The 14 external scenarios are **NOT_RUN** because authorized test credentials, a matching webhook forwarder and approved financial policy inputs are absent. See [SANDBOX_RUNBOOK.md](SANDBOX_RUNBOOK.md) for the exact handoff and the remaining browser/crash scenarios. No mandatory G3 evidence category is promoted to PASS merely because this runner exists.

The first repair-tree secret scan reported five occurrences of a synthetic entitlement domain identifier. Each declaration/assertion/request was reviewed and classified in the security baseline, section 16. The current spelling is `g3.test`; the same six real-service cases passed again. Only the exact historical fingerprints are recorded. No scanner rule, path coverage, required gate or test assertion is relaxed, and no commit is rewritten. Final tracked-tree and historical scans remain required before advancing the PR branch.

## Earlier implementation record (historical)

Initial implementation source: `134301e255d339d2b31acd7038787a2c3924210d`, tree `f1fddb0a55a234e141697cc0b045be3733059c55`. The following observations describe that earlier execution; the repair section above supersedes its local-service availability statements.

Local runs use Node 24.21.0 / pnpm 10.32.1. Exact command/result inventory and sanitized configuration fingerprint: [LOCAL_CHECKS.json](evidence/LOCAL_CHECKS.json). Full default API run initially passed 5,463 tests with 1,872 infrastructure-gated skips after supplying synthetic test boot configuration. The final default-suite repeat passed 5,464 tests with the same 1,872 infrastructure-gated skips, 310 passed suites and 101 skipped suites. Twenty focused policy/module tests also passed. Later additive schema/DB-fixture corrections passed typecheck; real database execution remains required. Affected web tests passed 97, governance/security-runner tests passed 546, and official SDK offline signature cases passed 14, all with zero failures/skips in those focused runs.

Frozen install, generated Prisma client, schema syntax validation, affected lint/typecheck/build and dependency audit were executed. Web lint reports 34 existing warnings, zero errors; no warning budget changed. The full dependency audit reports zero info/low/moderate/high/critical findings. A tracked-tree Gitleaks scan at the first implementation commit inspected 2,891 files / 25,932,492 bytes with zero findings; final evidence-tree scan is recorded separately.

## Evidence not established at initial implementation

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

The first evidence-inclusive tracked-tree scan reported two generic matches
on SHA-256 evidence digests. Both were recomputed from their inputs and
individually classified in `docs/security/gitleaks-historical-baseline.md`
section 15. The current representation was clarified and only two exact
historical occurrences were baselined. The history range then passed; fresh
canaries still triggered both rules. No scanner rule or budget was relaxed.
The new runtime integration setup/teardown uses the same 120s/30s per-hook
bounds as the existing R29 fixture; global and scenario timeouts are unchanged.

## CSP and PR metadata follow-up

The first PR governance job failed because the description omitted the exact mandatory template field names. The description was corrected; no validator changed. The browser security review also found that the default document CSP blocked Payment Element. An explicit `VITE_STRIPE_SANDBOX_ENABLED=true` build option now admits the documented Stripe resource subset, preserving strict defaults. `node --test scripts/production/security-app/verify-boundaries.test.cjs` passed 32 tests, zero failures/skips/todos; malformed flags and unmodified unrelated directives are checked. The existing R26 workflow executes these tests. Build and final CI results are recorded on the PR. This is not an external Stripe browser acceptance claim.

Self-review found three SQL foreign keys for decision maker/checker/correction that lacked Prisma relation declarations. The schema now maps the exact existing constraint names and NoAction update behavior; migration semantics and evidence restrictions are unchanged. Schema validation, client generation and API typecheck were repeated successfully. The real migration-drift check remains a CI requirement.
