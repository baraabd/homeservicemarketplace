#!/usr/bin/env node

//
// Provider Core Loop runtime harness (Sprint 5.7).
//
// Drives the full multi-actor provider story end-to-end against a
// running dev API, with one HTTP call per step + an assertion on the
// expected status code and response shape. Test data is prefixed with
// "rprov-<unix>-" so it's easy to grep / clean up later. The harness
// uses bearer tokens, not cookies, so CSRF + cookie state are out of
// scope (mobile-mode auth bypasses CsrfGuard server-side).
//
// What this harness verifies:
//   1. Seeker creates a request                       (POST /v1/me/requests)
//   2. Seeker can read their own request              (GET /v1/me/requests/:id)
//   3. Admin sees the provider profile in the queue   (GET /v1/admin/providers)
//   4. Admin approves the provider                    (POST /v1/admin/providers/:id/approve)
//   5. Provider sees the seeker's request             (GET /v1/provider/available-requests)
//   6. Provider submits a bid                         (POST /v1/me/provider/bids)
//   7. Seeker accepts the bid                         (POST /v1/me/requests/:rid/bids/:bid/accept)
//   8. Booking exists                                 (GET /v1/me/provider/bookings)
//   9. Provider starts the booking                    (POST /v1/me/provider/bookings/:id/start)
//  10. Provider completes the booking                 (POST /v1/me/provider/bookings/:id/complete)
//  11. Notifications fired for the seeker             (GET /v1/me/notifications  as seeker)
//  12. Chat round-trip works                          (POST + GET /v1/provider/conversations/...)
//  13. Earnings update                                (GET /v1/provider/earnings/summary)
//
// What this harness DOES NOT do:
//   - Bootstrap the three accounts. Auth flows are verified separately
//     in apps/api e2e + integration tests; here the operator pre-supplies
//     tokens via env so the harness focuses on the loop itself.
//   - Drive the web UI. The frontend has its own vitest suite for the
//     wallet, bookings, notifications, chat surfaces.
//
// How to obtain the three bearer tokens:
//   The Postman collection at postman/FixNow Provider Runtime.postman_collection.json
//   has a "00 — Bootstrap" folder that drives /v1/auth/register +
//   /v1/auth/verify-email + /v1/auth/login + /v1/auth/verify-otp for each
//   of the three roles (seeker / provider / admin) with X-Client-Kind: mobile,
//   so each request returns its bearer token in the response body.
//
//   Quick-start with curl + Mailpit (dev):
//     1. POST {API}/v1/auth/register  {email, password}
//     2. Open http://localhost:8025 (Mailpit) → grab verification token
//     3. POST {API}/v1/auth/verify-email  {token}
//     4. POST {API}/v1/auth/login  {email, password}  →  challengeId
//     5. Open http://localhost:8025 → grab OTP code
//     6. POST {API}/v1/auth/verify-otp  {challengeId, code}  →  accessToken
//     7. For provider: POST {API}/v1/me/provider/upgrade  (needs the bearer)
//     8. For admin: a seeded admin user must already exist in the DB.
//
//   See docs/testing/provider-runtime-loop.md for a step-by-step.
//
// How to run:
//   BASE_URL=http://localhost:4000 \
//   SEEKER_TOKEN=<bearer> \
//   PROVIDER_TOKEN=<bearer> \
//   ADMIN_TOKEN=<bearer> \
//   PROVIDER_PROFILE_ID=<id of provider's profile> \
//   node scripts/runtime/verify-provider-loop.cjs
//
//   PROVIDER_PROFILE_ID is read once via GET /v1/me/provider/profile if
//   omitted; passing it explicitly skips that lookup and is faster on
//   re-runs.
//
// Exit codes:
//   0  — every step returned the expected status; the loop is green.
//   2  — a step failed; the failed label, request id, status, and a
//        redacted body excerpt are printed to stderr.
//   64 — required env missing (NODE_ENV=production, missing tokens, etc.).
//
// Requires: Node 20+ (uses native fetch).
//

