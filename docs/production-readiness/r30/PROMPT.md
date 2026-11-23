# R30 — Manual subscription payment rails and protected receipt review

**Repository:** `baraabd/homeservicemarketplace`\
**Wave:** 3 of 4 · **parallel lane:** 2 of 5\
**Assigned branch:** `feat/r30-manual-payment-review`\
**Evidence directory:** `docs/production-readiness/r30/`\
**Legacy coverage:** P40, P41-manual-adapter\
**Hard dependencies:** R24, R20, R21, R22, R23\
**Start barrier:** G2; use its full frozen base SHA.\
**Initial status:** PLANNED. This prompt does not assert implementation or acceptance.

## Non-negotiable execution contract (included in every prompt)

You are implementing one bounded engineering sprint in `baraabd/homeservicemarketplace` using Claude Code in VS Code. This is implementation plus tests and evidence, not planning-only. Do not claim execution that did not occur.

### Baseline, instructions and boundaries

Read the current worktree's `CLAUDE.md`, `.claude/rules/ux-ui-design-policy.md`, applicable ADRs, `docs/production-readiness/r15/`, `r16/PAYOUT_POLICY.md`, `r18/BLOCKERS.md`, `docs/money/LIVE_MONEY_GATE.md`, and the coordinator's frozen wave manifest. The planning observation was develop\@059c018576a75837d4dfb262ee49168d9217d881 on 2026-10-13; the actual execution base is the full SHA approved for your wave, not an old SHA copied from chat. Historical docs are not current implementation evidence.

Use the assigned Git worktree/branch only. Verify `git rev-parse --show-toplevel`, current branch, status and HEAD before edits. Do not change branches in another session's folder, import an unmerged peer branch, automatically rebase while peers are running, pop somebody else's stash, force-push, merge to develop, or deploy. One sprint ID stays with this branch/PR even through corrective commits. An integration PR is a gate, not a new product sprint number.

Use current repository pins and scripts; at the observed baseline they are Node 24.21.0 and pnpm 10.32.1. Do not switch machine-wide NVM versions while other agents run, update package managers/Prisma, bypass hooks, or rewrite lockfiles merely to clear a warning. Each worktree has independent node_modules, dist, caches, generated Prisma output and evidence. Shared package-manager download cache is not a shared node_modules directory.

### Five-session isolation and single-writer ownership

Before implementation, convert the proposed path prefixes into an exact allowlist from the real tree and have the coordinator approve it. Every changed file has one writer per wave. A proposed directory may not yet exist; create a cohesive module only when justified, never a parallel copy of an existing authority. Read outside your allowlist freely; write outside it only after an explicit ownership lease is recorded.

Root manifests/lockfiles, all migrations/schema, shared contracts barrel, AppModule/main/env configuration, routes/Root, CI, Docker/Compose, edge entrypoints and central sprint registries are coordinator-owned. Produce a concrete change request under your own evidence directory naming the exact path, minimal patch, reason, tests and migration/dependency consequences. The coordinator authors/applies that patch in a serialized integration stage, or grants a single explicit lease. No two agents edit the global glue at once. Package-relative source imports must not bypass published workspace contracts to make compilation pass.

No source dependency on an unmerged same-wave lane is allowed. Use only frozen APIs/ports/schema from previous accepted waves. Contract doubles are allowed for isolated tests but are labeled as such. If a missing peer implementation is needed for full runtime acceptance, the integrated wave gate supplies it; do not call a component-only PASS end-to-end completion.

Use separate disposable DB/user, Redis instance or demonstrably isolated namespace, storage directories/buckets, queue identities, Compose project/volumes/container names and host ports. Compose project names alone do not override fixed container names or explicit volume names: inspect effective configuration without printing secrets. Distinct browser contexts/origins prevent session collisions; different localhost ports alone do not isolate cookies. Never reuse the user's working database or copy an unreviewed .env to five lanes. Do not reset databases, delete volumes, flush shared Redis, expose private media or kill unrelated processes. The coordinator may serialize heavy full-stack tests when hardware cannot sustain five stacks; code work remains parallel.

### Product and safety authority

Extend existing capabilities; do not rebuild completed R15/R17/R18 work. Subscription revenue is not provider withdrawable earnings. No customer-funds escrow, payout, FX, fee/tax model, supported market/currency, plan price or production verification change is inferred from this prompt. Preserve R16 and R18 unresolved decisions. Sandbox implementation is allowed under the approved interfaces; actual live funds, external resource spend, production changes, identity verification decisions and account/permission grants require separate authorization. Do not bypass provider eligibility or legal/age checks.

Keep live rails off by default. Approval of a plan purchase does not confer identity verification or work access. No mock scanner, fabricated success page, fake balance or manually rewritten ledger can establish a real payment. Preserve idempotency, immutable history, restricted evidence and post-commit outbox. Use current official vendor documentation for selected versioned integrations.

### Work and verification

Reproduce or define the missing behavior, implement a minimal coherent change, add negative and concurrency tests, self-review the diff, and execute the applicable repository scripts. Discover actual package script names first; no guessed commands. At minimum: frozen install, affected formatting/lint/typecheck/unit/build, relevant real PostgreSQL/Redis/storage tests, real-route browser tests for UI, AR/EN/RTL/mobile/keyboard checks, security scans and required final-PR CI/CodeQL. Preserve existing tests; do not skip them, lower assertions, fabricate artifacts or raise global timeouts/security budgets to obtain green.

