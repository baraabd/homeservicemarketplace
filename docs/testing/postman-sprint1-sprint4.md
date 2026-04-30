# Postman + curl — Seeker Endpoints (Sprints 1–4)

Direct-API verification for every Seeker endpoint that has shipped through Sprint 4.
Pairs with `manual-seeker-runtime.md` (UI-side walkthrough) and the post-auth
harness at `scripts/runtime/verify-seeker-flow.cjs`.

There are two ways to drive the API:

1. **Postman**: import `docs/postman/hsm-seeker.postman_collection.json` and the
   existing `docs/postman/hsm-local.postman_environment.json`. The collection
   relies on the IAM collection (`hsm-backend.postman_collection.json`) for the
   register → login → me → refresh → logout chain — variables `accessToken` /
   `csrfToken` are populated by the IAM Login request and read here.
2. **curl** (this document): copy-paste recipes. Substitute the `{{...}}` tokens
   with values you've captured from previous calls. Where a flow needs both a
   cookie jar and the CSRF header, the recipes use `--cookie-jar /tmp/hsm.jar`.

> **Conventions**
>
> - `BASE` defaults to `http://localhost:4000`. Override via env if you run on a
>   different port.
> - **Web client** = HttpOnly cookies + CSRF header.
> - **Mobile client** = Authorization bearer tokens (set `X-Client-Kind: mobile` on
>   login).
> - Body excerpts use `…` to elide repeating fields.

## 0. Prereqs

```bash
export BASE=http://localhost:4000
# Login first — see §1. The login response sets hsm_access, hsm_refresh, hsm_csrf
# cookies (web mode) into your jar at /tmp/hsm.jar; capture the CSRF cookie value
# into a shell var so you can echo it as the X-CSRF-Token header.
export CSRF=$(awk '$6=="hsm_csrf"{print $7}' /tmp/hsm.jar | tail -1)
echo "CSRF=$CSRF"
```

## 1. Auth bootstrap (register → verify → login → me)

### 1a. Register

```bash
curl -s -X POST "$BASE/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "email":"qa+'"$(date +%s)"'@example.com",
    "password":"a-reasonable-passphrase",
    "firstName":"Ada",
    "lastName":"Lovelace"
  }'
# → 200 {"challengeId":"...","otpRequired":true}
```

Anti-enumeration: re-running with the same email returns the same shape, NOT a 409.

### 1b. Verify email

Mailpit (`http://localhost:8025`) shows the **Verify your email** message. Either click
the link or extract the token:

```bash
curl -s -X POST "$BASE/v1/auth/verify-email" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<paste-raw-token-from-mailpit>"}'
# → 200 {"success":true}
```

### 1c. Login (web)

```bash
rm -f /tmp/hsm.jar
curl -s -X POST "$BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-Client-Kind: web' \
  -c /tmp/hsm.jar \
  -d '{"email":"<your test email>","password":"a-reasonable-passphrase"}'
# → 200 {"challengeId":"...","otpRequired":true}
```

### 1d. Verify OTP

Mailpit → **Your verification code** → grab the 6-digit code.

```bash
curl -s -X POST "$BASE/v1/auth/verify-otp" \
  -H 'Content-Type: application/json' \
  -H 'X-Client-Kind: web' \
  -b /tmp/hsm.jar -c /tmp/hsm.jar \
  -d '{"challengeId":"<from 1c>","code":"123456"}'
# → 200 {"userId":"...","roles":["customer"]}
```

After this call, `/tmp/hsm.jar` contains `hsm_access`, `hsm_refresh`, `hsm_csrf`.
Capture the CSRF token now:

```bash
export CSRF=$(awk '$6=="hsm_csrf"{print $7}' /tmp/hsm.jar | tail -1)
```

### 1e. Me

```bash
curl -s "$BASE/v1/auth/me" -b /tmp/hsm.jar
# → 200 {"id":"...","email":"...","firstName":"...","lastName":"...","roles":["customer"], …}
```

### 1f. Refresh (cookie path)

```bash
curl -s -X POST "$BASE/v1/auth/refresh" \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar -c /tmp/hsm.jar
# → 200 (rotates hsm_access; same shape as login)
```

### 1g. Logout

```bash
curl -s -X POST "$BASE/v1/auth/logout" \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar
# → 204
```

### 1h. Forgot / reset password

```bash
curl -s -X POST "$BASE/v1/auth/forgot-password" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<your test email>"}'
# → 200 {"success":true}      (anti-enumeration; same body for unknown email)

# Mailpit → Reset your password → copy token.
curl -s -X POST "$BASE/v1/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<paste>","newPassword":"a-new-passphrase-2026"}'
# → 200 {"success":true}
```

## 2. Profile

### 2a. Get

```bash
curl -s "$BASE/v1/me/profile" -b /tmp/hsm.jar
# → 200 {"profile":{"firstName":"Ada","lastName":"Lovelace","displayName":"Ada Lovelace",…,"avatarUrl":null}}
```

