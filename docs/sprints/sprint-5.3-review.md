# Sprint 5.3 Review Report — Provider Submit Bid + My Bids

## 1. Planning Summary

- **Scope:** Ship the provider's bid write surface (submit + list mine + withdraw)
  with the same security posture as the rest of the marketplace: no client-trusted
  provider identity, no over-posting via `forbidNonWhitelisted`, transactional
  side-effects (timeline event + seeker notification), and a narrow wire DTO that
  hides the seeker. Replace the legacy `useEcosystem().submitBid` mock + the
  hardcoded "Omar K." filter on `MyBidsScreen` with real React Query state.
- **Existing files inspected:**
  - `apps/api/src/modules/bids/bids.service.ts` (seeker-side accept-bid pattern)
  - `apps/api/src/infrastructure/persistence/bids/bid.repository.ts`
  - `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
  - `apps/api/src/modules/notifications/notifications.module.ts`
  - `packages/contracts/src/seeker/bids/**`
  - `apps/web/src/app/components/provider/ProviderApp.tsx` — `BiddingModal`,
    `LiveJobsScreen`, `MyBidsScreen`
  - `apps/web/src/lib/provider/{provider-jobs-api,query-keys,available-jobs-adapter}.ts`
- **Dependencies found:** Sprint 5.2 already added the available-jobs feed +
  the `BidRepository.countActiveByRequestIds` / `findRequestIdsBidByProvider`
  helpers; this sprint can layer on top of them. The seeker-side accept-bid
  flow's transactional pattern (request status check → status flip → siblings
  → events → notifications) is reused for submit + withdraw.
- **Risks found:**
  - One-active-bid-per-(provider, request) invariant is enforced at the
    application layer (Prisma can't express partial uniques on
    `status != WITHDRAWN`). Mitigation: explicit `findActiveBidForRequest`
    check inside the submit transaction.
  - The legacy `BiddingModal` simulated submission with `setTimeout(... , 1200)`
    — that's the kind of "fake persistence" CLAUDE.md prohibits. Replaced
    with a Promise-driven flow that awaits the real mutation.
  - `MyBidsScreen` filtered on `providerName === 'Omar K.'` — replaced with
    real `useMyBids()` data; client-side filters out WITHDRAWN bids since
    the existing UI only renders pending / accepted / rejected tabs.

## 2. Implementation Summary

- **Files added:**
  - `packages/contracts/src/provider/bids/{request,response,index}.ts` — full
    barrel: `SubmitBidRequest`, `ListMyBidsQuery`, `MyBidSummary`,
    `MyBidRequestRef`, `ListMyBidsResponse`, `SubmitBidResponse`,
    `WithdrawBidResponse`.
  - `apps/api/src/modules/provider/bids/dto/submit-bid.dto.ts`
  - `apps/api/src/modules/provider/bids/dto/list-my-bids.query.ts`
  - `apps/api/src/modules/provider/bids/provider-bids.controller.ts`
  - `apps/api/src/modules/provider/bids/provider-bids.service.ts`
  - `apps/api/src/modules/provider/bids/provider-bids.service.spec.ts`
  - `apps/web/src/lib/provider/provider-bids-api.ts`
  - `apps/web/src/app/hooks/provider/useMyBids.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/bids/bid.repository.ts` — added
    `findActiveBidForRequest`, `findOwnedByProvider`, `listForProvider`,
    `createForProvider`.
  - `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
    — added unscoped `findById` for the provider-side reads (the seeker-scoped
    `findOwned` is preserved untouched for the seeker side).
  - `apps/api/src/modules/provider/provider.module.ts` — register the new
    controller + service; import `NotificationsModule` for the seeker-fan-out.
  - `apps/web/src/lib/provider/query-keys.ts` — add `bids.{root,list}`.
  - `apps/web/src/lib/provider/available-jobs-adapter.ts` — export
    `iconForCategorySlug` and add `formatResponseTime` /
    `formatRelativeTime` helpers.
  - `apps/web/src/app/components/provider/ProviderApp.tsx`:
    - `BiddingModal` now drives sending/done/error from a real Promise
      (`onSubmit: (input) => Promise<void>`) and renders a safe error
      string on failure.
    - `LiveJobsScreen.handleBidSubmit` calls `useSubmitBid().mutateAsync`.
    - `MyBidsScreen` reads from `useMyBids()` (30 s polling) — the
      `useEcosystem` mock is no longer consumed by either provider screen
      touched in 5.2 / 5.3.
  - `postman/hsm-provider.postman_collection.json` — added folder
    `30 — Bids (Sprint 5.3)` with positive submit + duplicate negative +
    field-smuggle negative + list + withdraw + already-withdrawn negative.
  - `packages/contracts/src/provider/index.ts` — re-export bids.
- **Migrations added:** none (the schema already had every column the
  endpoints write).
- **Contracts added/changed:** `provider/bids` subdomain published.
- **UI added/changed:** `BiddingModal` and `MyBidsScreen` wired to the API;
  visual code untouched.
- **API endpoints added/changed:**
  - `POST /v1/me/provider/bids` — submit a PENDING bid. Guards: Jwt + Roles
    - ProviderActiveGuard + CSRF. Transactionally writes the bid, the
      `REQUEST_UPDATED` timeline event with `{ newBidId, providerId }` metadata,
      and a `BID_RECEIVED` notification to the seeker.
  - `GET /v1/me/provider/bids?status&limit&cursor` — cursor-paginated list of
    the calling provider's own bids, default 20, max 100, ordered by
    `[submittedAt DESC, id DESC]`.
  - `POST /v1/me/provider/bids/:bidId/withdraw` — flips PENDING → WITHDRAWN
    (conditional update, optimistic-concurrency safe), emits a
    `REQUEST_UPDATED` timeline event with `{ withdrawnBidId, providerId }`.

## 3. Automated Tests

| Check                                                                                  | Result                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `prisma validate`                                                                      | pass                                            |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                            |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — 591 passed, 6 skipped (was 577; +14 new) |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass — 295 passed                               |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                            |

New API tests in `provider-bids.service.spec.ts` (14 cases):

- submit: happy path (creates PENDING, notifies seeker, emits timeline event)
- submit: 404 if request not found
- submit: 409 if request not OPEN_FOR_BIDS
- submit: 400 VALIDATION_ERROR on bidding own request
- submit: 409 on duplicate active bid (one-active-bid invariant)
- submit: 404 if profile vanished post-guard
- submit: response does not leak seekerUserId
- withdraw: PENDING → WITHDRAWN happy path + timeline event
- withdraw: 404 on not-found / not-owned bid
- withdraw: 409 on already-withdrawn
- withdraw: 409 on ACCEPTED (terminal state)
- withdraw: 409 on conditional-setStatus race loss
- list: cursor-paginated page
- list: nextCursor when more rows exist

## 4. Postman Tests

- Collection updated: `postman/hsm-provider.postman_collection.json`.
- Folder `30 — Bids (Sprint 5.3)` added with:
  - POST positive (captures `bidId` for follow-on tests)
  - POST duplicate negative (must 409)
  - POST forbidden-field-smuggle negative (must 400; injects `providerId`,
    `providerUserId`, `status`)
  - GET list (asserts envelope, narrow projection — no `seekerUserId`,
    no `line1`)
  - POST withdraw positive
  - POST withdraw already-withdrawn negative (must 409)
- Newman run: deferred to Sprint 5.7 end-to-end harness.

## 5. Manual Checks

- Scenario: submit-then-withdraw-then-resubmit cycle.
  Expected: a withdrawn bid does not block a fresh submit on the same
  request because the `findActiveBidForRequest` filter excludes WITHDRAWN.
  Actual: confirmed by inspection — the where clause is
  `status: { not: 'WITHDRAWN' }`.
  Result: pass.
- Scenario: BiddingModal does not call `setTimeout` for fake persistence.
  Expected: `setTimeout(...)` only used for the 1.6 s success-cue auto-dismiss
  (cosmetic, after the real mutation has resolved).
  Actual: confirmed in `BiddingModal.handleSubmit`.
  Result: pass.
- Scenario: provider's own request never appears in their feed and they
  cannot bid on it via direct id.
  Expected: feed excludes by seekerUserId; submit returns
  VALIDATION_ERROR if `request.seekerUserId === providerUserId`.
  Actual: both behaviors covered by tests.
  Result: pass.

## 6. Fixes Applied

- File: `apps/web/src/app/components/provider/ProviderApp.tsx`
  Reason: remove the `setTimeout(...)` fake-persistence and the
  hardcoded `providerName === 'Omar K.'` filter on `MyBidsScreen`.
  Before: legacy `useEcosystem().submitBid` mock + 1.2 s setTimeout +
  hardcoded provider-name filter.
  After: real React Query mutation with promise-driven loading / done /
  error states, real `useMyBids()` data with WITHDRAWN filtered out
  client-side.
  Risk: the WITHDRAWN filter is client-side only — a future filter chip
  for "Withdrawn" can opt out. Not in scope for 5.3.

## 7. Remaining Issues

- The `WalletScreen` (provider earnings) and the booking lifecycle
  surfaces still consume `useEcosystem` mocks. These are the targets of
  Sprints 5.6 and 5.4 respectively.
- The flaky `app-selector-routing.test.tsx` test documented in Sprint 5.2
  remains flaky; it does not exercise any code touched by 5.3.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically. All sprint-5.3 surface area is green
(api typecheck, api tests +14, web typecheck, web tests, web build).
