# Functional completion roadmap before Version 2 improvement

Baseline for this roadmap: `develop@24361c5cc71917d555d79024c485d3540fd41515`.

Purpose: complete the product's missing or non-authoritative functions first, prove
their real persistence/authorization/lifecycle behavior, and only then begin a
Version 2 product-experience improvement wave.

This document does not redefine the dated R01 baseline. It is the forward execution
plan after R05 closure.

## Execution rules

- One sprint = one branch = one PR = one acceptance report.
- No direct writes or merges to `develop`.
- Commit messages, PR titles/descriptions and GitHub review comments are English.
- A feature is not complete because a component exists or a mock/unit test is green.
  The authoritative server path, persistence, authorization, reload/relogin behavior
  and applicable real-browser path must be proven.
- Do not add fake success states, fabricated ratings, fabricated support responses,
  placeholder financial balances, fake GPS, or client-only persistence.
- Shared schema/migration/contracts/AppModule/workflow changes must be serialized.
- Live money remains disabled until the persistence foundation, provider integration,
  operational controls and explicit rollout acceptance exist.
- Version 2 visual/UX redesign begins only after the functional-completion gate below.

## Source-backed functional gaps

| Gap                           | Current source evidence                                                                                                                                         | Classification                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Request media ownership       | `RequestsService.create` forwards `input.mediaUrls`; request presign has no request-owned `MediaAsset` reservation                                              | Confirmed server authority gap                                         |
| Request-to-provider lifecycle | Core request/outbox behavior exists, but end-to-end attachment integrity, duplicate/race/recovery and matching-provider delivery still require final acceptance | Functional durability gap                                              |
| Reviews/reputation            | `JobDetailView` submits rating only to local state; Provider feed seeker rating is explicitly `null` because no reputation source exists                        | Missing authoritative feature                                          |
| Booking actions               | `JobDetailView` keeps Message/Call/Track disabled behind `isPlaceholderAction`                                                                                  | Missing/incomplete user actions                                        |
| Chat calling                  | `ChatScreen` phone control is disabled and labelled Coming soon                                                                                                 | Missing capability; requires explicit product/communications authority |
| Help & support                | `HelpSupportPage` uses seeded messages, local bot replies and `setTimeout`; no durable support-agent handoff is established                                     | Client-only placeholder behavior                                       |
| Provider budget view          | Available-request `toBudget()` returns all-null; no seeker-side budget authority exists                                                                         | Missing optional marketplace feature                                   |
| Provider withdrawals          | Wallet CTA is disabled; tests state there is no withdrawal endpoint                                                                                             | Missing financial capability                                           |
| Money authority               | Existing earnings/admin summaries are booking-derived read models; no authoritative financial ledger/execution controller is mounted                            | Missing platform foundation                                            |
| Provider V2 rollout           | V2 exists behind a build/runtime gate, but all-field persistence, map/hours negatives and artifact-level cutover evidence remain incomplete                     | Functional completion before cutover                                   |

These findings are intentionally separated from production-configuration-only gaps such
as real hosted SMTP/S3/TLS/secret-manager configuration. Both matter for release, but
they are not the same kind of work.

---

# Phase A — complete current product functions

## R06 — Request media authority and atomic attachment claim

**Priority:** Immediate next implementation sprint.

**Goal:** make every request attachment server-owned, byte-verified and atomically
claimed by exactly one seeker request.

**Primary paths**

- `apps/api/src/modules/media/**`
- `apps/api/src/modules/requests/**`
- `apps/api/src/infrastructure/storage/**`
- `packages/database/prisma/schema.prisma`
- `packages/contracts/**`
- request-wizard media client/tests

**Required implementation**

- Reserve each request upload as an owned `MediaAsset` with explicit purpose.
- Bind reservation to the authenticated owner; never infer ownership from URL/key text.
- Verify upload completion, declared size/type and received object before claim.
- Finalize immutable request attachments before or atomically with request creation.
- Claim reservations inside the request-creation transaction or an equivalent
  transactionally authoritative boundary.
- Reject external URLs, another user's assets, expired reservations, incomplete uploads,
  reused/previously-claimed assets and post-finalization overwrite attempts.
- Make orphan cleanup safe for abandoned reservations without deleting valid claimed
  request media.
- Preserve existing public-request media read behavior unless a deliberate contract
  migration is required.

**Acceptance**

Real PostgreSQL + real storage + real browser/API coverage for foreign asset, external
URL, partial upload, expired signature/reservation, concurrent claim, failed request
rollback, orphan cleanup and matching-provider visibility.

## R07 — Request creation, matching delivery and lifecycle recovery

**Depends on:** R05, R06.

**Goal:** prove the complete seeker request -> eligible provider -> bid/booking path and
repair only demonstrated lifecycle gaps.

**Required implementation / verification**

- Idempotent/repeated request submission policy.
- Past/invalid schedule rejection.
- Category + work-area matching consistency between provider list and detail.
- Wrong-provider and self-request denial.
- Outbox crash-after-commit recovery with no duplicate user-visible delivery.
- Request cancellation/reopen races.
- Attachment visibility only after R06 authority succeeds.
- Reload/relogin consistency for seeker and provider.

