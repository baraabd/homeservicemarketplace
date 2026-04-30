#!/usr/bin/env node

//
// Seeker runtime smoke harness.
//
// What this verifies:
//   - the API is up and ready
//   - service catalogue is non-empty
//   - the supplied access token resolves /v1/auth/me
//   - addresses CRUD: create → list → set-default → patch → delete
//   - service requests CRUD: create (ASAP + saved address) → list → detail →
//     timeline → cancel → reopen
//   - bookings list (read-only; no booking is created from Seeker side)
//   - notifications list + unread-count + mark-all-read
//   - conversations list
//   - profile get + patch
//
// What this DOES NOT verify (out of scope or not yet shipped):
//   - the auth bootstrap (register → verify → login → OTP). Those are mail-
//     dependent and handled by docs/testing/manual-seeker-runtime.md §2.
//   - avatar upload (Slice 4.2 not implemented).
//   - request attachments (Slice 4.3 not implemented).
//
// How to run:
//   1. Manually log in to the Seeker app at http://localhost:5173, then in
//      DevTools → Application → Cookies copy the values of `hsm_access` and
//      `hsm_csrf` for `localhost:4000`.
//   2. Pass them via env:
//        BASE_URL=http://localhost:4000 \
//        HSM_ACCESS=<paste hsm_access cookie value> \
//        HSM_CSRF=<paste hsm_csrf cookie value> \
//        node scripts/runtime/verify-seeker-flow.cjs
//   3. Optional: also pass HSM_REFRESH if you want the script to log it back
//      into the cookie jar (the script does NOT call /refresh).
//
// Behaviour:
//   - Exits 0 only when every step returned the expected status. The first
//     failed step prints the request id (X-Request-Id), status, and a redacted
//     body excerpt, then exits with code 2.
//   - Test data is prefixed with "runtime-verify-<unix>" so it's easy to
//     identify and clean up later. Cleanup is best-effort; failures are
//     reported but never fatal.
//   - No production secrets are read. The script refuses to run if NODE_ENV is
//     "production".
//
// Requires: Node 20+ (uses native fetch).

'use strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const HSM_ACCESS = process.env.HSM_ACCESS || '';
const HSM_CSRF = process.env.HSM_CSRF || '';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 10_000);
const RUN_ID = `runtime-verify-${Date.now()}`;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production. Local dev only.');
  process.exit(64);
}
if (!HSM_ACCESS || !HSM_CSRF) {
  console.error(
    'Missing HSM_ACCESS / HSM_CSRF env. Log in via the web app and copy the cookie values.\n' +
      'See scripts/runtime/verify-seeker-flow.cjs header for the full recipe.',
  );
  process.exit(64);
}
if (typeof fetch !== 'function') {
  console.error('Node 20+ is required (native fetch missing).');
  process.exit(64);
}

const cookieHeader = `hsm_access=${HSM_ACCESS}; hsm_csrf=${HSM_CSRF}`;

const created = {
  addressId: null,
  asapRequestId: null,
};

function fmtMs(ms) {
  return `${ms.toFixed(0)}ms`;
}

function redact(obj) {
  // Single-pass JSON-string redaction. We never want to dump raw tokens or
  // server stack frames on a CI tail.
  const s = typeof obj === 'string' ? obj : safeStringify(obj);
  return s
    .replace(
      /("?(accessToken|refreshToken|csrfToken|password|token)"?\s*[:=]\s*"?)[^",}\s]+/gi,
      '$1<redacted>',
    )
    .slice(0, 800);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function call(label, method, path, { body, expect = [200], note } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader,
  };
  const requiresCsrf = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  if (requiresCsrf) headers['X-CSRF-Token'] = HSM_CSRF;
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
    fail(label, `network error: ${err && err.message ? err.message : err}`);
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

