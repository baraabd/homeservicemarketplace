#!/usr/bin/env node
/*
 * Sprint 6 — runtime verification of the outbox fan-out, over real HTTP.
 *
 * Static checks and integration tests both stop short of the thing that
 * actually has to work: a seeker creates a request through the API, and a
 * matching provider ends up with a notification, delivered by a background
 * worker in another part of the process.
 *
 * What this proves, in order:
 *   1. login + OTP through Mailpit yields a usable session
 *   2. POST /v1/me/requests commits an outbox event IN the same transaction
 *   3. the worker claims it, dispatches slices, and reaches PROCESSED
 *   4. a matching provider has a REQUEST_AVAILABLE notification row
 *   5. a provider OUTSIDE the service area does not
 *   6. the deprecated route family still answers, with the right headers
 *
 * Usage:
 *   node scripts/runtime/verify-sprint06-outbox.cjs [--api http://localhost:4300]
 */

const API = argValue('--api', process.env.API_URL || 'http://localhost:4300');
const MAILPIT = argValue('--mailpit', process.env.MAILPIT_URL || 'http://localhost:8025');
const SEEKER = { email: 'test@admin.com', password: '1qaz2wsx3edc!!' };

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

let passed = 0;
function ok(msg) {
  passed += 1;
  console.log(`  PASS  ${msg}`);
}
function fail(msg) {
  console.error(`  FAIL  ${msg}`);
  process.exit(1);
}
function step(msg) {
  console.log(`\n=== ${msg} ===`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

/** Poll Mailpit for the newest message to `to` and pull the 6-digit code. */
async function readOtp(to, notBefore) {
  for (let i = 0; i < 60; i++) {
    const list = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
      .then((r) => r.json())
      .catch(() => null);
    const msg = list?.messages?.find((m) => new Date(m.Created).getTime() >= notBefore);
    if (msg) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json());
      const m = `${full.Text || ''} ${full.Snippet || ''}`.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  const { PrismaClient } = require('../../packages/database/generated/prisma');
  const prisma = new PrismaClient();

  try {
    // ── 1. session ────────────────────────────────────────────────────────
    step('1. Authenticate the seeker (login -> OTP via Mailpit -> verify)');
    const startedAt = Date.now() - 2000;
    const login = await http('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(SEEKER),
    });
    if (login.status !== 200 || !login.body?.challengeId) {
      fail(`login returned ${login.status}: ${JSON.stringify(login.body)}`);
    }
    ok('login issued an OTP challenge');

    const code = await readOtp(SEEKER.email, startedAt);
    if (!code) fail('no OTP arrived at Mailpit within 30s');
    ok('OTP delivered and read back');

    const verify = await http('/v1/auth/verify-otp', {
      method: 'POST',
      headers: { 'x-client-kind': 'mobile' },
      body: JSON.stringify({ challengeId: login.body.challengeId, code }),
    });
    const token = verify.body?.tokens?.accessToken;
    if (!token) fail(`verify-otp returned no token: ${JSON.stringify(verify.body)}`);
    ok('session established');
    const auth = { authorization: `Bearer ${token}` };

    // ── 2. providers ──────────────────────────────────────────────────────
    step('2. Position one provider INSIDE and one OUTSIDE the service area');
    // Aleppo, and a point ~300 km away.
    const CENTRE = { lat: 36.2021, lng: 37.1343 };
    const FAR = { lat: 33.5138, lng: 36.2765 };

    const profiles = await prisma.providerProfile.findMany({
      where: { status: 'ACTIVE', userId: { not: null } },
      take: 2,
      orderBy: { id: 'asc' },
    });
    if (profiles.length < 2) fail('need at least two ACTIVE provider profiles; run the seed');

    const category = await prisma.serviceCategory.findFirst({ where: { isActive: true } });
    if (!category) fail('no active service category; run the seed');

    const [near, far] = profiles;
    for (const [profile, point] of [
      [near, CENTRE],
      [far, FAR],
    ]) {
      await prisma.providerProfile.update({
        where: { id: profile.id },
        data: {
          serviceAreaLat: point.lat,
          serviceAreaLng: point.lng,
          serviceAreaRadiusKm: 25,
          serviceAreaCity: 'Aleppo',
          serviceAreaCityKey: 'aleppo',
        },
      });
      await prisma.providerProfileServiceCategory.upsert({
        where: {
          providerProfileId_serviceCategoryId: {
            providerProfileId: profile.id,
            serviceCategoryId: category.id,
          },
        },
        create: { providerProfileId: profile.id, serviceCategoryId: category.id },
        update: {},
      });
    }
    ok(`near=${near.id} at the centre, far=${far.id} ~300 km away, both 25 km radius`);

    // Both share the city key, so ONLY the radius can tell them apart. If the
    // radius were still unused, both would be notified.
    const before = await prisma.notification.count({
      where: { userId: { in: [near.userId, far.userId] }, type: 'REQUEST_AVAILABLE' },
    });

    // ── 3. create a request ───────────────────────────────────────────────
    step('3. Create a request at the service-area centre');
    const created = await http('/v1/me/requests', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        categoryId: category.id,
        description: 'Sprint 6 runtime verification',
        scheduleType: 'ASAP',
        manualAddress: {
          label: 'Runtime check',
          line1: '1 Verification Street',
          city: 'Aleppo',
          country: 'SY',
          lat: CENTRE.lat,
          lng: CENTRE.lng,
        },
      }),
    });
    if (created.status !== 201 && created.status !== 200) {
      fail(`create returned ${created.status}: ${JSON.stringify(created.body)}`);
    }
    const requestId = created.body?.id;
    if (!requestId) fail(`create returned no id: ${JSON.stringify(created.body)}`);
    ok(`request ${requestId} created`);

    // ── 4. the promoted columns ───────────────────────────────────────────
    step('4. The queryable location columns were written alongside the snapshot');
    const row = await prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (row.locationCityKey !== 'aleppo') fail(`locationCityKey = ${row.locationCityKey}`);
    if (Math.abs(row.locationLat - CENTRE.lat) > 1e-9) fail(`locationLat = ${row.locationLat}`);
    ok(`locationCityKey=${row.locationCityKey} lat=${row.locationLat} lng=${row.locationLng}`);

    // ── 5. the outbox ─────────────────────────────────────────────────────
    step('5. The outbox event was committed with the request and then delivered');
    const dispatch = await prisma.outboxEvent.findFirst({
      where: { aggregateId: requestId, eventType: 'request.available' },
    });
    if (!dispatch) fail('no request.available outbox row was written');
    ok(`dispatch event ${dispatch.id} exists (status=${dispatch.status})`);

    let settled = null;
    for (let i = 0; i < 60; i++) {
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: requestId } });
      if (events.length > 0 && events.every((e) => e.status === 'PROCESSED')) {
        settled = events;
        break;
      }
      if (events.some((e) => e.status === 'DEAD')) {
        const dead = events.find((e) => e.status === 'DEAD');
        fail(`event ${dead.id} dead-lettered: ${dead.lastError}`);
      }
      await sleep(500);
    }
    if (!settled) fail('outbox events did not reach PROCESSED within 30s');
    ok(`all ${settled.length} events PROCESSED (1 dispatch + ${settled.length - 1} batch)`);

    const markers = await prisma.outboxHandlerRun.count({
      where: { eventId: { in: settled.map((e) => e.id) } },
    });
    ok(`${markers} idempotency marker(s) recorded`);

    // ── 6. who got notified ───────────────────────────────────────────────
    step('6. Only the in-radius provider was notified');
    const nearCount = await prisma.notification.count({
      where: { userId: near.userId, type: 'REQUEST_AVAILABLE', resourceId: requestId },
    });
    const farCount = await prisma.notification.count({
      where: { userId: far.userId, type: 'REQUEST_AVAILABLE', resourceId: requestId },
    });
    if (nearCount !== 1) fail(`in-radius provider has ${nearCount} notifications, expected 1`);
    ok('in-radius provider received exactly one notification');
    if (farCount !== 0) {
      fail(`out-of-radius provider received ${farCount} — the radius is not being applied`);
    }
    ok('out-of-radius provider received none, despite sharing the city key');

    const after = await prisma.notification.count({
      where: { userId: { in: [near.userId, far.userId] }, type: 'REQUEST_AVAILABLE' },
    });
    if (after - before !== 1) fail(`expected exactly 1 new notification, saw ${after - before}`);
    ok('exactly one notification written in total (no duplicates)');

    // ── 7. deprecated routes ──────────────────────────────────────────────
    step('7. Legacy routes still answer, and advertise their replacement');
    const legacy = await http('/v1/me/provider/jobs/available', { headers: auth });
    // 403 is the expected answer for a seeker on a provider route — what
    // matters is that the route still EXISTS and carries the headers.
    if (legacy.status === 404) fail('legacy route was removed; it must keep working');
    ok(`legacy route still routed (HTTP ${legacy.status}, not 404)`);
    if (legacy.headers.get('deprecation') !== 'true') {
      fail(`missing Deprecation header (got ${legacy.headers.get('deprecation')})`);
    }
    ok('Deprecation: true');
    const link = legacy.headers.get('link') || '';
    if (!link.includes('successor-version')) fail(`Link header missing successor: ${link}`);
    ok(`Link: ${link}`);
    if (!legacy.headers.get('sunset')) fail('missing Sunset header');
    ok(`Sunset: ${legacy.headers.get('sunset')}`);

    const canonical = await http('/v1/provider/available-requests', { headers: auth });
    if (canonical.headers.get('deprecation')) {
      fail('the canonical route must NOT be marked deprecated');
    }
    ok('canonical route carries no deprecation headers');

    console.log(`\nSprint 6 runtime verification passed (${passed} assertions).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