**Acceptance**

Real database, outbox worker and two-browser-role journey with direct database
assertions at transaction boundaries.

## R08 — Provider V2 all-field authority completion

This is not a visual redesign. It closes functional authority gaps in the existing
feature-gated V2 onboarding.

**Goal:** every required V2 field survives acknowledgement, navigation, reload,
fresh login and direct database read, with stale/offline/session-loss negatives.

**Acceptance**

All six onboarding tasks, no browser override used to fake the deployed flag, and
field-level evidence rather than one sample per task.

## R09 — Work area, map and marketplace geo authority

**Depends on:** R07, R08.

**Goal:** make map/work-area behavior and marketplace visibility agree on one geographic
authority.

**Acceptance**

Mobile touch, keyboard, permission denied, manual fallback, low-accuracy/out-of-market
coordinates, radius boundary, persistence/relogin and representative query-plan tests.
No fake live GPS/tracking is added.

## R10 — Working hours and schedule durability

**Depends on:** R08.

**Goal:** close weekly-hours concurrency/timezone behavior before Provider V2 cutover.

**Acceptance**

Overlap/adjacency, empty week, timezone, concurrent writers, relogin/DB equality and a
separately documented appointment/DST policy.

## R11 — Reviews, ratings and reputation authority

**Status (2026-10-03):** implemented on `feat/r11-reviews-ratings-reputation-authority`,
pending merge. Policy, authority matrix and evidence:
[r11/REVIEW_POLICY.md](r11/REVIEW_POLICY.md),
[r11/REVIEW_AUTHORITY_MATRIX.md](r11/REVIEW_AUTHORITY_MATRIX.md),
[r11/IMPLEMENTATION.md](r11/IMPLEMENTATION.md).

**Goal:** replace the current local-only rating success with a durable post-completion
review system.

**Required implementation**

- Add an authoritative review/rating persistence model with one-review-per-eligible-
  booking invariant and idempotent submission policy.
- Only an eligible participant can review after the allowed booking state.
- Update/provider reputation aggregates transactionally or derive them from authoritative
  reviews without drift.
- Replace the local `JobDetailView` rating success with a real mutation and persisted
  read-back.
- Populate provider-facing seeker reputation only if the product policy explicitly
  allows it; otherwise remove/retain the null field rather than fabricate a score.
- Define edit/delete/moderation policy explicitly.

**Acceptance**

Authorization, double-submit race, cancelled/incomplete booking denial, aggregate
consistency, reload/relogin and public/provider projections.

## R12 — Booking communication and job actions

**Status (2026-10-03):** integrated on `feat/r12-booking-communication-job-actions` over develop
`21b98b7` (R11 merged); acceptance blocked on owner decisions (calling model; the unpatched
dev-only `braces` advisory failing the zero-finding audit) and the R05 prerequisite PR #131. See
[r12/IMPLEMENTATION.md](r12/IMPLEMENTATION.md), [r12/COMMUNICATION_POLICY.md](r12/COMMUNICATION_POLICY.md),
[r12/ACTION_AUTHORITY_MATRIX.md](r12/ACTION_AUTHORITY_MATRIX.md).

**Goal:** remove unsupported disabled actions where a real authoritative capability
already exists, and explicitly bound actions that require new infrastructure.

**Required implementation**

- Wire booking/request Message to the existing conversation membership authority.
- Ensure correct conversation creation/reuse and participant privacy.
- Define Call as either an explicit external phone handoff with consent/privacy policy,
  an in-app communications feature with its own backend, or keep it intentionally absent.
- Define Track from real booking/timeline state. Do not display live-provider location
  unless a real consented location source and retention policy are implemented.
- Remove generic Coming soon actions when the product decision is to omit them.

**Acceptance**

Two-party browser journey, wrong-user denial, repeated-open idempotency, privacy-safe
contact data and no fabricated tracking state.

## R13 — Durable Help & Support

**Status (2026-10-03):** implementation in progress on `feat/r13-durable-help-support`.
The sprint replaces client-only seeded support chat with authenticated support tickets;
final acceptance waits for the post-R12 security baseline recovery to return develop to green.

**Goal:** replace seeded/local support chat behavior with honest support functionality.

**Required implementation**

- Keep static FAQ content only as static FAQ.
- Add support ticket/conversation persistence if in-app support is a product requirement.
- Persist requester, message, status, timestamps and support ownership/assignment.
- Remove the fabricated "agent will respond shortly / under 5 minutes" promise unless a
  real SLA/queue can support it.
- Persist support rating only if it is actually consumed; otherwise remove the false
  submission control.

**Acceptance**

Create/reload/relogin, user ownership, admin/support read/write permission, closure/reopen
policy, audit trail and failure/offline behavior.

## R14 — Budget / quote intent authority

**Goal:** resolve the current all-null provider budget shape.

**Product decision required before implementation:** either:

1. add seeker optional min/max/currency budget input and persist it on the request, with
   validation and provider projection; or
