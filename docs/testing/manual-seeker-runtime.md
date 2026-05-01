# Manual Seeker Runtime Verification

Walk-through for verifying every Seeker flow that has shipped through Sprint 4 against
a locally-running stack. Run this before merging anything that touches a Seeker module
or before a release cut. Pairs with `docs/testing/postman-sprint1-sprint4.md` (API-side
recipes) and `scripts/runtime/verify-seeker-flow.cjs` (post-auth smoke harness).

> **Coverage status as of this document.** Avatar upload (Slice 4.2) and request
> attachments (Slice 4.3) are intentionally absent — they have not shipped yet. When
> they do, add them under §13.

## 0. Stack the bookkeeping needs

| What you need                                        | Where it comes from                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node 20.x, pnpm 10.x, Docker Desktop with Compose v2 | Same as `docs/manual-testing-guide.md`                                                                                                                 |
| A working `.env` at repo root                        | Copy from `.env.example`, then run `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and paste into `JWT_ACCESS_SECRET` |
| Postgres + Mongo + Redis containers up               | `pnpm docker:up`                                                                                                                                       |
| Schema applied                                       | `pnpm --filter @homeservicemarketplace/database migrate:deploy && pnpm --filter @homeservicemarketplace/database generate`                             |
| Seed roles + permissions + service categories        | `pnpm --filter @homeservicemarketplace/database seed`                                                                                                  |
| API running                                          | `pnpm --filter @homeservicemarketplace/api dev`                                                                                                        |
| Web running                                          | `pnpm --filter @homeservicemarketplace/web dev` (default `http://localhost:5173`)                                                                      |
| Mailpit for OTP / verification mail                  | `pnpm docker:up` exposes Mailpit at `http://localhost:8025`                                                                                            |

If any of those checks fail, fix them first — none of the steps below will pass.

## 1. Boot smoke (≤ 30 s)

1. `curl -s http://localhost:4000/health/ready` → `ready: true`, all three deps `up`.
2. `curl -s http://localhost:4000/v1/services` → 200 with a non-empty `items[]` (seed
   produced the catalogue). If this is empty, re-run the seed; the wizard's category
   chip will look broken otherwise.
3. Open `http://localhost:5173/`, browser DevTools → Console. Console must be clean
   (no red errors, no `Warning: Each child in a list…`, no `Failed to fetch`).

If §1 fails, stop and fix the boot — none of the UI steps are useful with a sick API.

## 2. Auth — register → verify → login → me

> Use a **fresh email** per run (Mailpit + Postgres keep state). The pattern
> `qa+<unix-timestamp>@example.com` is reliable.

### 2a. Register

- Web: `Sign up` → email + a 12+ char password + first/last name.
- Expectation: redirected into the OTP screen. `Network` tab shows
  `POST /v1/auth/register` → 200 with `{ challengeId, otpRequired: true }`.
- Anti-regression: re-submit the same email immediately. The response must still
  be 200 with the same shape (anti-enumeration), **not** 409.

### 2b. Email verification

- Open Mailpit (`http://localhost:8025`) → newest message to your test email,
  subject **"Verify your email"**.
- Click the link OR copy the `?token=` query param into a curl call:
  ```bash
  curl -s -X POST http://localhost:4000/v1/auth/verify-email \
    -H 'Content-Type: application/json' \
    -d '{"token":"<paste raw token>"}'
  # → 200 {"success":true}
  ```
- **Dev shortcut** (do not use in staging/prod): set `AUTH_REQUIRE_EMAIL_VERIFICATION=false`
  in `.env`, restart the API, register fresh — verification is auto-applied.

### 2c. OTP

- Mailpit shows a second message subject **"Your verification code"** with a 6-digit code.
- Web: paste it into the OTP input, submit.
- Expectation: redirected into the home shell. Console clean. `auth:session-expired`
  events must NOT fire.

### 2d. `/v1/auth/me`