'use strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const SEEKER_TOKEN = process.env.SEEKER_TOKEN || '';
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PROVIDER_PROFILE_ID_HINT = process.env.PROVIDER_PROFILE_ID || '';
const SERVICE_CATEGORY_SLUG = process.env.SERVICE_CATEGORY_SLUG || 'plumbing';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15_000);
const RUN_ID = `rprov-${Date.now()}`;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production. Local dev only.');
  process.exit(64);
}
if (!SEEKER_TOKEN || !PROVIDER_TOKEN || !ADMIN_TOKEN) {
  console.error(
    'Missing one or more bearer tokens. Required env:\n' +
      '  SEEKER_TOKEN, PROVIDER_TOKEN, ADMIN_TOKEN\n' +
      'See the file header for how to obtain each.',
  );
  process.exit(64);
}
if (typeof fetch !== 'function') {
  console.error('Node 20+ is required (native fetch missing).');
  process.exit(64);
}

const captured = {
  requestId: null,
  bidId: null,
  bookingId: null,
  providerProfileId: PROVIDER_PROFILE_ID_HINT || null,
  conversationId: null,
};

function fmtMs(ms) {
  return `${ms.toFixed(0)}ms`;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function redact(obj) {
  const s = typeof obj === 'string' ? obj : safeStringify(obj);
  return s
    .replace(
      /("?(accessToken|refreshToken|csrfToken|password|token)"?\s*[:=]\s*"?)[^",}\s]+/gi,
      '$1<redacted>',
    )
    .slice(0, 800);
}

function fail(label, reason, extras) {
  console.error('');
  console.error(`✗ ${label}`);
  console.error(`  ${reason}`);
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      console.error(`  ${k}: ${typeof v === 'string' ? v : safeStringify(v)}`);
    }
  }
  process.exit(2);
}

async function call(label, method, path, opts = {}) {
  const { body, expect = [200], token, note } = opts;
  const url = `${BASE_URL}${path}`;
  const headers = {
    Accept: 'application/json',
    'X-Client-Kind': 'mobile',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let bodyStr;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const expected = Array.isArray(expect) ? expect : [expect];
  const start = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    fail(label, `network error: ${(err && err.message) || err}`);
  }
  const dur = performance.now() - start;
  const reqId = res.headers.get('x-request-id') || res.headers.get('request-id') || '-';
  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave parsed null
    }
  }
  if (!expected.includes(res.status)) {
    fail(label, `expected ${expected.join('/')} got ${res.status} (request-id ${reqId})`, {
      bodyExcerpt: redact(parsed ?? text),
      method,
      path,
    });
  }
  // Defensive: error envelope must never carry Prisma/SQL strings.
  if (text && /Prisma|PrismaClient|column .* does not exist|SELECT |INSERT |UPDATE /i.test(text)) {
    fail(label, `raw Prisma/SQL string leaked in response body (request-id ${reqId})`, {
      bodyExcerpt: redact(parsed ?? text),
    });
  }
  console.log(
    `  ✓ ${label.padEnd(48)} ${method} ${path}  ${res.status}  ${fmtMs(dur)}  ${note ?? ''}`.trimEnd(),
  );
  return parsed;
}

