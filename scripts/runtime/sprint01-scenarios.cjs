'use strict';

// Sprint 01 remediation — the security scenarios themselves.
//
// Every scenario runs against LIVE API instances. Nothing here is mocked; the
// only accommodation for automation is reading OTP codes and reset links back
// out of the SMTP sink, which keeps AUTH_REQUIRE_EMAIL_VERIFICATION=true so the
// real flow is what gets proved.
//
// Two API instances (A and B) share one Postgres and one Redis, which is what
// makes the cross-instance claims testable: a mutation is performed on A and
// its effect is observed on B.

const path = require('node:path');

const PROTECTED = '/v1/auth/me';

async function run(h) {
  const {
    Client,
    check,
    section,
    signUpAndLogin,
    loginExisting,
    latestMailFor,
    otpFrom,
    resetTokenFrom,
    openSocket,
    awaitDisconnect,
    sleep,
    nextEmail,
    A,
    B,
    PASSWORD,
    RUN,
  } = h;

  // A privileged operator is required to drive the admin scenarios. It is
  // created out-of-band exactly as the documented bootstrap path prescribes —
  // there is no in-app route that grants admin, which is the point.
  const admin = await bootstrapAdmin(h);

  await d1RegistrationThrottle(h);
  await d2TokenRevocation(h);
  await d4RealtimeAuthorization(h, admin);
  await adminAccessLifecycle(h, admin);
  await providerLifecycle(h, admin);
  await customerLifecycle(h);
  await idor(h);

  // Keep the linter honest about the destructured helpers used indirectly.
  void [
    Client,
    check,
    section,
    signUpAndLogin,
    loginExisting,
    latestMailFor,
    otpFrom,
    resetTokenFrom,
    openSocket,
    awaitDisconnect,
    sleep,
    nextEmail,
    A,
    B,
    PASSWORD,
    RUN,
  ];
}

// ─── bootstrap an operator ───────────────────────────────────────────────────

async function bootstrapAdmin(h) {
  const { signUpAndLogin, loginExisting, A } = h;
  const { email, client } = await signUpAndLogin(A, 'admin', 'admin');

  // Out-of-band grant, via the documented operator routine. This is the ONLY
  // sanctioned path to the first admin — there is no in-app endpoint that
  // grants it, which is the property under test everywhere below.
  //
  // Resolved from the workspace package by path because this harness lives at
  // the repo root, which does not depend on @homeservicemarketplace/database.
  const dbPath = path.resolve(__dirname, '../../packages/database/dist/index.js');
  const grantPath = path.resolve(__dirname, '../../packages/database/dist/admin-access-grant.js');
  const { prisma } = require(dbPath);
  const { grantAdminWithTx } = require(grantPath);
  await prisma.$transaction((tx) => grantAdminWithTx(tx, email, false));

  // The grant does not retro-fit the role into an already-issued token, so the
  // operator signs in again — which is exactly the behaviour the remediation
  // relies on (role changes require a fresh session).
  const fresh = await loginExisting(A, email, 'admin');
  return { email, client: fresh, stale: client };
}

// ─── D-1 ─────────────────────────────────────────────────────────────────────