- DevTools Network → request to `GET /v1/auth/me` returns 200 with the freshly
  registered user. `roles: ["customer"]`, `email` matches what you registered with.
- The home header should show the correct initials (computed server-side via
  `deriveInitials`) — not legacy "AK".

### 2e. Refresh + logout

- Wait 60 s on the home shell or trigger any mutation. The 401 interceptor in
  `lib/api.ts` should refresh transparently — Network tab shows
  `POST /v1/auth/refresh` → 200, then the original request retries. **No redirect to
  /login** during this flow.
- Drawer → **Log out** → `POST /v1/auth/logout` → 200 → user is bounced to `/login`.
  Re-visiting `/home` redirects back to `/login`.

### 2f. Forgot / reset password

- `/login` → "Forgot password?" → submit your test email.
- Mailpit shows **"Reset your password"** mail. Click the link or copy the token
  into:
  ```bash
  curl -s -X POST http://localhost:4000/v1/auth/reset-password \
    -H 'Content-Type: application/json' \
    -d '{"token":"<paste>","newPassword":"a-new-passphrase-2026"}'
  # → 200
  ```
- Login with the new password succeeds.

## 3. Profile (Seeker)

### 3a. Get

- Drawer → **Edit Profile**.
- Expectation: name field shows the registered name, email field is read-only and
  shows the registered email. Phone / city / bio default to empty.
- Anti-regression: the legacy hardcoded "Ahmed Al-Khalid / +966 50 123 4567 / Riyadh"
  values must NEVER appear.

### 3b. Update

- Edit phone, city, bio. **Save Changes**.
- Expectation: `PATCH /v1/me/profile` 200, success banner appears (only after the
  200 — there is no fake `setTimeout`). Refresh the page; the values persist.
- Negative: open DevTools → Console → run
  `fetch('/v1/me/profile', { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'attacker@example.com' }) })`.
  Backend rejects with 400 / `VALIDATION_ERROR` (forbidNonWhitelisted).

### 3c. Avatar upload

- **Not yet shipped** (Slice 4.2). Camera button cycles a gradient hue only; this is
  expected. Do not try to upload anything from the picker.

## 4. Sprint 1 — Services, addresses, requests

### 4a. Service categories

- Home shell → service grid loads from `GET /v1/services` (200). Categories from
  the seed appear (Plumbing, AC Repair, Carpentry, Cleaning, Electrical, Painting).
- Anti-regression: no console warning about missing category icons.

### 4b. Saved addresses

- Drawer → **Saved Addresses**.
- Empty state on a fresh user.
- Add an address (Riyadh, Saudi Arabia). `POST /v1/me/addresses` 201, list updates.
- Toggle default. `POST /v1/me/addresses/:id/default` 200.
- Edit. `PATCH /v1/me/addresses/:id` 200.
- Delete. `DELETE /v1/me/addresses/:id` 204, list updates.
- Anti-regression: deleting the last address does not crash the wizard.

### 4c. Job Wizard — create a request

- Home → tap a service tile (e.g. Plumbing).
- **Step 1 — Media & brief**: skip uploads, type a description.
- **Step 2 — Location & time**:
  - Address field auto-fills from the default saved address (if any).
  - Tap **Use my current location** → browser permission prompt → on accept the
    button reads "Location captured", lat/lng are captured client-side.
    On deny, a friendly red banner appears, no raw error text.
  - Pick **Schedule Later** → set a future date + time via the native picker.
  - Past date/time selection is rejected before any network round-trip.
- **Confirm Job · Post Now**.
- Expectation: `POST /v1/me/requests` 200, `scheduleType:"LATER"`, `scheduledAt` is
  a real ISO string, `manualAddress.lat/lng` populated when geolocation succeeded.
- Step 3 success card shows the user's actual schedule selection ("Mar 15, 2026 ·
  10:00 AM" must NOT appear unless the user actually picked exactly that).

### 4d. ASAP path