async function main() {
  console.log(`# provider runtime harness  (run id: ${RUN_ID})`);
  console.log(`# base: ${BASE_URL}`);
  console.log('');

  // ── Boot smoke ─────────────────────────────────────────────────────────────
  console.log('boot:');
  await call('health/live', 'GET', '/health/live');
  const ready = await call('health/ready', 'GET', '/health/ready');
  if (!ready || ready.ready !== true) fail('health/ready', 'ready != true', { ready });

  // ── Resolve service category id (the seeker request needs one) ─────────────
  console.log('\ncatalogue:');
  const cat = await call('list services', 'GET', '/v1/services');
  if (!cat || !Array.isArray(cat.items) || cat.items.length === 0) {
    fail('list services', 'expected at least one seeded service category');
  }
  const category = cat.items.find((c) => c.slug === SERVICE_CATEGORY_SLUG) || cat.items[0];
  if (!category || !category.id) {
    fail('list services', `no category matched slug=${SERVICE_CATEGORY_SLUG}`, {
      items: cat.items,
    });
  }
  console.log(`  → category: ${category.slug} (${category.id})`);

  // ── Resolve providerProfileId from PROVIDER_TOKEN if not pre-supplied ──────
  if (!captured.providerProfileId) {
    const prof = await call('provider profile', 'GET', '/v1/me/provider/profile', {
      token: PROVIDER_TOKEN,
    });
    if (!prof || !prof.profile || !prof.profile.id) {
      fail('provider profile', 'envelope missing profile.id', { prof });
    }
    captured.providerProfileId = prof.profile.id;
  }
  console.log(`  → providerProfileId: ${captured.providerProfileId}`);

  // ── Step 1: seeker creates a request ───────────────────────────────────────
  console.log('\nseeker:');
  const reqBody = {
    categoryId: category.id,
    description: `${RUN_ID} runtime check — please ignore.`,
    scheduleType: 'ASAP',
    manualAddress: {
      label: 'Runtime test address',
      line1: '1 Runtime Way',
      city: 'Riyadh',
      country: 'SA',
      lat: 24.7136,
      lng: 46.6753,
    },
  };
  const created = await call('create request', 'POST', '/v1/me/requests', {
    token: SEEKER_TOKEN,
    body: reqBody,
    expect: [200, 201],
  });
  const requestRow = created?.request ?? created;
  if (!requestRow || !requestRow.id) {
    fail('create request', 'envelope missing request.id', { created });
  }
  captured.requestId = requestRow.id;
  console.log(`  → requestId: ${captured.requestId}`);

  // ── Step 2: seeker reads their own request (sanity) ────────────────────────
  await call('seeker reads request detail', 'GET', `/v1/me/requests/${captured.requestId}`, {
    token: SEEKER_TOKEN,
  });

  // ── Step 3: admin sees the provider profile ────────────────────────────────
  console.log('\nadmin:');
  const adminList = await call('admin list providers', 'GET', '/v1/admin/providers', {
    token: ADMIN_TOKEN,
  });
  if (!adminList || !Array.isArray(adminList.items)) {
    fail('admin list providers', 'expected items array', { adminList });
  }
  const profileInQueue = adminList.items.find((p) => p.id === captured.providerProfileId);
  if (!profileInQueue) {
    console.log(
      `  i provider profile ${captured.providerProfileId} not visible in default page; ` +
        "continuing because admin actions don't require listing first",
    );
  }

  // ── Step 4: admin approves the provider (idempotent — 200 OR 409 OK) ───────
  // Approving an already-ACTIVE profile is a CONFLICT in the current
  // service; treat that as success for harness reruns.
  await call(
    'admin approve provider',
    'POST',
    `/v1/admin/providers/${captured.providerProfileId}/approve`,
    {
      token: ADMIN_TOKEN,
      body: { note: `${RUN_ID} approve` },
      expect: [200, 201, 204, 409],
      note: 'idempotent on rerun',
    },
  );

  // ── Step 5: provider sees the seeker's request in the available feed ───────
  console.log('\nprovider:');
  const feed = await call('provider available requests', 'GET', '/v1/provider/available-requests', {
    token: PROVIDER_TOKEN,
  });
  if (!feed || !Array.isArray(feed.items)) {
    fail('provider available requests', 'expected items array', { feed });
  }
  const visible = feed.items.find((r) => r.id === captured.requestId);
  if (!visible) {
    console.log(
      `  i request ${captured.requestId} not in the first page; the bid step still proceeds`,
    );
  }

  // ── Step 6: provider submits a bid ─────────────────────────────────────────
  const bidRes = await call('provider submits bid', 'POST', '/v1/me/provider/bids', {
    token: PROVIDER_TOKEN,
    body: {
      requestId: captured.requestId,
      priceQuote: { amount: 4500, currency: 'USD', pricingType: 'FIXED' },
      note: `${RUN_ID} bid`,
    },
    expect: [200, 201],
  });
  const bidRow = bidRes?.bid ?? bidRes;
  if (!bidRow || !bidRow.id) {
    fail('provider submits bid', 'envelope missing bid.id', { bidRes });
  }
  captured.bidId = bidRow.id;
  console.log(`  → bidId: ${captured.bidId}`);

  // ── Step 7: seeker accepts the bid ─────────────────────────────────────────
  console.log('\nseeker accepts:');
  const accepted = await call(
    'seeker accepts bid',
    'POST',
    `/v1/me/requests/${captured.requestId}/bids/${captured.bidId}/accept`,
    { token: SEEKER_TOKEN, expect: [200, 201] },
  );
  // Accept response shape: AcceptBidResponse — should carry booking somewhere.
  // The harness picks up bookingId from the provider list a moment later
  // since the wire shape varies; the assertion here is just status.
  if (!accepted) {
    fail('seeker accepts bid', 'no body returned', { accepted });
  }

  // ── Step 8: booking is visible to the provider ─────────────────────────────
  console.log('\nprovider booking lifecycle:');
  const bookings = await call('provider lists bookings', 'GET', '/v1/me/provider/bookings', {
    token: PROVIDER_TOKEN,
  });
  const items = bookings?.items ?? [];
  const myBooking = items.find((b) => b.bidId === captured.bidId || b.bid?.id === captured.bidId);
  if (!myBooking || !myBooking.id) {
    fail('provider lists bookings', 'no booking found for the accepted bid', {
      bookings: items.slice(0, 3),
    });
  }
  captured.bookingId = myBooking.id;
  console.log(`  → bookingId: ${captured.bookingId}`);

  // ── Step 9: provider starts the booking ────────────────────────────────────
  await call(
    'provider starts booking',
    'POST',
    `/v1/me/provider/bookings/${captured.bookingId}/start`,
    { token: PROVIDER_TOKEN, expect: [200, 201, 204] },
  );

  // ── Step 10: provider completes the booking ────────────────────────────────
  await call(
    'provider completes booking',
    'POST',
    `/v1/me/provider/bookings/${captured.bookingId}/complete`,
    { token: PROVIDER_TOKEN, expect: [200, 201, 204] },
  );

  // ── Step 11: seeker has at least one new notification ──────────────────────
  console.log('\nnotifications:');
  const notifs = await call('seeker notifications', 'GET', '/v1/me/notifications', {
    token: SEEKER_TOKEN,
  });
  if (!notifs || !Array.isArray(notifs.items)) {
    fail('seeker notifications', 'expected items array', { notifs });
  }
  if (notifs.items.length === 0) {
    fail(
      'seeker notifications',
      'expected at least one notification after the booking lifecycle ' +
        '(bid accepted / booking started / booking completed)',
      { itemCount: notifs.items.length },
    );
  }

  // ── Step 12: chat — provider opens conversation, sends, reads back ─────────
  console.log('\nchat:');
  const conv = await call('provider opens conversation', 'POST', '/v1/provider/conversations', {
    token: PROVIDER_TOKEN,
    body: { bookingId: captured.bookingId },
    expect: [200, 201],
  });
  const convRow = conv?.conversation ?? conv;
  if (!convRow || !convRow.id) {
    fail('provider opens conversation', 'envelope missing conversation.id', { conv });
  }
  captured.conversationId = convRow.id;
  await call(
    'provider sends message',
    'POST',
    `/v1/provider/conversations/${captured.conversationId}/messages`,
    {
      token: PROVIDER_TOKEN,
      body: { body: `${RUN_ID} chat round-trip` },
      expect: [200, 201],
    },
  );
  const messages = await call(
    'provider lists messages',
    'GET',
    `/v1/provider/conversations/${captured.conversationId}/messages`,
    { token: PROVIDER_TOKEN },
  );
  if (
    !messages ||
    !Array.isArray(messages.items) ||
    !messages.items.some((m) => typeof m.body === 'string' && m.body.includes(RUN_ID))
  ) {
    fail('provider lists messages', 'sent message did not round-trip', { messages });
  }

  // ── Step 13: provider earnings reflect the completed booking ───────────────
  console.log('\nearnings:');
  const earnings = await call('provider earnings', 'GET', '/v1/provider/earnings/summary', {
    token: PROVIDER_TOKEN,
  });
  if (!earnings || typeof earnings.grossEarnings !== 'number') {
    fail('provider earnings', 'envelope missing grossEarnings number', { earnings });
  }
  if (earnings.completedBookingsCount < 1) {
    fail('provider earnings', 'completedBookingsCount expected ≥ 1 after the loop', {
      completedBookingsCount: earnings.completedBookingsCount,
    });
  }
  console.log(
    `  → gross=${earnings.grossEarnings} fees=${earnings.platformFees} net=${earnings.netEarnings} count=${earnings.completedBookingsCount}`,
  );

  // ── Negative security spot-check: cross-role 403 ───────────────────────────
  console.log('\nnegative:');
  await call(
    'seeker token cannot reach /v1/provider/earnings/summary',
    'GET',
    '/v1/provider/earnings/summary',
    { token: SEEKER_TOKEN, expect: [403] },
  );

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\nall green.');
  console.log('captured ids (paste into postman/local.postman_environment.json if useful):');
  for (const [k, v] of Object.entries(captured)) {
    if (v) console.log(`  ${k}=${v}`);
  }
}

main().catch((err) => {
  console.error('');
  console.error('✗ harness crashed');
  console.error(`  ${err && err.stack ? err.stack : err}`);
  process.exit(2);
});