Every external command must be checked for its exit code. A stopped watcher, successful compilation or healthy DB does not prove all application routes. Run code in your authorized environment only. When infrastructure/credentials/policy is missing, complete unaffected implementation and tests, then record the precise blocker and its owner; do not report unrun checks as passing.

### Deliverables and honest states

Create `IMPLEMENTATION.md`, `ACCEPTANCE.md`, `RISKS.md`, `ROLLBACK.md` and any `shared-change-requests/` under this sprint's evidence directory. Include base/final/source-tree SHA, changed paths, contract/schema versions, exact commands and counts, run/artifact IDs, applicable environment configuration fingerprint WITHOUT secrets, inspected screenshots, failures/skips and residual risks. Sensitive documents, credentials, session traces and raw .env never enter Git or public artifacts.

Open/update one English PR after applicable local checks. Keep it Draft while required evidence is missing. Distinguish IMPLEMENTED, SOURCE_VERIFIED, INTEGRATION_PENDING, SANDBOX_ACCEPTED, HOSTED_ACCEPTED, POLICY_BLOCKED, EXTERNAL_BLOCKED and RELEASE_ACCEPTED. Only the coordinator marks a wave accepted after integrated candidate tests; only explicit owner approval permits merge/deployment/live activation. Do not claim zero defects or guaranteed conflict-free integration.

## Sprint-specific read-first map

These are inspection targets from the current repository or outputs of accepted prior waves. Resolve exact current locations before changes; a path marked as a proposed ownership root is not evidence that a module exists already.

- `docs/adr/0014-money-subscriptions-ledger.md`
- `docs/money/README.md`
- `docs/production-readiness/r20/`
- `docs/production-readiness/r24/`
- `apps/api/src/infrastructure/storage/`

## Exclusive proposed implementation ownership

- `apps/api/src/modules/money/adapters/manual/`
- `apps/api/src/modules/money/manual-review/`
- `apps/web/src/app/features/manual-payments/`
- `scripts/production/manual-payments/`
- `docs/production-readiness/r30/`

All global shared paths remain coordinator-owned unless an explicit recorded lease is granted. Tests may be added only beside owned modules or within this sprint's dedicated test directory approved in the exact allowlist. Do not edit a sibling lane's files to make your tests compile.

## Required implementation

1. Implement incoming subscription payment instructions for Sham Cash, Syriatel Cash and approved cash offices only where the owner has selected and authorized the method. Do not invent unofficial vendor APIs, automate private consumer accounts, scrape wallets or treat a QR image as a payment confirmation.
2. Persist an obligation/attempt with exact server-owned amount, currency, expiry and recipient instruction version. Show safe method-specific instructions and state. Missing merchant details or supported market/currency policy means METHOD_DISABLED, not fictional account information.
3. Reuse the restricted media foundation for receipts while preserving a separate financial-evidence purpose and authorization. Reserve, upload, finalize, type-check, hash and malware-scan the actual bytes. Never store receipts as public portfolio media or attach them to identity cases solely to reuse a viewer.
4. Implement an audited Admin review workspace for authorized finance reviewers: view receipt through an authenticated private read; compare the claimed payment with an independently permitted payment/deposit reference; approve, reject or request replacement with a provider-visible message. Internal reviewer notes remain separate. An image/fingerprint/risk score is not proof of receipt of funds.
5. On valid confirmation use the R24 atomic payment/ledger/activation boundary. Enforce fresh permissions, actor separation as approved, no self-review, inspected revision, duplicate deposit/reference handling and concurrent-review exclusion. Requesting a new receipt never activates a plan; replacement remains a new immutable asset version with history.
6. Reuse durable notifications/outbox for correction and decision notices. The provider can see the precise reason, upload the replacement, reload/relogin and resubmit. A historical approved receipt is not silently overwritten and cannot be reused for a second obligation.
7. Implement the manual-rail refund transport/result interface for R32: operator-reviewed dispatch and independently recorded confirmation, not a claim that a ledger reversal sent money. Unknown transfer outcome remains unresolved. Financial approval thresholds, merchant references and receipt retention require explicit policy rather than arbitrary defaults.

## Required behavioral, negative and integration tests

Real API/PostgreSQL/private storage/ClamAV tests for upload completion, invalid MIME/signature, quarantined/absent receipt, cross-provider access, unauthorized/revoked finance reviewer, duplicate receipt/payment reference, double approval race, transaction rollback, correction/reupload/relogin and immutable prior evidence. Use synthetic receipts and a sandbox/operator simulation for funds; label that evidence accurately. An authorized real settlement check is required before the method can be accepted for live use.

## Exit criteria

Manual subscription collection and correction lifecycle is implemented without public receipts or fake vendor confirmations. Live method availability waits for approved merchant setup and real confirmation authority.

## Dependency and handoff note

This lane owns only the manual-payment UI subtree. R33 owns the overall financial dashboard; it links to this workspace after coordinated route registration, without editing its files.

## Final response format

Report: sprint ID and scope; actual base/final/tree SHA; branch/PR; modified files and leases; implementation findings; exact tests and counts; source vs sandbox vs hosted evidence; policy/external blockers; rollback; and what the coordinator must integrate. Never say "fully production-ready" merely because local compile/tests passed. Do not merge or deploy.