- Re-open the wizard, **ASAP**, confirm.
- `scheduleType:"ASAP"`, `scheduledAt:null`. Default address sent as `addressId`
  (not duplicated as `manualAddress`).

### 4e. My Requests

- Drawer → **My Requests**.
- The two requests just created are listed. Status chip = `PENDING`.
- Click into one → detail screen renders without console errors. `GET /v1/me/requests/:id`
  - `GET /v1/me/requests/:id/timeline` both 200.
- Cancel the request. `POST /v1/me/requests/:id/cancel` 200, status flips to
  `CANCELLED`. Reopen → `POST /v1/me/requests/:id/reopen` 200.

## 5. Sprint 2 — Bids, accept, bookings

> Bids are produced by a Provider — there's no Seeker-side flow to create them. To
> populate the UI, either (a) seed bids via the dev fixtures script, or (b) run the
> Provider app side by side. The runtime script does NOT depend on bids existing.

### 5a. Bids list (with seeded bids)

- Open a request that has bids.
- `GET /v1/me/requests/:id/bids` 200 with `items[]` non-empty. Provider names are
  the seeded values — no "Omar Al-Khalid" hardcode.

### 5b. Accept a bid

- Tap **Book Now** on a bid.
- `POST /v1/me/requests/:requestId/bids/:bidId/accept` 200. Response is the new
  Booking shape (`status:"PENDING_CONFIRMATION"` or similar).
- The accepted bid's status flips locally; sibling bids become `LOST` after a
  refetch.

### 5c. Bookings list / detail

- Drawer → **My Bookings** (or the in-app booking surface).
- `GET /v1/me/bookings` 200, the new booking appears.
- Click in → `GET /v1/me/bookings/:id` + `GET /v1/me/bookings/:id/timeline` both 200.
- Cancel a booking (where allowed) → `POST /v1/me/bookings/:id/cancel` 200.

## 6. Sprint 3 — Notifications + chat

### 6a. Notifications

- Bell icon → unread count from `GET /v1/me/notifications/unread-count` (200).
- Open the panel → `GET /v1/me/notifications` 200 with `items[]`.
- Mark one read → `POST /v1/me/notifications/:id/read` 200. Unread count decreases.
- "Mark all as read" → `POST /v1/me/notifications/read-all` 200, count → 0.
- Anti-regression: closing/reopening the panel does NOT silently dismiss unread items
  (this was the cross-sprint stabilization fix in `b68e809`).

### 6b. Chat

- A booking or accepted bid produces a conversation thread (or one is created on
  first send via `POST /v1/me/conversations`).
- Open a conversation → `GET /v1/me/conversations/:id/messages` 200.
- Type a message → `POST /v1/me/conversations/:id/messages` 200, message appears.
- Mark read → `POST /v1/me/conversations/:id/read` 200.
- Refresh the page; the conversation + messages persist.

## 7. Sprint 4 — Wizard scheduling + location (regression replay)

These are the same flows as §4c/§4d, called out separately so the slice that
introduced them (`fix(seeker): stabilize job wizard location and scheduling`)
keeps its own regression list.

| Behaviour                           | How to verify                                         | Regression signal                                                 |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Real HTML5 date picker              | Switch to Schedule Later in the wizard                | Hardcoded "Mar 15, 2026" appears anywhere on screen               |
| Real HTML5 time picker              | Same                                                  | Hardcoded "10:00 AM" appears                                      |
| Past date/time blocked              | Pick `2020-01-01` 09:00, Confirm                      | Request hits the network                                          |
| Real geolocation                    | Tap "Use my current location" with permission allowed | Button never changes from "Use my current location"               |
| Permission-denied UX                | Same with permission denied                           | Raw `User denied geolocation` text in DOM                         |
| LATER ships ISO `scheduledAt`       | Pick a real future slot, Confirm                      | `scheduledAt` is `null` or a non-ISO value in the network payload |
| ASAP ships `null`                   | Pick ASAP, Confirm                                    | `scheduledAt` non-null in payload                                 |
| Saved-default uses `addressId`      | Don't edit the auto-filled address                    | `manualAddress` populated alongside `addressId`                   |
| Edited address uses `manualAddress` | Edit the auto-filled address                          | `addressId` non-null while `manualAddress` is `null`              |
| Lat/lng on `manualAddress`          | Edit address + capture geolocation, Confirm           | `manualAddress` lacks `lat`/`lng`                                 |
| Friendly 400 copy                   | Manually break the wizard payload via DevTools        | Raw Prisma / SQL string visible                                   |

