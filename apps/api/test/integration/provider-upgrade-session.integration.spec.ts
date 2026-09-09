/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this suite is skipped, and a
 * top-level import of AppModule would validate env and open pools on every
 * hermetic run. `any` on the Prisma/Nest handles for the same reason.
 */

export {};

import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import { fixtureEmailDomain } from '../support/db-isolation';

// Sprint 09B.29, repair A — the provider-upgrade authorization transition,
// proved against the REAL application.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// WHAT THIS SUITE IS FOR
//
// `POST /v1/me/provider/upgrade` writes the provider role to the database and
// returns the new DRAFT profile. It does not touch the caller's session, and
// `JwtStrategy.validate` reads roles FROM THE ACCESS TOKEN — deliberately. So
// for as long as the browser holds the token it was issued at login, every
// `/v1/me/provider/**` call is refused by `RolesGuard` with a 403, on a session
// that is in every other respect valid.
//
// 9B.28 added a rotation to the client's upgrade mutation. That fixes the happy
// path and nothing proves it, because no test had ever performed the transition
// against real guards. This suite is that proof, and it asserts the failure
// mode as well as the fix: step 3 REQUIRES the stale token to be refused, so a
// future change that "helpfully" made upgrade mint a new token would fail here
// rather than silently invalidate the reasoning behind the client-side repair.
//
// NOTHING IS MOCKED. Real AppModule, real JwtAuthGuard, real RolesGuard, real
// ProviderCapabilityGuard, real CsrfGuard, real cookies, real Postgres, real
// Redis, real session rotation. The only substitution is the mail transport,
// because an OTP is deliberately readable only by whoever received the mail.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Provider upgrade → session rotation → provider access (real Postgres / Redis)', () => {
  const EMAIL_DOMAIN = fixtureEmailDomain('upgrade-session');
  const addr = (local: string): string => `${local}@${EMAIL_DOMAIN}`;

  /** The person who upgrades. */
  const UPGRADER_EMAIL = addr('upgrader');
  /** A seeker who never upgrades — the control. Every "genuinely forbidden"
   *  assertion is made against this account, so a bug that accidentally grants
   *  the provider role to everyone cannot pass by being asserted only on
   *  somebody who legitimately has it. */
  const CONTROL_EMAIL = addr('control');
  const PASSWORD = 'Upgrade!Passw0rd';

  let app: INestApplication;
  let http: any;
  let prisma: any;
  let mail: any;

  const savedEnv: Record<string, string | undefined> = {};

  const ENV: Record<string, string> = {
    NODE_ENV: 'test',
    // Low-entropy and self-describing on purpose: a random-looking literal in
    // a spec file is indistinguishable from a leaked key to a secret scanner.
    JWT_ACCESS_SECRET: 'test-only-not-a-secret-not-a-secret-value',
    // Production setting. The OTP round trip is how a real session is created,
    // and this suite is about what that session can and cannot reach.
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
    // Off: this suite asserts on ROLE authorization, and the work-access and
    // verification gates would refuse the provider routes for a second,
    // unrelated reason — which would make a role regression invisible here.
    WORK_ACCESS_ENFORCED: 'false',
    VERIFICATION_ENFORCED: 'false',
    OUTBOX_WORKER_ENABLED: 'false',
    VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
    MONGODB_ENABLED: 'false',
    REALTIME_SOCKET_IO: 'false',
  };

  // ── session handling ──────────────────────────────────────────────────────
  // Real cookies, real CSRF double-submit, exactly as a browser client does.

  interface Session {
    cookies: string[];
    csrf: string;
    userId: string;
  }

  function parseCookies(res: request.Response): string[] {
    const raw = res.headers['set-cookie'];
    if (!raw) return [];
    return (Array.isArray(raw) ? raw : [raw]).map((c: string) => c.split(';')[0]);
  }

  function csrfFrom(cookies: string[]): string {
    const found = cookies.find((c) => c.startsWith('hsm_csrf='));
    if (!found) throw new Error('no CSRF cookie was issued');
    return decodeURIComponent(found.slice('hsm_csrf='.length));
  }

  function as(session: Session, req: request.Test): request.Test {
    return req
      .set('Cookie', session.cookies.join('; '))
      .set('X-CSRF-Token', session.csrf)
      .set('X-Client-Kind', 'web');
  }

  function latestOtp(email: string): string {
    const messages = (mail.outbox as Array<{ to: string; text?: string; html?: string }>).filter(
      (m) => m.to === email,
    );
    const last = messages[messages.length - 1];
    if (!last) throw new Error(`no mail was sent to ${email}`);
    const code = /\b(\d{6})\b/.exec(`${last.text ?? ''} ${last.html ?? ''}`);
    if (!code) throw new Error(`no 6-digit code in the mail to ${email}`);
    return code[1];
  }

  async function registerAndSignIn(email: string): Promise<Session> {
    // Clear THIS suite's registration budget immediately before each sign-up.
    //
    // The throttle is real, Redis-backed, and keyed by IP as well as by email.
    // Every account here arrives from loopback, so six registrations in one run
    // exhaust the per-IP allowance and the sixth answers 429 — a failure about
    // the harness rather than about anything under test.
    //
    // Cleared per registration rather than once in `beforeAll` for exactly that
    // reason. The keys touched are this suite's own: loopback, and the address
    // about to be registered. registration-throttle.integration.spec.ts uses
    // synthetic 198.51.100.x identities, so nothing here can mask a real
    // throttle regression.
    await clearRegistrationBudget(email);

    const registered = await request(http)
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Sam', lastName: 'Seeker' })
      .expect(202);

    const verified = await request(http)
      .post('/v1/auth/verify-otp')
      .set('X-Client-Kind', 'web')
      .send({ challengeId: registered.body.challengeId, code: latestOtp(email) })
      .expect(200);

    const cookies = parseCookies(verified);
    const user = await prisma.user.findUnique({ where: { email } });
    return { cookies, csrf: csrfFrom(cookies), userId: user.id };
  }

  /** Rotate through the REAL refresh endpoint. This is the operation the whole
   *  repair depends on: `AuthenticationService.refresh` re-reads role rows from
   *  the database before minting, so the new token carries `provider` because
   *  the SERVER looked it up — not because the client asked for it. */
  async function refresh(session: Session): Promise<Session> {
    const rotated = await as(session, request(http).post('/v1/auth/refresh')).send({}).expect(200);
    const cookies = parseCookies(rotated);
    return {
      userId: session.userId,
      cookies: cookies.length > 0 ? cookies : session.cookies,
      csrf: cookies.length > 0 ? csrfFrom(cookies) : session.csrf,
    };
  }

  /** Clear the registration budget for loopback plus one address. */
  async function clearRegistrationBudget(email?: string): Promise<void> {
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    const redis = app.get(RedisService).getClient();
    const identities = ['127.0.0.1', '::1', '::ffff:127.0.0.1', ...(email ? [email] : [])];
    const keys = identities.flatMap((id) => [
      `rl:auth:register:ip:${id}`,
      `rl:auth:register:ip:${id}:blocked`,
      `rl:auth:register:email:${id}`,
      `rl:auth:register:email:${id}:blocked`,
    ]);
    await redis.del(...keys);
  }

  /** Remove only what THIS suite created, scoped by its own email domain, in
   *  FK order. The IAM foreign keys are RESTRICT, not CASCADE. */
  async function cleanupFixtures(): Promise<void> {
    const mine = await prisma.user.findMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    if (mine.length === 0) return;
    const ids = mine.map((u: { id: string }) => u.id);
    const userId = { in: ids };

    const profiles = await prisma.providerProfile.findMany({
      where: { userId },
      select: { id: true },
    });
    const providerProfileId = { in: profiles.map((p: { id: string }) => p.id) };

    await prisma.providerOnboardingDraft.deleteMany({ where: { providerProfileId } });
    await prisma.providerOnboardingSubmission.deleteMany({ where: { providerProfileId } });
    await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId } });
    await prisma.providerProfileServiceCategory.deleteMany({ where: { providerProfileId } });
    await prisma.providerProfile.deleteMany({ where: { userId } });
    await prisma.auditEvent.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.verificationToken.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    // Forced rather than defaulted: a developer with SMTP_HOST in their shell
    // would otherwise mail the OTP to Mailpit, where no assertion can read it.
    savedEnv.SMTP_HOST = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { AppModule } = require('../../src/app.module') as typeof import('../../src/app.module');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');
    const { MAIL_PORT } = require('../../src/infrastructure/mail/mail.port');
    mail = new InMemoryMailAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PORT)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();

    // The same bootstrap main.ts performs, in the same order. Without
    // cookieParser the session cookie is never parsed and every authenticated
    // step answers 401 — a property of the harness, not the application.
    const cookieParser = require('cookie-parser');
    const express = require('express');
    app.use(cookieParser());
    app.use(express.json({ limit: '1mb' }));
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    await app.init();
    http = app.getHttpServer();

    await clearRegistrationBudget();
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('refuses provider routes to an authenticated non-provider with 403, not 401', async () => {
    // The distinction the whole repair rests on, asserted at the SERVER
    // boundary so the client's 401/403 split is answering a real difference
    // rather than one the frontend invented.
    const control = await registerAndSignIn(CONTROL_EMAIL);

    await as(control, request(http).get('/v1/me/provider/profile')).expect(403);
    await as(control, request(http).get('/v1/me/provider/onboarding/hub')).expect(403);

    // And an anonymous caller gets 401 on the same routes. Two different
    // answers to two different questions.
    await request(http).get('/v1/me/provider/profile').expect(401);
    await request(http).get('/v1/me/provider/onboarding/hub').expect(401);
  });

  it('rotating a genuine non-provider session does NOT escalate it', async () => {
    // The loop guard, proved from the server side: if a refresh could turn a
    // 403 into a 200 for someone who never upgraded, then retrying every 403
    // after a refresh would be a privilege-escalation path — and capping the
    // client at one attempt would be papering over it.
    //
    // It cannot: `refresh` re-reads role rows, and this account has none.
    let control = await registerAndSignIn(addr('control-rotate'));
    await as(control, request(http).get('/v1/me/provider/onboarding/hub')).expect(403);

    control = await refresh(control);

    const me = await as(control, request(http).get('/v1/auth/me')).expect(200);
    expect(me.body.roles).not.toContain('provider');
    await as(control, request(http).get('/v1/me/provider/onboarding/hub')).expect(403);
  });

  it('completes upgrade → stale-token 403 → rotation → provider access', async () => {
    // ── 1-2. a valid seeker, and the pre-upgrade session captured ──────────
    const before = await registerAndSignIn(UPGRADER_EMAIL);

    const meBefore = await as(before, request(http).get('/v1/auth/me')).expect(200);
    expect(meBefore.body.roles).not.toContain('provider');
    expect(meBefore.body.id).toBe(before.userId);

    // ── 3. the real upgrade endpoint ───────────────────────────────────────
    const upgraded = await as(before, request(http).post('/v1/me/provider/upgrade'))
      .send({})
      .expect(200);

    // ── 4. the backend created the DRAFT profile for THIS user ─────────────
    expect(upgraded.body.profile).toBeDefined();
    const profileRow = await prisma.providerProfile.findUnique({
      where: { userId: before.userId },
    });
    expect(profileRow).not.toBeNull();
    expect(profileRow.status).toBe('DRAFT');

    // The role really is in the database now — which is precisely why the
    // next assertion is about the TOKEN rather than about authorization.
    const roleRows = await prisma.userRole.findMany({
      where: { userId: before.userId },
      include: { role: true },
    });
    expect(roleRows.map((r: any) => r.role.name)).toContain('provider');

    // ── 5. the pre-upgrade token is STILL forbidden ────────────────────────
    //
    // This is the defect, asserted as a requirement. The session is valid, the
    // database says provider, and the access token does not — so RolesGuard
    // refuses. A change that made upgrade mint a new token would break this
    // assertion, which is the point: it would also invalidate the reasoning
    // behind the client-side rotation, and that should not happen silently.
    await as(before, request(http).get('/v1/me/provider/onboarding/hub')).expect(403);
    await as(before, request(http).get('/v1/me/provider/profile')).expect(403);

    // ── 6. rotate through the real endpoint ────────────────────────────────
    const after = await refresh(before);

    // ── 7. the AUTHORITATIVE session now carries the role ──────────────────
    const meAfter = await as(after, request(http).get('/v1/auth/me')).expect(200);
    expect(meAfter.body.roles).toContain('provider');
    // Same person throughout. A rotation that returned a different identity
    // would be a far worse bug than the one under repair.
    expect(meAfter.body.id).toBe(before.userId);
    expect(meAfter.body.email).toBe(UPGRADER_EMAIL);

    // ── 8-10. profile and hub both answer 200, for the upgraded user ───────
    const profile = await as(after, request(http).get('/v1/me/provider/profile')).expect(200);
    expect(profile.body.profile.id).toBe(profileRow.id);

    const hub = await as(after, request(http).get('/v1/me/provider/onboarding/hub')).expect(200);
    // The six-task contract, from the server. Asserted by SHAPE rather than by
    // exact copy so this stays a test about authorization.
    expect(hub.body.tasks).toHaveLength(6);
    expect(hub.body.progress.total).toBe(6);
    expect(hub.body.status).toBe('DRAFT');

    // The draft endpoint too — it is the one every task screen hydrates from,
    // and it carries its own capability guard.
    const draft = await as(after, request(http).get('/v1/me/provider/onboarding/draft')).expect(
      200,
    );
    expect(draft.body.editable).toBe(true);
  });

  it('does not weaken the guards it just passed', async () => {
    // A 200 for the right person is only half the proof. The same routes must
    // still refuse everyone else, AFTER an upgrade has happened in this
    // database — a guard accidentally relaxed to fix the transition would show
    // up here and nowhere else in this suite.
    const stranger = await registerAndSignIn(addr('stranger'));

    await as(stranger, request(http).get('/v1/me/provider/profile')).expect(403);
    await as(stranger, request(http).get('/v1/me/provider/onboarding/hub')).expect(403);
    await as(stranger, request(http).get('/v1/me/provider/onboarding/draft')).expect(403);

    // Unauthenticated stays 401 on all three.
    await request(http).get('/v1/me/provider/profile').expect(401);
    await request(http).get('/v1/me/provider/onboarding/hub').expect(401);
    await request(http).get('/v1/me/provider/onboarding/draft').expect(401);

    // And a mutating provider route still demands CSRF even with a good
    // session — the upgrade path must not have loosened it.
    const victim = await registerAndSignIn(addr('csrf'));
    await request(http)
      .post('/v1/me/provider/upgrade')
      .set('Cookie', victim.cookies.join('; '))
      .set('X-Client-Kind', 'web')
      // No X-CSRF-Token header.
      .send({})
      .expect(403);
  });

  it('is idempotent: upgrading twice returns the same profile and one role row', async () => {
    // The client may legitimately re-run the upgrade after a failed rotation
    // (the button is still there). That must not produce a second profile or a
    // duplicate role assignment.
    let session = await registerAndSignIn(addr('twice'));

    const first = await as(session, request(http).post('/v1/me/provider/upgrade'))
      .send({})
      .expect(200);
    const second = await as(session, request(http).post('/v1/me/provider/upgrade'))
      .send({})
      .expect(200);

    expect(second.body.profile.id).toBe(first.body.profile.id);

    const profiles = await prisma.providerProfile.findMany({ where: { userId: session.userId } });
    expect(profiles).toHaveLength(1);

    const roles = await prisma.userRole.findMany({
      where: { userId: session.userId },
      include: { role: true },
    });
    expect(roles.filter((r: any) => r.role.name === 'provider')).toHaveLength(1);

    // And one rotation is still all it takes.
    session = await refresh(session);
    await as(session, request(http).get('/v1/me/provider/onboarding/hub')).expect(200);
  });
});
