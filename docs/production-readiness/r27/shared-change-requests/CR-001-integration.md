# CR-001 — remaining R27 integration and budget decisions

**State: INTEGRATION_PENDING; proposals only.** This request authorizes no
shared runtime, schema, migration, security-policy or budget write by R27.
The coordinator serializes the work or records an exact lease before another
writer starts. Existing applied R27 repairs retain the leases in
`../G1_HANDOFF.json`.

## Evidence and decision to make

Frozen runtime: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`. The repaired
measurement source is PR #173; its immutable run/artifact identities are in
`../ACCEPTANCE.md`. The retained diagnostic pair from workflow 38982468755
already established the findings below. Complete repaired-source run 39032727959
on afec37ae reproduced the same byte/query structure and four proposal findings;
its timing comparison is limited by Intel-versus-AMD runner CPUs. Review that
complete evidence before a policy decision; the four proposed checks are not
silently converted to accepted limits.

| Existing proposal                                             | Measured candidate                                                      | Decision owner and required action                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeker requests: at most 5 statements                         | 6, with page-bounded bid aggregation and no broad Bid scan              | Performance owner: review the bounded extra query against actual DB time, returned-count correctness and page-size invariance; approve a revised proposal or request a measured alternative. |
| Provider available requests: at most 10                       | 13 for populated results, unchanged between frozen and candidate        | Provider owner and performance owner: review the populated-page projection described below, then calibrate the proposal against representative pages.                                        |
| Provider bookings: at most 7                                  | 12 for populated results, unchanged between frozen and candidate        | Provider owner and performance owner: review unused list hydration and separately account for cursor-ownership validation.                                                                   |
| Admin completed-bookings list: no large-table sequential scan | Booking sequential scan over 5,418 rows; zero completed-booking results | Database/migration owner: create a representative completed-booking fixture, compare actual plans and implement an evidence-backed forward index migration if justified.                     |

The provider ceilings came from empty pre-G1 pages. Their extra populated-page
queries are existing relation hydration, not a new R27 guard or source
regression. Current counts remain bounded at page sizes 5 and 20. Do not remove
authorization checks, reduce fixture coverage, or change thresholds merely to
make the proposal evaluator pass.

## 1. Seeker bounded aggregation and owner-approved budgets

Review the already-leased
`apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
and its adjacent spec. R27 intentionally moved bid counting to one query over
the authorized returned request IDs. Empty pages must avoid that query; visible
and zero-count requests retain the existing DTO semantics.

The concrete configuration proposal for owner review is the following three
field changes under `queries.statementsPerRequestMax` in
`scripts/perf/post-r18/budgets.proposed.json`:

```diff
-      "seeker requests": 5,
+      "seeker requests": 6,
-      "provider available requests": 10,
+      "provider available requests": 13,
-      "provider bookings": 7,
+      "provider bookings": 12,
```

These edits are proposed only; the actual configuration is unchanged. The
owner may instead commission the measured projection alternatives below.
Approval must state dataset, empty/populated pages, page sizes 5/20/supported
maximum, sample counts and confidence limits. Record deciding owner, date,
source/harness SHAs and approved budget digest before any enforcement is
added. Verify ownership, deleted-state handling, cursor stability,
query bounds and EXPLAIN plans alongside latency; a lower statement count
alone is not acceptance.

## 2. Provider available-request projection

Exact read targets for a serialized provider-owner patch:

- `apps/api/src/modules/provider/available-requests/available-requests.service.ts`
  — `list()` and the fields it consumes.
- `apps/api/src/infrastructure/persistence/bids/provider-profile.repository.ts`
  — `findByUserIdWithCategories()` and shared `PROFILE_INCLUDE`.
- `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
  — `listAvailableForProvider()`.
- `apps/api/src/infrastructure/persistence/bids/bid.repository.ts`
  — `countActiveByRequestIds()`.

Minimal candidate: add a feed-specific profile projection with approved category
IDs and service-area inputs, excluding unused pending-category applications or
full relation payloads. Do not trim the shared `PROFILE_INCLUDE` used by other
flows. Current populated-page work includes category/seeker hydration and a
bounded bid-count aggregation; retain each required public-preview field.
This is a reviewable direction, not a measured promise that ten statements are
attainable.

Acceptance must preserve approved active categories, work eligibility,
service-area/radius filtering, own/already-bid request exclusion, open/deleted
states, private seeker-field restrictions, and the route's existing `no-store`.
Missing approved categories or service area must still produce the intended
empty result. Exercise empty, populated and amplified datasets, several page
sizes, unauthorized roles, and cursor traversal. The owner selects adjacent
existing tests and records any new exact test path before editing.

## 3. Provider bookings list projection

Exact read targets:

- `apps/api/src/modules/provider/bookings/provider-bookings.service.ts`
  — `list()` and `toSummary()`.
- `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
  — `listForProvider()` and `isCursorOwnedByProvider()`.
- `apps/api/src/modules/provider/bookings/provider-bookings-canonical.controller.ts`
  and `apps/api/src/modules/provider/bookings/provider-bookings.controller.ts`
  — canonical/legacy guard and DTO compatibility review; no guard patch proposed.

