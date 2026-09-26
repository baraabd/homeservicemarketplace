# Parallel development policy — Production Wave A

## Scope

One sprint = one branch = one PR = one acceptance report. The accountable owner is `@baraabd`; sprint labels are logical work reservations, not invented GitHub users or teams. A session works on only its assigned branch. Agents must not push to, merge into, force-push, or delete `develop`.

Record the actual branch-start base, current head, and final tested SHA. Existing work, especially another open PR, is not permission to overwrite or duplicate its files. Preserve unrelated working-tree changes.

## Ownership and exclusions

| Sprint | Owned work | Explicit exclusion |
| --- | --- | --- |
| S01 | Baseline inventory and release matrices | Production code and other sprints' reports |
| S02 | `.github/`, delivery and merge policy | Weakening CI or claiming settings changed from a file edit |
| S03 | Runtime/env validation, examples and infrastructure | Auth flow semantics; live payment activation |
| S04 | IAM, auth UI and session tests | Environment schema without S03 coordination |
| S05 | Seeker requests, wizard and public request media | Restricted identity evidence |
| S06 | Provider V2 shell, hub and persistence orchestration | Work Area owned by S07; Hours owned by S08 |
| S07 | Work Area, geo/market/service-area authority | Hours and unrelated onboarding UI |
| S08 | Working Hours and availability | Other Provider modules just because a broad glob includes them |
| S09 | Admin provider review and verification policies | Admin financials and Money |
| S10 | Money domain/persistence/contracts | Live checkout, Stripe/webhooks, live money movement |

S01's broad documentation path does not authorize modifying the reports in `runtime/`, `seeker-auth/`, `seeker-request/`, `provider-onboarding/`, `provider-work-area/`, `provider-hours/`, `admin-provider-review/`, `money/`, or `governance/` owned by another sprint.

## Shared authority reservations

| Authority | Accountable owner | Wave A reservation |
| --- | --- | --- |
| Prisma schema, migrations, database exports | `@baraabd` | S10 is the sole Migration Owner |
| Contracts and public barrel exports | `@baraabd` | Integration review before each cross-sprint change |
| `apps/api/src/app.module.ts` | `@baraabd` | Integration review; additive minimal edits only |
| `apps/api/src/config/env.schema.ts` | `@baraabd` | S03; S04/S05 request coordinated changes |
| Web routes and shared feature flags | `@baraabd` | Integration review; no unapproved cutover |
| `.github/workflows/**` | `@baraabd` | S02 is CI Owner for Wave A |
| Lockfile, root package/workspace definitions | `@baraabd` | Integration Owner; no incidental dependency refresh |

Before editing a shared file, record the requesting sprint, exact paths, purpose and coordinating PR in the PR body. Do not acquire a reservation by silently editing a file. Concurrent changes to the same authority file must be serialized. A migration requested by S04–S09 goes through S10 or waits; never use `prisma db push` or rewrite an applied migration to avoid coordination.

## Evidence and completion

All applicable lint, typecheck, unit, integration, browser, accessibility/RTL/mobile, production-build, Docker and security gates remain mandatory. CI and CodeQL must succeed on the final SHA after updating from `develop`. A renamed/skipped check, mock-only test, old SHA, queued run or source inspection does not prove acceptance.

Each report identifies implemented scope, actual commands and environments, PASS/FAIL/BLOCKED/NOT RUN, remaining risks and rollback. Keep a PR draft while implementation or acceptance evidence is incomplete. No count of branches or PRs is a production-readiness certificate.

## Safe integration

Fetch and compare before changing refs. Integrate the latest `develop` without discarding others' commits. Re-run affected gates after integration, inspect the final diff and confirm that the tested head has not moved. Do not merge automatically. Follow [MERGE_POLICY.md](MERGE_POLICY.md) for GitHub enforcement and the integration-wave gates.