### 2b. Update

```bash
curl -s -X PATCH "$BASE/v1/me/profile" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"phoneNumber":"+966500000000","city":"Riyadh","bio":"Compiler pioneer."}'
# → 200 (same envelope as Get with the new values)
```

### 2c. Negative — IDOR / privilege injection

```bash
curl -i -X PATCH "$BASE/v1/me/profile" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"email":"attacker@example.com"}'
# → 400 VALIDATION_ERROR (forbidNonWhitelisted blocks email/userId/role/status/password)
```

### 2d. Negative — no CSRF

```bash
curl -i -X PATCH "$BASE/v1/me/profile" \
  -H 'Content-Type: application/json' \
  -b /tmp/hsm.jar \
  -d '{"city":"Jeddah"}'
# → 401 AUTH_CSRF_FAILED
```

### 2e. Avatar upload — **not yet shipped** (Slice 4.2). Recipe placeholder:

```bash
# Reserved for when POST /v1/me/profile/avatar lands.
```

## 3. Sprint 1 — Service catalogue

```bash
curl -s "$BASE/v1/services"
# → 200 {"items":[{"id":"…","slug":"plumbing","nameEn":"Plumbing", …}]}
# Public — no auth required.
```

If `items[]` is empty, run `pnpm --filter @homeservicemarketplace/database seed`.

## 4. Sprint 1 — Saved addresses

### 4a. List

```bash
curl -s "$BASE/v1/me/addresses" -b /tmp/hsm.jar
# → 200 {"items":[…]}
```

### 4b. Create

```bash
curl -s -X POST "$BASE/v1/me/addresses" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"label":"Home","line1":"123 King Fahd Rd","city":"Riyadh","country":"Saudi Arabia","isDefault":true}'
# → 201 (the new AddressSummary)
export ADDR_ID=<id from response>
```

### 4c. Update

```bash
curl -s -X PATCH "$BASE/v1/me/addresses/$ADDR_ID" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"label":"Apt"}'
# → 200
```

### 4d. Set default

```bash
curl -s -X POST "$BASE/v1/me/addresses/$ADDR_ID/default" \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar
# → 200 (only one address has isDefault: true at any time)
```

### 4e. Delete

```bash
curl -i -X DELETE "$BASE/v1/me/addresses/$ADDR_ID" \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar
# → 204
```

## 5. Sprint 1 — Service requests (Job Wizard)

### 5a. ASAP — saved address

```bash
curl -s -X POST "$BASE/v1/me/requests" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{
    "categoryId":null,
    "customServiceText":"Plumbing",
    "description":"Leaky kitchen tap",
    "scheduleType":"ASAP",
    "scheduledAt":null,
    "addressId":"'"$ADDR_ID"'",
    "manualAddress":null
  }'
# → 200 (ServiceRequestSummary; status=PENDING)
export REQ_ID=<id from response>
```

### 5b. LATER — manualAddress with lat/lng

```bash
curl -s -X POST "$BASE/v1/me/requests" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{
    "categoryId":null,
    "customServiceText":"Plumbing",
    "description":"Schedule for tomorrow morning",
    "scheduleType":"LATER",
    "scheduledAt":"2027-01-01T08:30:00.000Z",
    "addressId":null,
    "manualAddress":{"line1":"99 New Avenue","city":"Jeddah","country":"Saudi Arabia","lat":21.4858,"lng":39.1925}
  }'
# → 200
```

### 5c. Negative — LATER with no scheduledAt

```bash
curl -i -X POST "$BASE/v1/me/requests" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"customServiceText":"Plumbing","scheduleType":"LATER","scheduledAt":null,"manualAddress":{"line1":"x","city":"y","country":"zz"}}'
# → 400 VALIDATION_ERROR — body MUST NOT contain Prisma/SQL strings.
```

### 5d. List my requests

```bash
curl -s "$BASE/v1/me/requests?status=PENDING&limit=20" -b /tmp/hsm.jar
# → 200 {"items":[…],"nextCursor":null}
```

### 5e. Detail / timeline

```bash
curl -s "$BASE/v1/me/requests/$REQ_ID" -b /tmp/hsm.jar
curl -s "$BASE/v1/me/requests/$REQ_ID/timeline" -b /tmp/hsm.jar
```

### 5f. Cancel / reopen

```bash
curl -s -X POST "$BASE/v1/me/requests/$REQ_ID/cancel" -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
curl -s -X POST "$BASE/v1/me/requests/$REQ_ID/reopen" -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
```

## 6. Sprint 2 — Bids

> Bids are inserted by Provider-side flows; Seeker-side endpoints are read-only +
> `accept`. Until a Provider exists in your local data, §6a returns an empty list.

### 6a. List bids on one of your requests