async function d1RegistrationThrottle(h) {
  const { Client, check, section, resetRateLimits, A, B, PASSWORD, RUN } = h;
  section('D-1 — production-safe registration rate limiting');

  // Each sub-scenario uses a distinct forwarded identity so the buckets do not
  // collide. TRUST_PROXY_HOPS=0 means X-Forwarded-For is IGNORED, so all these
  // requests share the loopback IP bucket — which is itself part of the proof
  // that a forged header cannot mint a fresh bucket. To exercise the per-EMAIL
  // dimension independently, each attempt uses a different address.

  // ── the headline rule: five accepted, the sixth refused ────────────────────
  // This sequence runs against a freshly cleared bucket and NEVER resets in the
  // middle — the six consecutive attempts ARE the proof.
  await resetRateLimits();
  const client = new Client(A, 'throttle');
  const attempts = [];
  for (let i = 1; i <= 6; i += 1) {
    const res = await client.post('/v1/auth/register', {
      email: `d1-${RUN}-${i}@harness.local`,
      password: PASSWORD,
      firstName: 'Rate',
      lastName: 'Limit',
    });
    attempts.push(res);
  }
  const statuses = attempts.map((r) => r.status);

  check(
    'D-1 first five validly-shaped attempts are accepted, the sixth is 429',
    statuses.slice(0, 5).every((s) => s === 202) && statuses[5] === 429,
    { statuses },
  );

  const sixth = attempts[5];
  check('D-1 the 429 carries the stable RATE_LIMITED envelope', sixth.code === 'RATE_LIMITED', {
    status: sixth.status,
    code: sixth.code,
  });
  check(
    'D-1 the 429 carries a positive Retry-After',
    sixth.retryAfter !== null && Number(sixth.retryAfter) > 0,
    { retryAfter: sixth.retryAfter },
  );
  check(
    'D-1 the 429 body leaks no framework artefact',
    !JSON.stringify(sixth.body ?? {}).includes('ThrottlerException'),
    { body: sixth.body },
  );

  // ── cross-instance aggregate ───────────────────────────────────────────────
  // The defect: with per-instance in-memory counters the budget was
  // limit × replicas. Alternating between two live instances must NOT reset it.
  await resetRateLimits();
  const alternating = [];
  for (let i = 1; i <= 6; i += 1) {
    const instance = new Client(i % 2 === 1 ? A : B, `alt-${i}`);
    const res = await instance.post('/v1/auth/register', {
      email: `d1-alt-${RUN}-${i}@harness.local`,
      password: PASSWORD,
      firstName: 'Alt',
      lastName: 'Instance',
    });
    alternating.push({ instance: i % 2 === 1 ? 'A' : 'B', status: res.status });
  }
  // Five accepted and the sixth refused, even though the attempts were served
  // by two different processes with independent memory. With the previous
  // in-memory store this sequence returned six acceptances.
  check(
    'D-1 the budget is AGGREGATE across instances: 5 accepted, the 6th refused while alternating A/B',
    alternating.slice(0, 5).every((r) => r.status === 202) &&
      alternating[5].status === 429 &&
      alternating.some((r) => r.instance === 'A') &&
      alternating.some((r) => r.instance === 'B'),
    { alternating },
  );

  // ── anti-enumeration ───────────────────────────────────────────────────────
  // A known and an unknown address must be refused identically once the budget
  // is gone, so the limiter cannot be used as an existence oracle. The bucket
  // is deliberately left exhausted from the block above.
  const probe = new Client(A, 'probe');
  const known = await probe.post('/v1/auth/register', {
    email: `d1-${RUN}-1@harness.local`, // registered in the first block
    password: PASSWORD,
    firstName: 'Known',
    lastName: 'Probe',
  });
  const unknown = await probe.post('/v1/auth/register', {
    email: `d1-never-${RUN}@harness.local`,
    password: PASSWORD,
    firstName: 'Unknown',
    lastName: 'Probe',
  });
  check(
    'D-1 known and unknown emails are indistinguishable under throttling',
    known.status === unknown.status && known.code === unknown.code,
    {
      known: { status: known.status, code: known.code },
      unknown: { status: unknown.status, code: unknown.code },
    },
  );

  // ── forged X-Forwarded-For cannot mint a fresh bucket ─────────────────────
  const forger = new Client(A, 'forged-xff');
  const forged = await forger.post(
    '/v1/auth/register',
    {
      email: `d1-forged-${RUN}@harness.local`,
      password: PASSWORD,
      firstName: 'Forged',
      lastName: 'Header',
    },
    { headers: { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}` } },
  );
  check(
    'D-1 a forged X-Forwarded-For does NOT escape the rate-limit bucket',
    forged.status === 429,
    { status: forged.status, code: forged.code, trustProxyHops: 0 },
  );
}

// ─── D-2 ─────────────────────────────────────────────────────────────────────

async function d2TokenRevocation(h) {
  const {
    check,
    section,
    signUpAndLogin,
    loginExisting,
    latestMailFor,
    resetTokenFrom,
    Client,
    A,
    B,
    PASSWORD,
  } = h;
  section('D-2 — immediate access-token revocation');

  // ── single-session logout ──────────────────────────────────────────────────
  const { email, client: deviceOne } = await signUpAndLogin(A, 'd2-logout', 'device-1');
  const deviceTwo = await loginExisting(A, email, 'device-2');

  const before = await deviceOne.get(PROTECTED);
  check('D-2 protected endpoint returns 200 before logout', before.status === 200, {
    status: before.status,
  });

  // Replay exactly the credential set that was live before the logout.
  const preLogout = deviceOne.snapshot();
  const loggedOut = await deviceOne.post('/v1/auth/logout');
  check('D-2 logout succeeds', loggedOut.status === 204, { status: loggedOut.status });

  const replay = new Client(A, 'replay');
  replay.restore(preLogout);
  const afterLogout = await replay.get(PROTECTED, { absorb: false });
  check(
    'D-2 the SAME access token returns 401 immediately after logout',
    afterLogout.status === 401,
    { status: afterLogout.status, code: afterLogout.code },
  );

  const other = await deviceTwo.get(PROTECTED);
  check(
    'D-2 a second independent session is UNAFFECTED by single-session logout',
    other.status === 200,
    { status: other.status },
  );

  // ── logout-all ─────────────────────────────────────────────────────────────
  const deviceThree = await loginExisting(A, email, 'device-3');
  const preAll2 = deviceTwo.snapshot();
  const preAll3 = deviceThree.snapshot();

  const all = await deviceThree.post('/v1/auth/logout-all');
  check('D-2 logout-all succeeds', all.status === 204, { status: all.status });

  for (const [label, snap] of [
    ['session 2', preAll2],
    ['session 3', preAll3],
  ]) {
    const probe = new Client(A, `all-${label}`);
    probe.restore(snap);
    const res = await probe.get(PROTECTED, { absorb: false });
    check(`D-2 ${label} returns 401 after logout-all`, res.status === 401, {
      status: res.status,
      code: res.code,
    });
  }

  // ── cross-instance ─────────────────────────────────────────────────────────
  // A token revoked by instance A must be dead on instance B too.
  const { email: xEmail, client: xClient } = await signUpAndLogin(A, 'd2-cross', 'cross');
  const preCross = xClient.snapshot();
  const onB = new Client(B, 'cross-b');
  onB.restore(preCross);
  check(
    'D-2 the token is accepted by instance B before revocation',
    (await onB.get(PROTECTED, { absorb: false })).status === 200,
    {},
  );
  await xClient.post('/v1/auth/logout');
  const afterOnB = await onB.get(PROTECTED, { absorb: false });
  check(
    'D-2 a logout served by instance A is enforced by instance B on the next request',
    afterOnB.status === 401,
    { status: afterOnB.status, code: afterOnB.code },
  );
  void xEmail;

  // ── password reset ─────────────────────────────────────────────────────────
  const { email: rEmail, client: rClient } = await signUpAndLogin(A, 'd2-reset', 'reset');
  const rSecond = await loginExisting(A, rEmail, 'reset-2');
  const preReset1 = rClient.snapshot();
  const preReset2 = rSecond.snapshot();

  const anonymous = new Client(A, 'anon');
  const forgot = await anonymous.post('/v1/auth/forgot-password', { email: rEmail });
  check('D-2 forgot-password is accepted', forgot.status === 202, { status: forgot.status });

  const resetToken = await latestMailFor(rEmail, resetTokenFrom);
  const reset = await anonymous.post('/v1/auth/reset-password', {
    token: resetToken,
    newPassword: `${PASSWORD}-rotated`,
  });
  check('D-2 password reset succeeds', reset.status === 200, { status: reset.status });

  for (const [label, snap] of [
    ['session 1', preReset1],
    ['session 2', preReset2],
  ]) {
    const probe = new Client(A, `reset-${label}`);
    probe.restore(snap);
    const res = await probe.get(PROTECTED, { absorb: false });
    check(
      `D-2 pre-reset ${label} access token returns 401 immediately after password reset`,
      res.status === 401,
      { status: res.status, code: res.code },
    );
    // The refresh token issued with it must be dead too.
    const refreshed = await probe.post('/v1/auth/refresh', undefined, { absorb: false });
    check(
      `D-2 pre-reset ${label} refresh token is rejected after password reset`,
      refreshed.status === 401,
      { status: refreshed.status, code: refreshed.code },
    );
  }

  // ── refresh rotation invalidates the replaced token ────────────────────────
  const { client: rotClient } = await signUpAndLogin(A, 'd2-rotate', 'rotate');
  const preRotate = rotClient.snapshot();
  const rotated = await rotClient.post('/v1/auth/refresh');
  check('D-2 refresh rotation succeeds', rotated.status === 200, { status: rotated.status });

  const stale = new Client(A, 'stale-after-rotate');
  stale.restore(preRotate);
  const staleRes = await stale.get(PROTECTED, { absorb: false });
  check('D-2 the access token replaced by refresh rotation is rejected', staleRes.status === 401, {
    status: staleRes.status,
    code: staleRes.code,
  });
  check('D-2 the rotated session still works', (await rotClient.get(PROTECTED)).status === 200, {});
}

// ─── D-4 ─────────────────────────────────────────────────────────────────────

async function d4RealtimeAuthorization(h, admin) {
  const {
    check,
    section,
    signUpAndLogin,
    loginExisting,
    openSocket,
    awaitDisconnect,
    Client,
    A,
    B,
  } = h;
  section('D-4 — realtime authorization and immediate disconnection');

  // ── a healthy session connects and joins only its own rooms ────────────────
  const { email, client } = await signUpAndLogin(A, 'd4-basic', 'ws-basic');
  const ok = await openSocket(A, client);
  check('D-4 a live session completes the handshake', ok.result === 'accepted', {
    result: ok.result,
  });
  check(
    'D-4 a plain customer joins ONLY its user and session rooms (no admin, no provider)',
    ok.result === 'accepted' &&
      ok.rooms.some((r) => r.startsWith('user:')) &&
      ok.rooms.some((r) => r.startsWith('session:')) &&
      !ok.rooms.includes('admin') &&
      !ok.rooms.some((r) => r.startsWith('provider:')),
    { rooms: ok.rooms },
  );

  // ── revoked session cannot open a NEW socket ──────────────────────────────
  const preLogout = client.snapshot();
  await client.post('/v1/auth/logout');
  const replay = new Client(A, 'ws-replay');
  replay.restore(preLogout);
  const rejected = await openSocket(A, replay);
  check(
    'D-4 a REVOKED session is rejected at the WebSocket handshake',
    rejected.result === 'rejected' && rejected.code === 'AUTH_INVALID_CREDENTIALS',
    { result: rejected.result, code: rejected.code },
  );
  rejected.socket?.close();

  // ── an already-connected socket is torn down by logout ────────────────────
  const live = await loginExisting(A, email, 'ws-live');
  const connected = await openSocket(A, live);
  check('D-4 socket connected before revocation', connected.result === 'accepted', {
    result: connected.result,
  });
  await live.post('/v1/auth/logout');
  check(
    'D-4 an already-connected socket is disconnected after logout',
    await awaitDisconnect(connected.socket),
    {},
  );

  // ── cross-instance eviction ────────────────────────────────────────────────
  // Socket held by instance B; the logout is served by instance A. Only the
  // Redis adapter can carry the eviction across.
  const { email: xEmail, client: xClient } = await signUpAndLogin(A, 'd4-cross', 'ws-cross');
  const onB = await openSocket(B, xClient);
  check('D-4 socket connected to instance B', onB.result === 'accepted', { result: onB.result });
  const onA = new Client(A, 'ws-cross-a');
  onA.restore(xClient.snapshot());
  await onA.post('/v1/auth/logout-all');
  check(
    'D-4 a logout served by instance A disconnects the socket held by instance B',
    await awaitDisconnect(onB.socket),
    {},
  );
  void xEmail;

  // ── globally suspended account ─────────────────────────────────────────────
  const { email: sEmail, client: sClient } = await signUpAndLogin(A, 'd4-susp', 'ws-susp');
  const sSocket = await openSocket(A, sClient);
  check('D-4 socket connected before suspension', sSocket.result === 'accepted', {
    result: sSocket.result,
  });

  const targetId = (await sClient.get(PROTECTED)).body?.id;
  const preSuspend = sClient.snapshot();
  const suspended = await admin.client.patch(`/v1/admin/users/${targetId}/status`, {
    status: 'SUSPENDED',
    reason: 'harness proof',
  });
  check('D-4 admin suspension succeeds', suspended.status === 200, { status: suspended.status });

  check(
    'D-4 an already-connected socket is disconnected after global suspension',
    await awaitDisconnect(sSocket.socket),
    {},
  );

  const suspendedReplay = new Client(A, 'ws-susp-replay');
  suspendedReplay.restore(preSuspend);
  const suspendedHandshake = await openSocket(A, suspendedReplay);
  check(
    'D-4 a globally suspended account is rejected at the WebSocket handshake',
    suspendedHandshake.result === 'rejected',
    { result: suspendedHandshake.result, code: suspendedHandshake.code },
  );
  suspendedHandshake.socket?.close();

  check(
    'D-2 every token of a suspended account returns 401 (REST)',
    (await suspendedReplay.get(PROTECTED, { absorb: false })).status === 401,
    {},
  );
  void sEmail;

  // ── an admin joins the admin room; a customer never does ──────────────────
  const adminSocket = await openSocket(A, admin.client);
  check(
    'D-4 a current admin joins the admin room',
    adminSocket.result === 'accepted' && adminSocket.rooms.includes('admin'),
    { rooms: adminSocket.rooms },
  );
  adminSocket.socket?.close();
}

// ─── Admin access lifecycle ──────────────────────────────────────────────────

async function adminAccessLifecycle(h, admin) {
  const { check, section, signUpAndLogin, loginExisting, A } = h;
  section('Admin — access-request lifecycle and endpoint authorization');

  const { email, client } = await signUpAndLogin(A, 'admin-req', 'applicant');

  // ── a signup grants nothing ───────────────────────────────────────────────
  const mine = await client.get('/v1/me/admin-access');
  check(
    'Admin: a fresh signup has NO admin role, whatever the account status',
    mine.status === 200 && mine.body.hasAdminRole === false,
    { status: mine.status, hasAdminRole: mine.body?.hasAdminRole },
  );

  const me = await client.get(PROTECTED);
  check(
    'Admin: the account is ACTIVE yet still not an admin (the two axes are separate)',
    me.body?.status === 'ACTIVE' && !(me.body?.roles ?? []).includes('admin'),
    { accountStatus: me.body?.status, roles: me.body?.roles },
  );

  // ── customer/provider are refused by every admin endpoint ─────────────────
  for (const [name, call] of [
    ['GET /v1/admin/users', () => client.get('/v1/admin/users')],
    ['GET /v1/admin/access-requests', () => client.get('/v1/admin/access-requests')],
    ['GET /v1/admin/providers', () => client.get('/v1/admin/providers')],
  ]) {
    const res = await call();
    check(`Admin: a non-admin receives 403 from ${name}`, res.status === 403, {
      status: res.status,
      code: res.code,
    });
  }

  // ── a client cannot inject its way to the role ────────────────────────────
  for (const payload of [
    { justification: 'ok', role: 'admin' },
    { justification: 'ok', roles: ['admin'] },
    { justification: 'ok', status: 'APPROVED' },
    { justification: 'ok', userId: 'someone-else' },
    { justification: 'ok', hasAdminRole: true },
  ]) {
    const res = await client.post('/v1/me/admin-access', payload);
    check(
      `Admin: submitting with an injected field (${Object.keys(payload).filter((k) => k !== 'justification')[0]}) is rejected`,
      res.status === 400,
      { status: res.status, code: res.code },
    );
  }

  // ── submit → still nothing granted ────────────────────────────────────────
  const submitted = await client.post('/v1/me/admin-access', {
    justification: 'Harness proof of the access-request lifecycle.',
  });
  check('Admin: submitting a request is accepted', submitted.status === 202, {
    status: submitted.status,
  });
  check('Admin: the submitted request is PENDING', submitted.body?.status === 'PENDING', {
    status: submitted.body?.status,
  });

  const afterSubmit = await client.get('/v1/me/admin-access');
  check(
    'Admin: a PENDING request still grants NO admin role',
    afterSubmit.body?.hasAdminRole === false && afterSubmit.body?.isPending === true,
    { hasAdminRole: afterSubmit.body?.hasAdminRole, isPending: afterSubmit.body?.isPending },
  );
  check(
    'Admin: a pending applicant is STILL refused by admin endpoints',
    (await client.get('/v1/admin/users')).status === 403,
    {},
  );

  const duplicate = await client.post('/v1/me/admin-access', { justification: 'again' });
  check('Admin: a second request while one is pending is refused', duplicate.status === 409, {
    status: duplicate.status,
  });

  // ── the request appears in the reviewer queue with all three axes ─────────
  const queue = await admin.client.get('/v1/admin/access-requests?status=PENDING');
  const item = (queue.body?.items ?? []).find((i) => i.applicant?.email === email);
  check('Admin: the request is visible in the reviewer queue', Boolean(item), {
    status: queue.status,
    found: Boolean(item),
  });
  check(
    'Admin: the review item carries account status, roles, and request status separately',
    Boolean(item) &&
      item.applicant.accountStatus === 'ACTIVE' &&
      Array.isArray(item.applicant.roles) &&
      !item.applicant.roles.includes('admin') &&
      item.status === 'PENDING',
    {
      accountStatus: item?.applicant?.accountStatus,
      roles: item?.applicant?.roles,
      requestStatus: item?.status,
    },
  );

  // ── no self-review ────────────────────────────────────────────────────────
  const selfRequest = await admin.client.post('/v1/me/admin-access', { justification: 'self' });
  check(
    'Admin: an existing admin cannot request access again (already granted)',
    selfRequest.status === 409,
    { status: selfRequest.status },
  );

  // ── approval grants the role ──────────────────────────────────────────────
  const approved = await admin.client.post(`/v1/admin/access-requests/${item.id}/approve`, {
    decisionNote: 'harness proof',
  });
  check('Admin: approval succeeds', approved.status === 200, { status: approved.status });
  check('Admin: the request is now APPROVED', approved.body?.request?.status === 'APPROVED', {
    status: approved.body?.request?.status,
  });

  // The applicant's sessions were revoked by the grant — proof that a role
  // change is authoritative rather than eventual.
  const staleAfterGrant = await client.get(PROTECTED, { absorb: false });
  check(
    'Admin: the applicant existing session is revoked by the grant (role change forces re-auth)',
    staleAfterGrant.status === 401,
    { status: staleAfterGrant.status, code: staleAfterGrant.code },
  );

  const reauthed = await loginExisting(A, email, 'new-admin');
  const nowAdmin = await reauthed.get('/v1/me/admin-access');
  check(
    'Admin: after re-authentication the applicant HAS the admin role',
    nowAdmin.body?.hasAdminRole === true,
    { hasAdminRole: nowAdmin.body?.hasAdminRole },
  );
  check(
    'Admin: the newly-approved admin can now reach an admin endpoint',
    (await reauthed.get('/v1/admin/users')).status === 200,
    {},
  );

  // ── approval grants ONLY admin — no provider profile appears ─────────────
  const providerProbe = await reauthed.get('/v1/me/provider/profile');
  check(
    'Admin: approval did NOT create an ACTIVE ProviderProfile (403/404, never 200)',
    providerProbe.status === 403 || providerProbe.status === 404,
    { status: providerProbe.status },
  );

  // ── rejection path ────────────────────────────────────────────────────────
  const { email: rejEmail, client: rejClient } = await signUpAndLogin(A, 'admin-rej', 'rejected');
  await rejClient.post('/v1/me/admin-access', { justification: 'please' });
  const rejQueue = await admin.client.get('/v1/admin/access-requests?status=PENDING');
  const rejItem = (rejQueue.body?.items ?? []).find((i) => i.applicant?.email === rejEmail);
  const rejected = await admin.client.post(`/v1/admin/access-requests/${rejItem.id}/reject`, {
    decisionNote: 'not this cycle',
  });
  check('Admin: rejection succeeds', rejected.status === 200, { status: rejected.status });
  const afterReject = await rejClient.get('/v1/me/admin-access');
  check(
    'Admin: a REJECTED applicant keeps an ordinary working session and no admin role',
    afterReject.status === 200 &&
      afterReject.body?.hasAdminRole === false &&
      afterReject.body?.latestRequest?.status === 'REJECTED',
    {
      status: afterReject.status,
      hasAdminRole: afterReject.body?.hasAdminRole,
      requestStatus: afterReject.body?.latestRequest?.status,
    },
  );
  check(
    'Admin: the rejection reason is surfaced to the applicant, not a generic account error',
    afterReject.body?.latestRequest?.decisionNote === 'not this cycle',
    { decisionNote: afterReject.body?.latestRequest?.decisionNote },
  );
}

// ─── Provider lifecycle ──────────────────────────────────────────────────────

async function providerLifecycle(h, admin) {
  const { check, section, signUpAndLogin, loginExisting, openSocket, awaitDisconnect, A } = h;
  section('Provider — DRAFT → submit → PENDING_REVIEW → ACTIVE');

  const { email, client } = await signUpAndLogin(A, 'provider', 'provider');

  // ── upgrade creates DRAFT ─────────────────────────────────────────────────
  const upgraded = await client.post('/v1/me/provider/upgrade', {});
  check('Provider: upgrade succeeds', upgraded.status === 200, { status: upgraded.status });
  check(
    'Provider: upgrade creates a DRAFT profile (NOT auto-active, NOT auto-submitted)',
    upgraded.body?.profile?.status === 'DRAFT' &&
      upgraded.body?.profile?.submittedForReviewAt == null,
    {
      status: upgraded.body?.profile?.status,
      submittedForReviewAt: upgraded.body?.profile?.submittedForReviewAt,
    },
  );

  const again = await client.post('/v1/me/provider/upgrade', {});
  check(
    'Provider: upgrade is idempotent',
    again.status === 200 && again.body?.profile?.id === upgraded.body?.profile?.id,
    { status: again.status },
  );

  // The upgraded session still carries the pre-upgrade role claim, so the
  // provider re-authenticates to pick up the new role.
  const provider = await loginExisting(A, email, 'provider-2');

  // ── incomplete submission → 422 with machine-readable codes ──────────────
  const incomplete = await provider.post('/v1/me/provider/submit-for-review', {});
  check('Provider: an incomplete application is refused with 422', incomplete.status === 422, {
    status: incomplete.status,
    code: incomplete.code,
  });
  const missing = incomplete.body?.error?.details?.missing ?? [];
  check(
    'Provider: the 422 carries machine-readable missing-field codes',
    Array.isArray(missing) &&
      missing.length > 0 &&
      missing.every((m) => typeof m.field === 'string' && typeof m.code === 'string'),
    { missing },
  );

  // ── marketplace endpoints are closed to a DRAFT provider ─────────────────
  for (const [name, p] of [
    ['available-requests', '/v1/provider/available-requests'],
    ['my bids', '/v1/provider/bids'],
    ['bookings', '/v1/provider/bookings'],
  ]) {
    const res = await provider.get(p);
    check(`Provider: a DRAFT provider receives 403 from ${name}`, res.status === 403, {
      status: res.status,
      code: res.code,
    });
  }

  // ── complete the profile, then submit ─────────────────────────────────────
  const categories = await provider.get('/v1/services');
  const categoryId = (categories.body?.items ?? categories.body ?? [])[0]?.id;
  check('Provider: the service catalogue is readable', Boolean(categoryId), {
    status: categories.status,
    haveCategory: Boolean(categoryId),
  });
  const patched = await provider.patch('/v1/me/provider/profile', {
    displayName: 'Harness Electrical Services',
    headline: 'Certified electrician with ten years of experience',
    bio: 'Residential and light commercial electrical work, including rewiring, fault finding, and fixture installation.',
    phoneNumber: '+46701234567',
    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    serviceAreaRadiusKm: 25,
    ...(categoryId ? { categoryIds: [categoryId] } : {}),
  });
  check('Provider: the DRAFT profile is editable', patched.status === 200, {
    status: patched.status,
  });

  const onboarding = await provider.get('/v1/me/provider/onboarding');
  check(
    'Provider: the server reports the application as complete',
    onboarding.body?.complete === true,
    { complete: onboarding.body?.complete, missing: onboarding.body?.missing },
  );

  const submitted = await provider.post('/v1/me/provider/submit-for-review', {});
  check(
    'Provider: a complete submission moves the profile to PENDING_REVIEW',
    submitted.status === 200 && submitted.body?.profile?.status === 'PENDING_REVIEW',
    { status: submitted.status, profileStatus: submitted.body?.profile?.status },
  );
  check(
    'Provider: submission stamps submittedForReviewAt',
    Boolean(submitted.body?.profile?.submittedForReviewAt),
    { submittedForReviewAt: submitted.body?.profile?.submittedForReviewAt },
  );

  // ── a queued application is locked ────────────────────────────────────────
  const lockedEdit = await provider.patch('/v1/me/provider/profile', { headline: 'changed' });
  check(
    'Provider: editing a queued application is refused (the reviewer sees a stable snapshot)',
    lockedEdit.status === 409,
    { status: lockedEdit.status, code: lockedEdit.code },
  );

  // ── still no marketplace access while pending ────────────────────────────
  check(
    'Provider: a PENDING_REVIEW provider is still refused by marketplace endpoints',
    (await provider.get('/v1/provider/available-requests')).status === 403,
    {},
  );
  check(
    'Provider: a PENDING_REVIEW provider can still sign in and read their own status',
    (await provider.get('/v1/me/provider/profile')).status === 200,
    {},
  );

  // ── a pending provider never joins the marketplace room ──────────────────
  const pendingSocket = await openSocket(A, provider);
  check(
    'D-4 a PENDING_REVIEW provider connects but does NOT join the provider room',
    pendingSocket.result === 'accepted' &&
      !pendingSocket.rooms.some((r) => r.startsWith('provider:')),
    { rooms: pendingSocket.rooms },
  );
  pendingSocket.socket?.close();

  // ── withdraw → back to DRAFT and editable ────────────────────────────────
  const withdrawn = await provider.post('/v1/me/provider/withdraw-review', {});
  check(
    'Provider: withdrawing a queued application returns it to DRAFT',
    withdrawn.status === 200 && withdrawn.body?.profile?.status === 'DRAFT',
    { status: withdrawn.status, profileStatus: withdrawn.body?.profile?.status },
  );
  check(
    'Provider: the withdrawn application is editable again',
    (
      await provider.patch('/v1/me/provider/profile', {
        headline: 'Certified electrician, updated',
      })
    ).status === 200,
    {},
  );
  await provider.post('/v1/me/provider/submit-for-review', {});

  // ── admin approval → ACTIVE ──────────────────────────────────────────────
  const queue = await admin.client.get('/v1/admin/providers?status=PENDING_REVIEW');
  const pending = (queue.body?.items ?? []).find((p) => p.email === email);
  check('Provider: the submitted application appears in the admin queue', Boolean(pending), {
    found: Boolean(pending),
  });

  const approved = await admin.client.post(`/v1/admin/providers/${pending.id}/approve`, {
    note: 'harness proof',
  });
  check('Provider: admin approval succeeds', approved.status === 200, { status: approved.status });

  const activeProfile = await provider.get('/v1/me/provider/profile');
  check('Provider: the profile is now ACTIVE', activeProfile.body?.profile?.status === 'ACTIVE', {
    profileStatus: activeProfile.body?.profile?.status,
  });
  check(
    'Provider: an ACTIVE provider reaches the marketplace feed',
    (await provider.get('/v1/provider/available-requests')).status === 200,
    {},
  );

  const activeSocket = await openSocket(A, provider);
  check(
    'D-4 an ACTIVE provider joins the provider marketplace room',
    activeSocket.result === 'accepted' && activeSocket.rooms.some((r) => r.startsWith('provider:')),
    { rooms: activeSocket.rooms },
  );

  // ── suspension withdraws marketplace access WITHOUT ending the session ───
  const suspended = await admin.client.post(`/v1/admin/providers/${pending.id}/suspend`, {
    reason: 'harness proof',
  });
  check('Provider: admin suspension succeeds', suspended.status === 200, {
    status: suspended.status,
  });

  check(
    'Provider: a SUSPENDED provider is refused by marketplace endpoints',
    (await provider.get('/v1/provider/available-requests')).status === 403,
    {},
  );
  const stillSignedIn = await provider.get(PROTECTED);
  check(
    'Provider: provider suspension does NOT suspend the user identity (Customer access survives)',
    stillSignedIn.status === 200,
    { status: stillSignedIn.status },
  );
  check(
    'Provider: a suspended provider can still read their own status surface',
    (await provider.get('/v1/me/provider/profile')).status === 200,
    {},
  );
  // The socket is EVICTED from the provider room, not disconnected — losing
  // marketplace approval must not log the person out of their Customer persona.
  const stillConnected = !(await awaitDisconnect(activeSocket.socket, 3000));
  check(
    'D-4 provider suspension evicts the marketplace room WITHOUT disconnecting the session',
    stillConnected,
    { socketStillConnected: stillConnected },
  );
  activeSocket.socket?.close();

  // ── rejection surfaces a reason ──────────────────────────────────────────
  const rejected = await admin.client.post(`/v1/admin/providers/${pending.id}/reject`, {
    reason: 'Service area outside current coverage.',
  });
  check('Provider: admin rejection succeeds', rejected.status === 200, {
    status: rejected.status,
  });
  const rejectedOnboarding = await provider.get('/v1/me/provider/onboarding');
  check(
    'Provider: a REJECTED provider is told WHY, not shown a generic account error',
    rejectedOnboarding.body?.rejectionReason === 'Service area outside current coverage.',
    { rejectionReason: rejectedOnboarding.body?.rejectionReason },
  );
}

// ─── Customer lifecycle ──────────────────────────────────────────────────────

async function customerLifecycle(h) {
  const { check, section, signUpAndLogin, A } = h;
  section('Customer — capabilities and boundaries');

  const { client } = await signUpAndLogin(A, 'customer', 'customer');

  const me = await client.get(PROTECTED);
  check('Customer: /auth/me works', me.status === 200, { status: me.status });
  check(
    'Customer: /auth/me leaks no credential material',
    !('passwordHash' in (me.body ?? {})) && !('mfaSecret' in (me.body ?? {})),
    { keys: Object.keys(me.body ?? {}) },
  );

  check(
    'Customer: can read their own profile',
    (await client.get('/v1/me/profile')).status === 200,
    {},
  );
  const address = await client.post('/v1/me/addresses', {
    label: 'Home',
    type: 'HOME',
    line1: '1 Harness Street',
    city: 'Gothenburg',
    country: 'Sweden',
  });
  check('Customer: can create an address', address.status === 201 || address.status === 200, {
    status: address.status,
  });

  for (const [name, p] of [
    ['admin users', '/v1/admin/users'],
    ['admin providers', '/v1/admin/providers'],
    ['admin access-requests', '/v1/admin/access-requests'],
  ]) {
    check(`Customer: receives 403 from ${name}`, (await client.get(p)).status === 403, {});
  }

  for (const [name, p] of [
    ['provider feed', '/v1/provider/available-requests'],
    ['provider bids', '/v1/provider/bids'],
    ['provider profile', '/v1/me/provider/profile'],
  ]) {
    const res = await client.get(p);
    check(`Customer: receives 403 from ${name} before any provider upgrade`, res.status === 403, {
      status: res.status,
    });
  }

  // ── registration cannot inject privilege ─────────────────────────────────
  // (The throttle budget is exhausted by now, so these are asserted on the
  // ValidationPipe's 400 which fires BEFORE the handler and its limiter.)
  for (const field of ['role', 'roles', 'status', 'isAdmin', 'userId', 'permissions']) {
    const payload = {
      email: `inject-${field}-${h.RUN}@harness.local`,
      password: h.PASSWORD,
      firstName: 'Inject',
      lastName: 'Probe',
      [field]: field === 'roles' || field === 'permissions' ? ['admin'] : 'admin',
    };
    const res = await client.post('/v1/auth/register', payload, { absorb: false });
    check(`Customer: registration rejects an injected "${field}" field`, res.status === 400, {
      status: res.status,
      code: res.code,
    });
  }
}

// ─── IDOR ────────────────────────────────────────────────────────────────────

async function idor(h) {
  const { check, section, signUpAndLogin, A } = h;
  section('IDOR — cross-user resource access');

  const { client: victim } = await signUpAndLogin(A, 'idor-victim', 'victim');
  const { client: attacker } = await signUpAndLogin(A, 'idor-attacker', 'attacker');

  const created = await victim.post('/v1/me/addresses', {
    label: 'Victim Home',
    type: 'HOME',
    line1: '99 Private Road',
    city: 'Gothenburg',
    country: 'Sweden',
  });
  const addressId = created.body?.id ?? created.body?.address?.id;
  check('IDOR: the victim address was created', Boolean(addressId), {
    status: created.status,
    hasId: Boolean(addressId),
  });

  const read = await attacker.get(`/v1/me/addresses/${addressId}`);
  check(
    'IDOR: another user cannot READ the address by id',
    read.status === 403 || read.status === 404,
    { status: read.status, code: read.code },
  );

  const write = await attacker.patch(`/v1/me/addresses/${addressId}`, { label: 'Owned' });
  check(
    'IDOR: another user cannot MUTATE the address by id',
    write.status === 403 || write.status === 404,
    { status: write.status, code: write.code },
  );

  const list = await attacker.get('/v1/me/addresses');
  const leaked = (list.body?.items ?? list.body ?? []).some((a) => a.id === addressId);
  check('IDOR: the address does not appear in another user list', !leaked, { leaked });

  const victimId = (await victim.get(PROTECTED)).body?.id;
  const adminProbe = await attacker.get(`/v1/admin/users/${victimId}`);
  check('IDOR: a non-admin cannot read another user admin record', adminProbe.status === 403, {
    status: adminProbe.status,
  });
}

module.exports = { run };
