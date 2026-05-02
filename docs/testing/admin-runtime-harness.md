# Admin Runtime Harness — Sprint 6.7

End-to-end manual + automated check-list for the Admin sprints
(6.0 → 6.6). Use this when you want to verify that the whole
Admin story works against a freshly seeded database.

## 0. Prerequisites

```bash
pnpm install
pnpm docker:up
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed
```

You need:

- A pre-seeded **admin** account (the seed script creates `admin@admin.com`).
- A pre-seeded **provider** profile in `PENDING_REVIEW` so the
  verification approve / reject flow has a target.
- At least one **booking** so the disputes flow has a `bookingId`
  to reference.

Run the API:

```bash
pnpm --filter @homeservicemarketplace/api dev
```

## 1. Postman environment

```bash
cp postman/local.postman_environment.example.json postman/local.postman_environment.json
```

Set `adminEmail` + `adminPassword`. The IDs (`userId`,
`providerProfileId`, `bookingId`, `disputeId`, `settingKey`) get
populated by the collection's tests as it runs. The provider /
customer tokens are optional — only the negative cross-role tests
use them.

## 2. Newman run

```bash
pnpm postman:admin
```

This runs the full admin collection in folder order:

| Folder                           | What runs                                                         |
| -------------------------------- | ----------------------------------------------------------------- |
| `00 — Admin login`               | POST /v1/auth/login → captures `adminToken`                       |
| `10 — Health (Sprint 6.0)`       | health ping; positive + customer-token 403 + no-token 401         |
| `20 — Users (Sprint 6.1)`        | list, search by `q+role`, detail, suspend, restore                |
| `30 — Verification (Sprint 6.2)` | list pending, detail, approve, reject (empty-reason 400), suspend |
| `40 — Disputes (Sprint 6.3)`     | list, open, resolve, resolve-with-invalid-status 400              |
| `50 — Analytics (Sprint 6.4)`    | KPI summary shape + numeric assertions                            |
| `60 — Settings (Sprint 6.5)`     | put → list → get one → delete a sample `commission-percent` value |
| `70 — Audit (Sprint 6.6)`        | list, type-filter (every row carries the requested type)          |

Every request inherits the collection-level guard that asserts no
Prisma / SQL / passwordHash / refreshToken / JWT_SECRET / DATABASE_URL
leak in the response body.

## 3. What the harness covers

- **6.0 / 6.7** — module bootstrap + role guard + login bootstrap.
- **6.1** — user control (list, search, suspend, restore, audit).
- **6.2** — provider verification queue (approve / reject / suspend
  with state-machine guards).
- **6.3** — disputes lifecycle (open + resolve + audit).
- **6.4** — analytics summary shape.
- **6.5** — platform settings upsert / read / delete (audit on every
  mutation).
- **6.6** — audit log read with type / userId filters.

## 4. What the harness does NOT cover

- The cross-role hand-off (admin suspends user → user can no longer
  log in) is not yet a single Newman run — defer to a future
  cross-role harness sprint.
- Real platform-setting validators (commission % bounds, currency
  whitelist, etc.) are out of scope for the read-model layer of
  Sprint 6.5; the Postman folder only checks the wire round-trip.
- Realtime channels (Sprint 7.0) — Newman cannot drive SSE.

## 5. Troubleshooting

- **403 from /v1/admin/health:** the seeded account does NOT have
  the `admin` role. `pnpm --filter @homeservicemarketplace/database
grant:admin-provider` grants admin + provider roles to a target
  email; pass the target email via env.
- **404 on suspend/restore/approve etc.:** the captured `userId` /
  `providerProfileId` / `bookingId` is empty — run the list folder
  before mutations.
- **`prisma generate` error from the API watch process:** the dev
  shell has a known DLL lock on Windows; the typed-stub repos in
  the disputes / settings modules let the API still compile, and
  the migration applies on a clean shell.
