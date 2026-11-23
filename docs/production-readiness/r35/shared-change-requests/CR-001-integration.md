# R35 CR-001 — Gate and certification execution integration

Status: **REQUEST ONLY / NOT APPLIED**. No shared-file lease is granted.

## G3 correction and prerequisite handoff

Do not change the gate decision or fill a frozen SHA from an observation.
The exact coordinator-owned path
`docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json` still says
all R29 paths are absent. Minimal proposed record correction: replace the
`G3-R29-IMPLEMENTATION-MISSING` blocker id/reason with a runtime-integration
blocker noting merged PR #193 (`794e9ce82978f94c97ad598e7d1f3708020c6fc1`),
while retaining BLOCKED, null candidate/frozen identities, every mandatory
evidence category and the refund/external-evidence holds. Update the matching
G3 review documents in the coordinator's serialized change, not this lane.

Reuse R29's existing requests, rather than a second router/SDK authority:

- `docs/production-readiness/r29/shared-change-requests/CR-001-sdk-api-pin.md`:
  `apps/api/package.json` and `pnpm-lock.yaml`; official SDK and purchase
  contract/surface decision. Recheck current advisories; its historical audit
  prose is not a current security finding.
- `CR-002-raw-body-wiring.md` in the same directory:
  `apps/api/src/infrastructure/http/request-body.ts`, its `.spec.ts`,
  `apps/api/src/app.module.ts` and its `.spec.ts`; exact bounded raw-body
  route and one ingress mount, unchanged authorization/CSRF boundaries.
- `CR-003-inbox-binding.md`: `apps/api/src/modules/money/money.module.ts`,
  its `.spec.ts`, proposed `adapters/money-rail-router.ts` and its
  `.spec.ts` under that module, and `.github/workflows/ci.yml`; exact
  rail selection, real workers and unchanged fail-closed defaults.

Product/policy approval and the actual refund consequence participant remain
required. Configuration must use the approved secret provider, expiring
sandbox authority and supported account binding. No credentials are requested
in Git. Do not grant real permissions, configure a provider account or select
commercial policy from this request.

Required gate verification: actual runtime registration and purchase surface;
both-rail collection/refund/activation/outbox transactions; independent Stripe
sandbox and authorized manual evidence; unchanged ownership/idempotency/privacy
negatives; all seven G3 categories on the same full source/tree and source-bound
artifacts; final CI/official CodeQL; separate owner-reviewed publication merge.
Only then edit the coordinator's registry/wave plan to assign the exact lane.

## Exact certification integration request

R35 source/test authoring remains blocked until its 18-file conditional plan
and frozen G3 base are assigned. Reuse established real-API fixtures and normal
login; do not import an unmerged R34 lane or edit peer product code.

The minimal later shared patch is confined to:

- `.github/workflows/ci.yml`: add a dedicated isolated R35 certification
  job (or approved serialized step), backed by real PostgreSQL, Redis,
  restricted storage/scanner and SMTP. It must execute the new R35 real-API
  specs explicitly, never include them only in a mocked run, and require
  the evidence verifier's exact scenario counts before artifact upload.
- `apps/web/playwright.config.ts`: ensure new R35 specs are excluded from
  ordinary mocked discovery and included only in the dedicated real-service
  profile; approve the exact profile design before changing this global file.
  Preserve all existing projects, assertions, timeouts and budgets.
- Proposed `apps/web/playwright.r35.config.ts`: if a separate configuration
  is selected, the coordinator authors it or grants one exact lease. Require
  the intended API/SPA origins, independent role contexts, declared widths,
  languages and approved engines. No route mocks; no private raw traces.
- `docs/production-readiness/post-r18/waves/wave-04.plan.json` and
  `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`: only after
  verified G3 publication, assign the exact frozen source, session and any
  approved configuration path. This preflight changes neither record.

No package manifest, dependency, shared contract, schema or migration change
is requested by the certification itself. Browser downloads are execution
inputs, not evidence for an engine that did not run. Existing Chromium-only
projects do not imply Firefox/WebKit support or acceptance.

## Evidence and privacy checks

The runner must bind source/tree, fixture identities, migration/contract and
non-secret config digests, API build source, frontend served entry/chunk digests
and intended API origin. Require declared expected/passed/failed/skipped/todo/
flaky counts and reject absent, cancelled, skipped or stale mandatory evidence.

Normal visible UI login precedes each role journey; use authorized read APIs
and disposable database invariants afterwards. Test price/body/currency
tampering, stale revisions, repeated submits, revocation plus new login and
network recovery. No direct production writes or unapproved role grants.

Upload only sanitized summaries and synthetic/cropped/redacted screenshots.
Private notes, receipt/identity originals, session/token material and raw
external responses must not be artifact inputs. Actual privacy inspection and
bundle/API parity remain NOT RUN until a real candidate is executed.

## Closing criteria and final join

Execute the matrix in IMPLEMENTATION.md on the accepted G3 source, including
real Stripe/manual collection and approved refund/entitlement consequences.
Missing credentials/hosted target blocks that acceptance rather than skipping it.
Freeze the resulting suite for the coordinator's final Wave 4 rerun after R34.
R35 preparation never substitutes for R34 reconciliation or final release approval.
