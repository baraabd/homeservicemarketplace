# CR-001 — serialized R26 integration lease

Status: APPROVED AND APPLIED by the current delegated coordinator under continuing owner authorization to implement R26 after G1, review PR only. Exact leases were recorded before writes in the Wave 2 manifest, registry and OWNERSHIP.md. One writer, this branch only.

| Exact shared path                    | Minimal change / reason                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/main.ts`               | Wire safe parser router and exact CORS origin builder; preserve raw-byte order, limits and existing guard topology.          |
| `apps/web/vite.config.ts`            | Bind enforced CSP metadata to actual build-time origins before resource loading; no development/HMR policy change.           |
| `apps/web/vercel.json`               | Replace report-only diagnostic header with enforced framing/object/base boundary; preserve disabled deployment setting.      |
| `apps/web/nginx.conf`                | Emit enforced framing headers in server and cache-header locations.                                                          |
| `apps/web/Dockerfile`                | Expose the two public media/upload CSP build-origin inputs; no package/image/user change. Lease extended before this patch.  |
| `apps/web/playwright.config.ts`      | Route the new real-service test exclusively to its required dedicated job rather than mocked/default suites.                 |
| `apps/web/playwright.r26.config.ts`  | Fail-closed disposable endpoints, two workers, zero retries, no raw session traces.                                          |
| `.github/workflows/r26-security.yml` | Independent service-backed authorization and production-bundle CSP/browser acceptance with sanitized source-bound artifacts. |

Coordinator record edits publish observed owner merges #170/#171 and authorize R26 only; the frozen runtime SHA remains unchanged. No schema/migration, dependency/lockfile, shared contracts, IAM permission grant, external spend, other-lane source, merge or deployment is included.

Validation: parser/CORS/header unit regressions, 17 policy tests, real PostgreSQL/Redis independent-session authorization and last-admin race, real SMTP/cookie/private-preview browser acceptance, API/web typecheck/build/lint and retained full CI/CodeQL/scanning. Missing current security-alert and hosted-topology evidence is recorded as blocking acceptance, not waived.

Successor exact-file lease: `apps/web/startup-tests/startup.spec.ts`, recorded before editing after final-head startup job 117248071720 exposed the missing root CSP helper in its isolated copy. Minimal patch copies that exact dependency with the existing Vite source. Preserve all six tests, legacy-config reproduction, cache/process isolation, strict filesystem allowlist, workers, timeouts and assertions. No workspace-recovery implementation is modified.

## 2026-10-17 continuation — upload-origin parity

Status: APPROVED before implementation by the continuing delegated coordinator;
exact successor worktree and single-writer ownership are in OWNERSHIP.md.

| Exact shared path                                    | Minimal patch and reason                                                                                                                                                 | Required verification                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/e2e/provider-onboarding-v2-basics.spec.ts` | Derive synthetic upload/file URLs from the intercepted presign request origin. The prior fixture used `127.0.0.1:4010` while CI built an exact `api.example.com` policy. | Preserve and pass genuine image encoding, rotation, PUT and finalize assertions in all three Chromium projects.                                              |
| `.github/workflows/ci.yml`                           | Set only Phase 5 API `PUBLIC_API_URL: http://127.0.0.1:4010`. Without it local storage returns `localhost:4010`, which differs from the SPA's exact API origin.          | Existing complete Phase 5 real-service journeys, including R06 attachment finalization and later persistence/authorization cases; unchanged aggregate gates. |

No schema, migration, dependency, public storage rule, cookie policy, guard,
CSP allowlist, production setting or unrelated workflow changes are requested.
The intended deployment still needs an owner-approved public API/storage
topology. This lease covers disposable CI and synthetic UI fixtures only.