```bash
curl -s "$BASE/v1/me/requests/$REQ_ID/bids" -b /tmp/hsm.jar
# → 200 {"items":[…],"nextCursor":null}
```

### 6b. Detail

```bash
curl -s "$BASE/v1/me/requests/$REQ_ID/bids/$BID_ID" -b /tmp/hsm.jar
```

### 6c. Accept (transactional)

```bash
curl -s -X POST "$BASE/v1/me/requests/$REQ_ID/bids/$BID_ID/accept" \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar
# → 200 (a Booking is produced; sibling bids → LOST)
```

### 6d. IDOR — another user's request

```bash
# Substitute a request id you do NOT own.
curl -i "$BASE/v1/me/requests/00000000-not-yours/bids" -b /tmp/hsm.jar
# → 404 NOT_FOUND (we do not leak existence; never 403 with discriminating copy)
```

## 7. Sprint 2 — Bookings

```bash
curl -s "$BASE/v1/me/bookings"                                  -b /tmp/hsm.jar
curl -s "$BASE/v1/me/bookings/$BOOKING_ID"                      -b /tmp/hsm.jar
curl -s "$BASE/v1/me/bookings/$BOOKING_ID/timeline"             -b /tmp/hsm.jar
curl -s -X POST "$BASE/v1/me/bookings/$BOOKING_ID/cancel" \
  -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
```

## 8. Sprint 3 — Notifications

```bash
curl -s "$BASE/v1/me/notifications/unread-count"  -b /tmp/hsm.jar
curl -s "$BASE/v1/me/notifications?limit=20"      -b /tmp/hsm.jar

curl -s -X POST "$BASE/v1/me/notifications/$N_ID/read" \
  -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
curl -s -X POST "$BASE/v1/me/notifications/read-all" \
  -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
curl -i -X DELETE "$BASE/v1/me/notifications/$N_ID" \
  -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
```

## 9. Sprint 3 — Conversations

```bash
curl -s "$BASE/v1/me/conversations"                              -b /tmp/hsm.jar

# Open or create.
curl -s -X POST "$BASE/v1/me/conversations" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"counterpartUserId":"<their id>","relatedRequestId":"'"$REQ_ID"'"}'

curl -s "$BASE/v1/me/conversations/$CONV_ID/messages?limit=50"   -b /tmp/hsm.jar
curl -s -X POST "$BASE/v1/me/conversations/$CONV_ID/messages" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -b /tmp/hsm.jar \
  -d '{"body":"Hello"}'

curl -s -X POST "$BASE/v1/me/conversations/$CONV_ID/read" \
  -H "X-CSRF-Token: $CSRF" -b /tmp/hsm.jar
```

## 10. Sprint 4 — Wizard regression replay (request-level)

Replays `fix(seeker): stabilize job wizard location and scheduling`. Each row
should hit either the recipe in §5 or its negative twin.

| Behaviour                                   | Recipe                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| LATER ships valid ISO scheduledAt           | §5b                                                                 |
| LATER missing scheduledAt rejected          | §5c                                                                 |
| ASAP ships scheduledAt:null                 | §5a                                                                 |
| Saved-default uses addressId                | §5a (`addressId` set, `manualAddress:null`)                         |
| Edited address uses manualAddress + lat/lng | §5b                                                                 |
| Past date/time rejected                     | Send §5b body with `"scheduledAt":"2020-01-01T00:00:00.000Z"` → 400 |

## 11. Negative-test checklist (run on every release)

| Check                  | Recipe                            | Pass criterion                                                        |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Unauth GET /me/profile | strip `-b /tmp/hsm.jar`           | 401                                                                   |
| PATCH no CSRF          | drop `X-CSRF-Token`               | 401                                                                   |
| `forbidNonWhitelisted` | inject `email`/`userId`/`role`    | 400                                                                   |
| Cross-user IDOR        | use a foreign id                  | 404                                                                   |
| Raw error leak         | force a 500 (e.g. malformed body) | response JSON has no `Prisma`, `SELECT`, `column …`, `at TCPConnect…` |

## 12. Where Postman sits

- `docs/postman/hsm-backend.postman_collection.json` — IAM + infra (existing).
- `docs/postman/hsm-seeker.postman_collection.json` — every Seeker endpoint listed
  above. **Run the IAM Login first**: it populates `accessToken` / `csrfToken` in
  the shared environment which the seeker collection reads.
- `docs/postman/hsm-local.postman_environment.json` — host + variable baseline.

## 13. Maintenance

When a Seeker endpoint ships:

1. Add the curl recipe under the relevant sprint section.
2. Add a Postman request to `hsm-seeker.postman_collection.json` (test scripts must
   assert envelope shape + no raw error leaks).
3. Add a manual UI step to `manual-seeker-runtime.md`.
4. Update §11 if the slice introduced a new negative-test angle.
5. If a `scripts/runtime/verify-seeker-flow.cjs` step needs updating, do it in the
   same PR.
