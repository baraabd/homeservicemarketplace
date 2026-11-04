# Open pull request integration — 2026-11-04

Mode A: integration and bug fixes. User requested repair, conflict resolution,
verification and merge of every open pull request before deployment activation.

## Source and scope

Base: develop `d0690dd626eae55d39b9c592ba6639b594a01032` (PR #210 merged after
all 40 GitHub checks passed on `ad0a74fc1a086c19801af0a03aa4885d325f5e78`).
The integration preserves the original heads of #204–#209 and #211–#214 as
ancestors; it does not discard or squash their work. Historical evidence in
each K directory remains historical, not a claim about this combined tree.

| PR      | Scope                                          | Integration repair                                                                                                                     |
| ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 204     | Vercel delivery preparation                    | Keep K01 dependency fixes and qs 6.16.2; register CD in the CI inventory; require HSM_CD_ENABLED before delivery                       |
| 205–207 | K10, K09, K08 acceptance dossiers              | Preserve the explicit blocked status; documentation merge is not launch certification                                                  |
| 208     | Provider feed pagination                       | Combine with the customer and Saudi contracts changes                                                                                  |
| 209     | Serialize request edits with booking lifecycle | Combine both real lifecycle test additions                                                                                             |
| 210     | Dependency and startup baseline                | Merged first; no audit suppressions                                                                                                    |
| 211     | Staging configuration and source identity      | Replace substring URL regex with exact CSP source-token membership (CodeQL finding)                                                    |
| 212     | Repeat subscription purchases                  | Preserve new purchase intent and finance routing behavior                                                                              |
| 213     | Saudi amount units and policy acceptance       | Correct legal endpoint UI fixtures, normalized-phone persistence expectations, and explicit hourly bid selection/price regex           |
| 214     | Admin authority and support                    | Preserve fresh authority checks, self-review denial and support notifications; resolve fixture type conflict while retaining SAR scale |

The legal-policy API client now rejects malformed response shapes as a query
error so the signup form can show its existing retry state, rather than crash.
It never treats a malformed response as approval or opens registration.

## Verification

- Frozen install: Node 24.21.0, pnpm 10.32.1. The only lockfile change after
  K01 is the qs 6.16.1 → 6.16.2 patch and its published integrity.
- Full dependency audit and production audit: zero findings at all severities.
- Combined built-in controls: 1,078 passed, zero failed/skipped; dependency and
  inventory controls: 55 passed. Immutable R27 dependency controls passed.
- API and web builds passed. Web: 234 suites / 2,794 tests passed. API:
  313 suites / 5,534 tests passed, with 104 suites / 1,921 real-service tests
  skipped by their existing environment gates. Jest reported a worker teardown
  warning despite the successful exit. E2E TypeScript checks passed.
- Local results cover the integration source tree. Real-service/browser CI and
  final-source security checks must pass on the integration PR's actual final
  SHA. This document is not a substitute for those checks.
- Local Docker services are unavailable in this environment. Hosted CI owns
  the real PostgreSQL/Redis/ClamAV, migration, container and browser acceptance.
- Dependency-only R27 controls retain previous runtime trees, register the
  eight dependency blobs, and include the patched qs without changing budgets.

## Deployment remains separate

`HSM_CD_ENABLED` must be explicitly true before the Vercel workflow starts.
No deployment, migration against hosted data, domain cutover or production
feature activation is performed by this integration.

The connected Vercel inventory contains `homeservicemarketplace-web`.
The connected Railway inventory contains only unrelated HighStyle projects;
there is no HSM service to deploy or database to restore in that inventory.
Do not reuse their data or credentials.

Railway is not technically mandatory: current Vercel supports NestJS,
WebSockets and continuous workers through Daemons. For this existing
application, Vercel web plus Railway API and supporting services is the more
direct deployment path. An all-Vercel setup requires separate worker
entrypoints, suitable external PostgreSQL/Redis/object storage, and a supported
private malware-scanning path. It is not achieved by adding DATABASE_URL to
the existing Vite frontend.

Official references checked 2026-11-04:

- https://vercel.com/docs/frameworks/backend/nestjs
- https://vercel.com/docs/functions/websockets
- https://vercel.com/docs/daemons
- https://railway.com/guides/saas-backend

Before activation, supply isolated staging/production HSM resources, final web
and API origins under the same registrable domain, runtime and migration DB
roles, Redis, three distinct S3 buckets, scanner, SMTP and application secrets.
Use the exact variable contract in `.env.example`,
`apps/api/src/config/env.schema.ts` and `docs/deployment/VERCEL_CD.md`.
The current API reads SMTP settings; a standalone RESEND_API_KEY on the Vite
project does not configure email delivery. Variables on tekram-coming-soon do
not automatically configure homeservicemarketplace-web.

The approved operating entity, legal texts, identity policy, subscription and
refund policy, hosted restoration drill and joined release evidence still
require completion as recorded in K02/K07/K08/K09/K10. In particular,
production signup remains closed while the legal documents are DRAFT.
No owner/legal approval or hosted acceptance is fabricated.

## Rollback

Revert the integration application/configuration changes together against a
known compatible release. The K02/K06 migrations are additive; do not drop
columns or acceptance records to roll back application code. Reverting admin
authority fixes reopens the security defects. Keep CD disabled until the
reverted source, schema and environment are independently verified.