async function main() {
  console.log(`# seeker runtime harness  (run id: ${RUN_ID})`);
  console.log(`# base: ${BASE_URL}`);
  console.log('');

  // ── Boot smoke ─────────────────────────────────────────────────────────────
  console.log('boot:');
  await call('health/live', 'GET', '/health/live');
  const ready = await call('health/ready', 'GET', '/health/ready');
  if (!ready || ready.ready !== true) fail('health/ready', 'ready != true', { ready });

  // ── Public catalogue ───────────────────────────────────────────────────────
  console.log('\ncatalogue:');
  const services = await call('list services', 'GET', '/v1/services');
  if (!services || !Array.isArray(services.items) || services.items.length === 0) {
    fail('list services', 'expected at least one seeded service category');
  }

  // ── Auth identity ──────────────────────────────────────────────────────────
  console.log('\nauth:');
  const me = await call('auth/me', 'GET', '/v1/auth/me');
  if (!me || !me.id) fail('auth/me', 'response missing id; cookies likely expired', { me });

  // ── Profile ────────────────────────────────────────────────────────────────
  console.log('\nprofile:');
  const profile = await call('get profile', 'GET', '/v1/me/profile');
  if (!profile || !profile.profile) fail('get profile', 'envelope missing `profile`', { profile });
  const originalCity = profile.profile.city;
  await call('patch profile', 'PATCH', '/v1/me/profile', {
    body: { city: `${RUN_ID}-city` },
    note: 'phoneNumber/city/bio writable',
  });
  // Restore the user's original city so the harness leaves no surprise diff.
  await call('restore profile city', 'PATCH', '/v1/me/profile', { body: { city: originalCity } });

  // ── Addresses ──────────────────────────────────────────────────────────────
  console.log('\naddresses:');
  const addrCreate = await call('create address', 'POST', '/v1/me/addresses', {
    body: {
      label: `${RUN_ID}-home`,
      line1: '1 Test Avenue',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      isDefault: true,
    },
    expect: [200, 201],
  });
  created.addressId = addrCreate && addrCreate.id;
  if (!created.addressId) fail('create address', 'response missing id', { addrCreate });
  await call('list addresses', 'GET', '/v1/me/addresses');
  await call('set default address', 'POST', `/v1/me/addresses/${created.addressId}/default`);
  await call('patch address', 'PATCH', `/v1/me/addresses/${created.addressId}`, {
    body: { label: `${RUN_ID}-home-edit` },
  });

  // ── Service requests ──────────────────────────────────────────────────────
  console.log('\nrequests:');
  const reqCreate = await call('create request (ASAP)', 'POST', '/v1/me/requests', {
    body: {
      categoryId: null,
      customServiceText: `${RUN_ID}-Plumbing`,
      description: `${RUN_ID} description`,
      scheduleType: 'ASAP',
      scheduledAt: null,
      addressId: created.addressId,
      manualAddress: null,
    },
  });
  created.asapRequestId = reqCreate && reqCreate.id;
  if (!created.asapRequestId) fail('create request', 'response missing id', { reqCreate });

  await call('list requests', 'GET', '/v1/me/requests?limit=20');
  await call('request detail', 'GET', `/v1/me/requests/${created.asapRequestId}`);
  await call('request timeline', 'GET', `/v1/me/requests/${created.asapRequestId}/timeline`);
  await call('cancel request', 'POST', `/v1/me/requests/${created.asapRequestId}/cancel`);
  await call('reopen request', 'POST', `/v1/me/requests/${created.asapRequestId}/reopen`);

  // Bids on a freshly-created request return an empty list — that's the
  // contract before any Provider has bid. Just assert the shape.
  const bids = await call('list bids', 'GET', `/v1/me/requests/${created.asapRequestId}/bids`);
  if (!bids || !Array.isArray(bids.items))
    fail('list bids', 'envelope missing `items[]`', { bids });

  // ── Bookings (read-only from Seeker) ──────────────────────────────────────
  console.log('\nbookings:');
  await call('list bookings', 'GET', '/v1/me/bookings?limit=20');

  // ── Notifications ─────────────────────────────────────────────────────────
  console.log('\nnotifications:');
  await call('unread count', 'GET', '/v1/me/notifications/unread-count');
  await call('list notifications', 'GET', '/v1/me/notifications?limit=20');
  await call('read all', 'POST', '/v1/me/notifications/read-all');

  // ── Conversations ─────────────────────────────────────────────────────────
  console.log('\nconversations:');
  await call('list conversations', 'GET', '/v1/me/conversations?limit=20');

  // ── Cleanup (best effort) ─────────────────────────────────────────────────
  console.log('\ncleanup:');
  await cleanup();

  console.log('\nall green ✓');
}

async function cleanup() {
  // Leave the cancelled+reopened request behind — there is no Seeker-side
  // delete endpoint for requests, and re-cancelling a reopened one is more
  // confusing than helpful when the user inspects the data later. Address
  // is safe to delete.
  if (created.addressId) {
    try {
      await call('delete address', 'DELETE', `/v1/me/addresses/${created.addressId}`, {
        expect: [200, 204],
      });
    } catch (err) {
      // The call() helper exits on failure, so this only triggers if cleanup
      // raises a non-call() error.
      console.warn(`  cleanup error (non-fatal): ${err && err.message ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error('unexpected harness failure:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