2. remove/hide the budget concept until the product is ready.

Do not create a provider-visible number that the seeker never entered.

**Acceptance if enabled**

Currency/min/max validation, historical request immutability, provider privacy projection,
edit/cancel semantics and locale rendering.

## R15 — Authoritative Money persistence foundation

**Goal:** create a dark, non-live accounting authority before any withdrawal button is
enabled.

**Required implementation**

- additive ledger/account/transaction/entry persistence;
- integer minor units and currency invariants;
- idempotency keys;
- balanced-entry database invariants;
- reversal rather than destructive history edits;
- booking/payment reference binding;
- auditability and concurrency behavior.

No live checkout, capture, payout or provider credential is enabled in this sprint.

**Acceptance**

Real PostgreSQL concurrency/idempotency/reversal/rollback tests plus migration
upgrade/rollback-operability evidence.

## R16 — Payout / withdrawal capability

**Depends on:** R15 plus an explicitly selected payout/provider/compliance model.

**Goal:** replace the disabled withdrawal CTA only when there is real money authority.

**Required behavior**

- eligible available balance;
- pending/settled/failed states;
- idempotent withdrawal request;
- server-side limits and destination authority;
- audit trail and reconciliation;
- safe retry/webhook/event handling if an external provider is used.

Until those dependencies exist, the disabled CTA must not be converted into fake
success.

## R17 — Current-product communication, notification and admin completeness

**Goal:** finish/accept the already-implemented-but-not-production-certified surfaces.

Includes:

- notification lifecycle and optional realtime cutover;
- seeker/provider messaging persistence and cross-instance behavior;
- dispute user/admin journeys;
- Admin users/settings/analytics/notifications/audit sections;
- provider feed/bids/bookings/public profile/status center;
- negative permission and stale-session paths.

This sprint may be split into smaller PRs if the diff would cross unrelated authority
boundaries; the one-sprint/one-PR rule still applies to each resulting unit.

## R18 — Functional completion gate

**Goal:** certify that the current product no longer relies on client-only fake success
or known placeholder business actions for the agreed production scope.

Required evidence:

- Seeker: auth, profile, address, catalog, request/media, bids, booking, review,
  messaging, notifications, disputes and support scope.
- Provider: onboarding, work area, hours, verification, feed, bid, booking, messaging,
  profile/reputation and earnings scope.
- Admin: provider review plus the agreed operational/admin sections.
- Cross-role: request -> provider -> bid -> booking -> completion -> review/dispute.
- Full CI, CodeQL, security scans, Docker/Compose and affected real-service browser
  journeys on the final integration head.

Only after R18 is accepted should the Version 2 improvement wave begin.

---

# Phase B — Version 2 product improvement

This phase improves the experience without using redesign work to hide unfinished
business authority.

## V2-01 — Information architecture and navigation

- simplify Seeker/Provider/Admin navigation;
- remove duplicate/legacy surfaces after usage and route audit;
- preserve deep links and authenticated return targets;
- define canonical empty/loading/error/offline states.

## V2-02 — Design system and interaction consistency

- consolidate typography, spacing, cards, forms, dialogs, states and motion;
- remove one-off component styling where it creates behavioral inconsistency;
- keep Arabic RTL and English LTR first-class.

## V2-03 — Mobile, RTL and accessibility refinement

- 360/390px primary acceptance;
- WCAG 2.2 AA keyboard/focus/contrast/semantics;
- logical CSS and bidirectional icon/text behavior;
- reduced-motion and touch-target requirements.

## V2-04 — Performance and perceived speed

- route/code splitting;
- bundle-size budgets;
- query/cache ownership;
- skeleton strategy without hiding errors;
- image/media optimization;
- measured cold start and interaction targets.

## V2-05 — Marketplace discovery and matching quality

Only after R07/R09/R11 data is authoritative:

- ranking/relevance based on real category, distance, availability and standing;
- transparent filters and reasoned empty states;
- no inferred/fabricated scores;
- representative query-plan and latency evidence.

## V2-06 — Realtime experience and resilience

- opt-in Socket.IO cutover only with cross-instance acceptance;
- polling fallback;
- reconnect/deduplication/offline behavior;
- notification consistency across tabs/devices.

## V2-07 — Product analytics and operational observability

- privacy-bounded funnel events;
- error/performance telemetry;
- request/provider conversion and failure diagnostics;
- no raw private evidence, credentials or unnecessary precise location in telemetry.

## V2-08 — V2 cutover, migration and rollback

- exact artifact/build provenance;
- removal of obsolete QA/browser overrides where approved;
- legacy-route compatibility window;
- migration/rollback rehearsal;
- final browser matrix for mobile/tablet/desktop, Arabic/English, light/dark where
  applicable.

---

## Immediate next branch after this roadmap

`feat/r06-request-media-authority`

R06 is first because it is a confirmed server-side ownership gap on the primary Seeker
request path. UI redesign, new ratings, support polish or V2 visual work must not precede
fixing attachment authority for newly created service requests.