## 8. Console + network discipline

After running every section above, both must be true:

- DevTools Console: zero red errors. The only allowed yellow warnings are React
  fast-refresh / Vite HMR notes during dev.
- Network tab: no 5xx responses. 400/401 only on negative tests where you forced
  them.

If either is violated, the slice you're verifying has a regression. Capture the
payload + request id and open an issue.

## 9. Observability cross-check

- API stdout: no Prisma stack traces, no `PrismaClientKnownRequestError` strings.
  Errors appear as structured JSON via pino with `requestId` + `errorCode`.
- `curl http://localhost:4000/metrics` still returns Prom text.

## 10. Tear-down

- Web `Ctrl-C` the dev server.
- API `Ctrl-C`.
- `pnpm docker:down` (drops containers; preserves Postgres volume by default).
- Wipe Postgres test data with the provided drop+migrate cycle if you want a clean
  slate next run:
  ```bash
  pnpm --filter @homeservicemarketplace/database migrate:reset --force
  pnpm --filter @homeservicemarketplace/database seed
  ```

## 11. Quick reference — endpoints touched by Seeker

| Verb                                                                                   | Path                                                                                                                                                | Sprint               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| POST                                                                                   | `/v1/auth/register, login, verify-email, verify-otp, resend-otp, resend-verification, refresh, logout, logout-all, forgot-password, reset-password` | Auth                 |
| GET                                                                                    | `/v1/auth/me`                                                                                                                                       | Auth                 |
| GET                                                                                    | `/v1/services`                                                                                                                                      | Sprint 1             |
| GET, POST, PATCH /:id, DELETE /:id, POST /:id/default                                  | `/v1/me/addresses`                                                                                                                                  | Sprint 1             |
| GET, POST, GET /:id, PATCH /:id, POST /:id/cancel, POST /:id/reopen, GET /:id/timeline | `/v1/me/requests`                                                                                                                                   | Sprint 1             |
| GET, GET /:id, POST /:id/accept                                                        | `/v1/me/requests/:id/bids`                                                                                                                          | Sprint 2             |
| GET, GET /:id, GET /:id/timeline, POST /:id/cancel                                     | `/v1/me/bookings`                                                                                                                                   | Sprint 2             |
| GET, POST, GET /:id/messages, POST /:id/messages, POST /:id/read                       | `/v1/me/conversations`                                                                                                                              | Sprint 3             |
| GET, GET /unread-count, POST /:id/read, POST /read-all, DELETE /:id                    | `/v1/me/notifications`                                                                                                                              | Sprint 3             |
| GET, PATCH                                                                             | `/v1/me/profile`                                                                                                                                    | Profile (avatar TBD) |

## 12. Maintenance

When a slice ships, the engineer who shipped it:

1. Adds the new flow under the relevant sprint section.
2. Adds an "Anti-regression" line capturing the legacy bug class the slice fixed.
3. Updates §11.
4. Runs the entire doc against a clean stack at least once before marking the PR
   reviewable.

## 13. Reserved — ships when 4.2 / 4.3 land

- **Avatar upload (Slice 4.2)**: `POST /v1/me/profile/avatar` walk-through goes here.
- **Request attachments (Slice 4.3)**: wizard Media & Brief upload flow + GET / DELETE
  endpoints go here.
