# Provider Runtime Harness — Sprint 5.7

End-to-end manual + automated check-list for the Provider sprints
(5.1 → 5.6). Use this when you want to verify that the whole
Provider story works against a freshly seeded database.

## 0. Prerequisites

```bash
pnpm install
pnpm docker:up                        # postgres + mongo + redis + mailpit
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed
```

You need:

- A pre-seeded **provider** account (email + password). The `seed.ts`
  script creates one; otherwise sign up via the web UI and click
  the verification link in Mailpit (<http://localhost:8025>).
- A pre-seeded **seeker** account that has at least one
  `OPEN_FOR_BIDS` ServiceRequest the provider can bid on.

Run the API:

```bash
pnpm --filter @homeservicemarketplace/api dev
# binds to http://localhost:4000
```

## 1. Postman environment

Copy the example and fill in real local credentials (the file is
gitignored):

```bash
cp postman/local.postman_environment.example.json postman/local.postman_environment.json
```

Set at least `providerEmail`, `providerPassword`, `customerEmail`,
`customerPassword`. The IDs (`requestId`, `bidId`, `bookingId`,
`conversationId`, `notificationId`) are populated automatically by the
collection's tests as it runs.

## 2. Newman run

```bash
pnpm postman:provider
```

This runs the full provider collection in folder order:

| Folder                          | What runs                                                                  |
| ------------------------------- | -------------------------------------------------------------------------- |
| `00 — Provider login`           | POST /v1/auth/login → captures `providerToken`                             |
| `10 — Profile`                  | upgrade, get, patch profile, patch availability, forbidden-field 400       |
| `20 — Available Jobs`           | list, categoryId filter, bogus categoryId 400, customer-token 403          |
| `30 — Bids`                     | submit, duplicate 409, field-smuggle 400, list, withdraw, already-with 409 |
| `40 — Bookings`                 | list, detail, timeline, start, complete, cancel-after-complete 409         |
| `60 — Notifications & Chat`     | list notifications, unread count, read-one, list/create/send conv          |
| `50 — Earnings`                 | summary, completed-only list, status filter, customer-token 403            |
| `11 — Approval Gate (negative)` | no-token 401/403, customer-token on profile 403                            |

Every request runs the collection-level guard that asserts no Prisma /
SQL / secret leak in the response body.

## 3. What the harness covers

- **Sprint 5.1 / 5.1.4** — provider profile + approval gate.
- **Sprint 5.2** — available-jobs feed + narrow security projection.
- **Sprint 5.3** — submit / list / withdraw bid + one-active-bid invariant.
- **Sprint 5.4** — booking lifecycle (start → complete → cancel) + state
  machine errors.
- **Sprint 5.5** — provider-side notification feed + chat reads / writes.
- **Sprint 5.6** — earnings summary + transactions read model.

## 4. What the harness does NOT cover

- The cross-role hand-off (seeker accept → provider sees booking) requires
  either a pre-seeded ACCEPTED bid, or a separate seeker run that accepts
  the bid the provider just submitted. Sprint 6.7 (Admin harness) and a
  future Sprint 5.8 cross-role harness will cover this.
- The realtime channel (Sprint 5.5.5 spike, Sprint 7.0 implementation)
  cannot be exercised by Newman; once SSE ships, a Playwright probe will
  pin it.
- UI tests live alongside the components (`apps/web/src/**/*.test.tsx`) and
  run via `pnpm --filter @homeservicemarketplace/web test`.

## 5. Troubleshooting

- **Login returns 401:** check `providerEmail` / `providerPassword` in the
  environment file; the seed account must have `emailVerifiedAt` set.
- **Upgrade returns 500 about provider role:** seed didn't run.
  `pnpm --filter @homeservicemarketplace/database seed` again.
- **Submit-bid returns 404 / 409 on the requestId:** the captured
  `requestId` from the available-jobs list points at the seeker's request;
  if no `OPEN_FOR_BIDS` requests exist, the test correctly skips the
  positive bid path.
- **Earnings summary is all zeroes:** no COMPLETED bookings exist for
  this provider — submit a bid, accept it from the seeker, then complete
  it. Or seed a completed booking.

## 6. Maintenance

- When a new provider endpoint ships, add it to the matching numbered
  folder in `postman/hsm-provider.postman_collection.json` and verify
  `pnpm postman:provider` still ends green.
- Treat the collection-level "no Prisma/secret leak" guard as the
  baseline security expectation — never bypass it.
- The `htmlextra` reporter generates `postman/reports/provider.html`
  on each run; the directory is gitignored.
