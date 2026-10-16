# R26 ownership and verified G1 start

Mode A: security integration and bug fixes. The owner authorized R26 after G1 and review PRs without merge/deployment.

- Frozen runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; complete runtime baseline tree `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Accepted publication: PR #170 merged `4475c45ea0df982c67c1e5969101030594553486`; successor PR #171 merged `0568739096ceeaf0cfc79034626886e258fe4328` on 2026-10-16T23:01:54Z. Both are reachable from develop. Latest PR #171 run per workflow passes, including corrected governance run 38978611954.
- Branch/worktree starts at published coordination base `0568739096ceeaf0cfc79034626886e258fe4328`, which is a descendant of the frozen runtime source. `git diff --exit-code` confirms apps/packages/scripts/infra/manifests/lockfile are identical to that frozen source; only accepted governance records/tests differ. This incorporates published acceptance without importing an unmerged peer or resetting another session.
- Assigned branch: `feat/r26-application-security`; worktree: `/workspace/scratch/0b9d25429780/hsm-r26`.
- GitHub open PR inventory was empty; this local branch did not exist locally or remotely before reservation. Other worktrees/stashes remain untouched.
- Publication verified at: `2026-10-16T23:07:50.983458+00:00`. R26 alone is authorized to start; other lanes remain held for their coordinator handoffs.

## Coordinator files reserved before editing

- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_PUBLICATION.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`

## Exact sprint files

- `apps/api/src/infrastructure/http/all-exceptions.filter.spec.ts`
- `apps/api/src/infrastructure/http/all-exceptions.filter.ts`
- `apps/api/src/infrastructure/http/deprecated-route.middleware.spec.ts`
- `apps/api/src/infrastructure/http/deprecated-route.middleware.ts`
- `apps/api/src/infrastructure/http/deprecated-routes.ts`
- `apps/api/src/infrastructure/http/request-id.middleware.spec.ts`
- `apps/api/src/infrastructure/http/request-id.middleware.ts`
- `apps/api/src/infrastructure/http/security-headers.spec.ts`
- `apps/api/src/infrastructure/http/security-headers.ts`
- `apps/api/src/infrastructure/throttle/app-throttler.guard.ts`
- `apps/api/src/infrastructure/throttle/rate-limit.module.ts`
- `apps/api/src/infrastructure/throttle/rate-limit.store.spec.ts`
- `apps/api/src/infrastructure/throttle/rate-limit.store.ts`
- `apps/api/src/infrastructure/throttle/registration-throttle.service.spec.ts`
- `apps/api/src/infrastructure/throttle/registration-throttle.service.ts`
- `apps/api/src/shared/security-events/security-events.bus.ts`
- `apps/api/src/shared/security-events/security-events.module.ts`
- `apps/api/src/shared/security-events/security-events.spec.ts`
- `apps/api/src/shared/security-events/security-events.ts`
- `apps/api/test/integration/r26-authorization.integration.spec.ts`
- `apps/web/e2e/r26-security.real-api.spec.ts`
- `docs/production-readiness/r26/ACCEPTANCE.md`
- `docs/production-readiness/r26/IMPLEMENTATION.md`
- `docs/production-readiness/r26/RISKS.md`
- `docs/production-readiness/r26/ROLLBACK.md`
- `docs/production-readiness/r26/shared-change-requests/CR-001-integration.md`
- `scripts/production/security-app/verify-boundaries.cjs`
- `scripts/production/security-app/verify-boundaries.test.cjs`
- `apps/api/src/infrastructure/http/cors-policy.ts`
- `apps/api/src/infrastructure/http/cors-policy.spec.ts`
- `apps/api/src/infrastructure/http/request-body.ts`
- `apps/api/src/infrastructure/http/request-body.spec.ts`
- `scripts/production/security-app/web-csp.cjs`
- `docs/production-readiness/r26/OWNERSHIP.md`

## Explicit shared-file lease

- `apps/api/src/main.ts`
- `apps/web/vite.config.ts`
- `apps/web/vercel.json`
- `apps/web/nginx.conf`
- `apps/web/Dockerfile` (lease extended before editing: expose exact public media/upload CSP build arguments only)
- `apps/web/playwright.config.ts`
- `apps/web/playwright.r26.config.ts`
- `apps/web/startup-tests/startup.spec.ts` (lease extended before editing: copy the new CSP build dependency into the existing isolated fixture only)
- `.github/workflows/r26-security.yml`

Only R26 request-boundary/CSP implementation and isolated acceptance wiring. No deployment, dependency, IAM permission, money-policy, peer-lane or unrelated design change. R26 PR closure, G2 decision or earlier coordinator revocation. Publish final head and scoped evidence; coordinator verifies no concurrent writer before reassignment.

## Runtime isolation

Use the manifest's R26-only disposable database, Redis, storage and ports 4326/5326 with separate browser cookie jars. No local Docker/Postgres/Redis executable was available at initial inspection; real-service tests will run in an isolated GitHub job if local provisioning remains unavailable. No user environment file, production secrets, hosted services, live funds or identity/permission grants are authorized.

## Owner-merged coordination update during execution

Develop advanced through owner-merged PR #172 to `07c8e584c684111bfc80995c7efb0144cfb6161b`. Its ten-file change is records-only; `git diff --exit-code 0568739096ceeaf0cfc79034626886e258fe4328 07c8e584c684111bfc80995c7efb0144cfb6161b -- apps packages scripts infra .github package.json pnpm-lock.yaml` passes. Preserve its all-lane READY_TO_START decision and new publication-verification records verbatim. The earlier R26-only reservation narrative is historical and does not override #172.

The current R26 coordinator lease covers reconciliation of the same eight coordinator paths listed above. Only R26 allowlist/lease/execution/PR data is layered onto #172; other lanes retain the owner-merged records. The new PUBLICATION_VERIFICATION files are inherited unchanged, not edited. PR #173 changed paths were inspected and have no overlap with R26 runtime/shared changes. No unmerged R27 code is imported. No rebase, reset, force-push, peer worktree edit or merge to develop occurs.