Minimal candidate: a dedicated list include/select may omit `row.provider`,
which `toSummary()` does not consume. This can remove one existing hydration
query if confirmed by the real plan; it does not justify removing every
relation or promising the historical seven-query ceiling.

Preserve `ManageBookings` versus `ViewMarketplace` capability boundaries, the
provider's ownership filter, deleted rows, ordering, cursor validation and the
existing compatibility endpoints. A foreign cursor stays rejected; an owned
soft-deleted cursor retains its specified behavior. A cursor page may require
an additional legitimate ownership query compared with the first page.
Use negative and concurrent-update tests plus real PostgreSQL plan/count and
page-walk evidence. No schema, contract, dependency or migration is expected
for this projection-only candidate.

## 4. Financial completed-booking index and representative fixture

This extends existing CR-R27-06; it does not duplicate money authority.
Exact shared targets are `packages/database/prisma/schema.prisma`, model
`Booking`, and one new forward migration whose exact path the migration owner
must choose and record before writing. Read consumers are
`apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
(`listCompletedBookingsForAdmin`) and
`apps/api/src/modules/admin/financials/admin-financials.service.ts`.

The earlier CR-R27-06 proposed a status/sort index. The owner should also
evaluate this candidate covering the current deletion predicate:

```prisma
@@index([status, deletedAt, updatedAt(sort: Desc), id(sort: Desc)], map: "Booking_status_deletedAt_updatedAt_id_idx")
```

Populate completed bookings at representative status/deletion distributions
before comparing plans. The current 5,418-row fixture has zero completed
results, so it cannot establish financial pagination or index benefit. Review
the `deletedAt IS NULL` predicate, sort order and cardinality using generic
and representative parameter-bound plans plus measured DB time. Choose a full
or partial index from that evidence;
do not require an index scan on a tiny table where a sequential plan is valid.
Do not disable sequential scans to force a desired plan. The current proposed
three-statement financial-list ceiling also came from an empty result and must
be re-evaluated with populated relation hydration before approval.

Run schema validation, migration verification, forward deployment on the
disposable database and drift checks. Review concurrent creation and transaction
constraints for the deployment environment; do not execute a production
migration from this lane. Add completed-row pagination and concurrent-update
coverage. Preserve all financial amounts, ledger immutability, constraints,
ownership and R16/R18 policy holds. Roll back through a reviewed forward
migration that drops only the added index.

## 5. Explicit private HTTP cache policy

The HTTP/security owner resolves CR-R27-04 in
`apps/api/src/main.ts` or an owner-selected existing interceptor registration.
The measured G1 audit has 15/17 private reads without an explicit cache header;
seeker notifications and provider available requests already send `no-store`.

Apply the default early enough to cover parser/guard rejection responses, and
test private successes plus 401/403/404/429 and validation errors. Preserve raw
upload/feedback body handling. Add a private/no-store policy without weakening explicit private
media behavior or the allow-listed immutable public-media route. Test parsed
directives, not a single literal header string: controller overrides with
`no-store` already satisfy the non-storage property. Separately verify actual
conditional-response behavior; the header alone does not suppress all 304s.

Retain ten asserted API negatives and record three informational same-user
ETag observations. R27 browser coverage checks same-context admin-to-seeker
account switching and rejection of the admin read. Cross-tab sign-out and
active-session role/permission revocation require the security owner's real
browser acceptance; source inspection of a storage listener is not that test.
No migration, schema or dependency change is proposed.

## Coordinator integration and release boundary

The pre-publication inventory at 2026-10-17 12:50 UTC found active R25 PR #175
(`5496a887c88808db193718169137ae4f8ce29159`) and R26 PR #174
(`ab089d14ec7141977db083e55b6165e493c2bb04`). Develop remained
`07c8e584c684111bfc80995c7efb0144cfb6161b`. These are coordination observations,
not accepted dependencies or permission to import their source. In particular,
coordinate CR04 with the active R26 HTTP/security owner before assigning a writer.

1. Transcribe the existing exact R27 lease extension into coordinator-owned wave
   records, reconcile the current `develop` head and active writers, and release
   the relevant shared files before assigning another editor.
2. Integrate the reviewed candidate on the coordinator's candidate branch and
   rerun required CI, CodeQL, real PostgreSQL/Redis/browser evidence and the
   approved budget contract. Isolated R27 success cannot accept the full wave.
3. Hand R37 the declared normal, burst, realtime, expensive-upload and recovery
   profiles in `docs/performance/post-r18/WORKLOAD_PROFILES.md`. The executed
   200-request profiles and shared-VM samples do not establish hosted capacity.
4. Record owner decisions and remaining R16/R18 holds. Keep PR #173 Draft while
   required evidence or budget approval is missing. Only the coordinator accepts
   the wave; merge, deployment, live funds and verification decisions need the
   owner's separate authorization.

No external resource purchase, production change, central metadata write,
account grant or migration was performed by publishing this request.
