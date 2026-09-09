/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this suite is skipped, and a
 * top-level import of AppModule would validate env and open pools on every
 * hermetic run. `any` on the Prisma/Nest handles for the same reason.
 */

export {};

import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import {
  acquireAdvisoryLock,
  fixtureEmailDomain,
  withAdvisoryLock,
  type HeldLock,
} from '../support/db-isolation';
import { clearAuthRateBudget } from '../support/rate-limit-reset';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real key
// to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase4-persistence-durability');

// Sprint 09B.29 Phase 4 — DURABILITY, against the real application.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// The Phase 4 invariant is not "the request succeeded". It is:
//
//   if the interface says Saved, the value is in the authoritative database
//   and a FRESH AUTHENTICATED SESSION can read it back.
//
// A 200, a React Query cache entry and a toast can all be true while the row
// is unchanged, so each field below is proved four times:
//
//   1. the PATCH response carries it        (the contract)
//   2. a fresh GET carries it               (the read model)
//   3. the Prisma row carries it            (the database)
//   4. a NEW SESSION's GET carries it       (nothing survived in memory)
//
// Step 4 is the one that cannot be faked by a cache, and it is why every task
// here signs out and signs back in rather than reusing the session.
//
// Also proved: `draftId`, the identity the browser's monotonic-version guard
// scopes itself to. Two providers must not share one, and their versions must
// be independent — a client comparing bare integers across them would show one
// provider the other's application.
//
// NOTHING IS MOCKED except the mail transport, because an OTP is deliberately
// readable only by whoever received the mail.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

d('Phase 4 — onboarding persistence is durable across sessions (real Postgres / Redis)', () => {
  const EMAIL_DOMAIN = fixtureEmailDomain('phase4-durability');
  const addr = (local: string): string => `${local}@${EMAIL_DOMAIN}`;

  // A category tree owned BY THIS SUITE, so the specialties task can be driven
  // through the real step endpoint without depending on seed data that another
  // sprint may re-key. Torn down in cleanupCategories.
  const CAT_ROOT = 'p4dur-root';
  const CAT_LEAF = 'p4dur-leaf';

  const PROVIDER_A = addr('durable-a');
  const PROVIDER_B = addr('durable-b');
  /** A THIRD provider, used only for the submission task.
   *
   *  Submitting locks the draft, and every other test in this file writes to a
   *  draft. Sharing PROVIDER_A would make the whole suite order-dependent — the
   *  concurrency tests below would start failing for the wrong reason, and a
   *  real regression in them would be invisible behind the lock. */
  const PROVIDER_C = addr('durable-c');
  const PASSWORD = 'Durable!Passw0rd';

  /**
   * The outbox queue, held SHARED for this suite's whole run.
   *
   * Sprint 09B.29 Phase 4. The submission task is a PRODUCER: submitting
   * enqueues `PROVIDER_ONBOARDING_SUBMITTED`, and `claimBatch` is a queue
   * CONSUMER that claims whatever is pending — no fixture namespace can hide a
   * row from it. Without this lock, `outbox.integration.spec.ts` claimed a row
   * this suite had enqueued and then failed when this suite's cleanup deleted
   * it out from under the worker.
   *
   * That failure landed on a suite Phase 4 never touched, which is exactly the
   * shape db-isolation.ts warns about: the reset was the bug, not either
   * suite. SHARED rather than exclusive, so this still runs beside every other
   * producer and only the consumer excludes us.
   */
  let outboxLock: HeldLock;

  let app: INestApplication;
  let http: any;
  let prisma: any;
  let mail: any;

  const savedEnv: Record<string, string | undefined> = {};

  const ENV: Record<string, string> = {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: SECRET,
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
    // Off: this suite is about DRAFT persistence. The work-access and
    // verification axes would refuse the provider routes for a second,
    // unrelated reason and make a persistence regression invisible.
    WORK_ACCESS_ENFORCED: 'false',
    VERIFICATION_ENFORCED: 'false',
    OUTBOX_WORKER_ENABLED: 'false',
    VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
    EVIDENCE_SCAN_WORKER_ENABLED: 'false',
    MONGODB_ENABLED: 'false',
    REALTIME_SOCKET_IO: 'false',
  };

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

  /** Clear the auth budgets this suite is about to spend.
   *
   *  Sprint 09B.29 Phase 4: this used to clear the REGISTRATION bucket only.
   *  The durability proofs sign out and back in for every field, which spends
   *  the generic login budget (10/minute per IP) that every other integration
   *  suite shares from loopback — so a 429 landed on whichever assertion was
   *  unlucky. See test/support/rate-limit-reset.ts for why clearing it cannot
   *  hide a throttle regression.
   */
  async function clearRegistrationBudget(email?: string): Promise<void> {
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    await clearAuthRateBudget(app.get(RedisService).getClient(), email ? [email] : []);
  }

  async function register(email: string): Promise<Session> {
    await clearRegistrationBudget(email);
    const registered = await request(http)
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Dur', lastName: 'Able' })
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

  /** A genuinely NEW session: sign in from scratch, no cookie reuse. This is
   *  what makes step 4 mean something.
   *
   *  TWO steps, because that is what the application does. `POST /auth/login`
   *  returns an `OtpChallengeResponse` and issues no session; the cookies come
   *  from `verify-otp`. A helper that stopped at login would be asserting
   *  against a session that was never created. */
  async function signIn(email: string): Promise<Session> {
    await clearRegistrationBudget(email);
    const challenge = await request(http)
      .post('/v1/auth/login')
      .set('X-Client-Kind', 'web')
      .send({ email, password: PASSWORD })
      .expect(200);

    const verified = await request(http)
      .post('/v1/auth/verify-otp')
      .set('X-Client-Kind', 'web')
      .send({ challengeId: challenge.body.challengeId, code: latestOtp(email) })
      .expect(200);

    const cookies = parseCookies(verified);
    const user = await prisma.user.findUnique({ where: { email } });
    return { cookies, csrf: csrfFrom(cookies), userId: user.id };
  }

  /** Upgrade to provider and rotate, so the token actually carries the role.
   *  Phase 2 proved the rotation is required; this just uses it. */
  async function becomeProvider(session: Session): Promise<Session> {
    // 200, exactly.
    //
    // The controller declares `@HttpCode(HttpStatus.OK)`, the Phase 2 suite
    // pins `.expect(200)` for both the first call and the idempotent repeat,
    // and the e2e controller spec asserts 200 twice. There is no legitimate
    // 200/201 ambiguity here, so this asserts the one status rather than
    // accepting a range — a helper that tolerated both would silently absorb a
    // real change to the endpoint's contract.
    await as(session, request(http).post('/v1/me/provider/upgrade')).send({}).expect(200);
    const rotated = await as(session, request(http).post('/v1/auth/refresh')).send({}).expect(200);
    const cookies = parseCookies(rotated);
    return {
      userId: session.userId,
      cookies: cookies.length > 0 ? cookies : session.cookies,
      csrf: cookies.length > 0 ? csrfFrom(cookies) : session.csrf,
    };
  }

  const draftOf = (s: Session) => as(s, request(http).get('/v1/me/provider/onboarding/draft'));

  /** NOT async. `send()` already returns supertest's chainable `Test`, and
   *  wrapping it in a promise would hand callers a Promise with no `.expect`. */
  function patchStep(s: Session, step: string, body: Record<string, unknown>): request.Test {
    return as(s, request(http).patch(`/v1/me/provider/onboarding/steps/${step}`)).send(body);
  }

  /** Everything this suite created, and nothing else — scoped by its own email
   *  domain. */
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

    // Deleting ProviderProfile rows is what the lifecycle backfill takes the
    // `providerLifecycle` lock EXCLUSIVE against, so this takes it SHARED —
    // the contract in test/support/db-isolation.ts, and the same rule the
    // Phase 3 journeys were corrected to follow.
    await withAdvisoryLock('providerLifecycle', 'shared', async () => {
      await prisma.providerAvailabilityInterval.deleteMany({ where: { providerProfileId } });
      await prisma.providerOnboardingDraft.deleteMany({ where: { providerProfileId } });
      await prisma.providerOnboardingSubmission.deleteMany({ where: { providerProfileId } });
      await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId } });
      await prisma.providerProfileServiceCategory.deleteMany({ where: { providerProfileId } });
      await prisma.providerProfile.deleteMany({ where: { userId } });
    });
    // The submission enqueues an outbox event keyed by the provider profile.
    // Left behind, it is a PENDING row the outbox worker will claim in another
    // suite — and the row's owner will have been deleted by then.
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...profiles.map((p: { id: string }) => p.id), ...ids] } },
    });
    await prisma.auditEvent.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.verificationToken.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  /** The category tree, removed separately: it is not scoped by user, and it
   *  must outlive every application that references it. */
  async function cleanupCategories(): Promise<void> {
    await prisma.providerCategoryApplication.deleteMany({
      where: { serviceCategoryId: { in: [CAT_LEAF, CAT_ROOT] } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { serviceCategoryId: { in: [CAT_LEAF, CAT_ROOT] } },
    });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [CAT_LEAF, CAT_ROOT] } } });
  }

  beforeAll(async () => {
    // The canonical order is providerLifecycle -> outbox -> ...; this suite
    // takes providerLifecycle only inside cleanupFixtures, so taking outbox
    // here cannot invert the order against any suite that holds both.
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');

    for (const [k, v] of Object.entries(ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }

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

    await cleanupFixtures();
    await cleanupCategories();

    await prisma.serviceCategory.create({
      data: { id: CAT_ROOT, slug: CAT_ROOT, labelEn: 'Plumbing', labelAr: 'سباكة', icon: 'wrench' },
    });
    await prisma.serviceCategory.create({
      data: {
        id: CAT_LEAF,
        slug: CAT_LEAF,
        labelEn: 'Leak repair',
        labelAr: 'إصلاح التسربات',
        icon: 'wrench',
        parentId: CAT_ROOT,
      },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await cleanupCategories();
    // AFTER the cleanup: releasing first would leave this suite's queue rows
    // visible to whichever consumer was waiting on the lock.
    await outboxLock?.release();
    await app?.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── the four-way durability proof, one task at a time ────────────────────

  describe('every task survives a sign-out and a fresh sign-in', () => {
    let session: Session;
    let profileId: string;

    beforeAll(async () => {
      session = await becomeProvider(await register(PROVIDER_A));
      const profile = await prisma.providerProfile.findFirst({
        where: { userId: session.userId },
        select: { id: true },
      });
      profileId = profile.id;
    });

    /** version → the next write's token, read from the server each time rather
     *  than counted here, because counting is how a test stops noticing that
     *  the server stopped incrementing. */
    const currentVersion = async (s: Session): Promise<number> =>
      (await draftOf(s).expect(200)).body.version;

    it('BASICS_IDENTITY — provider type, legal name, display name and phone', async () => {
      let v = await currentVersion(session);

      const typed = await patchStep(session, 'PROVIDER_TYPE', {
        version: v,
        providerType: 'BUSINESS',
        legalBusinessName: 'Durable Works Ltd',
      }).expect(200);
      expect(typed.body.data.providerType).toBe('BUSINESS');
      expect(typed.body.data.legalBusinessName).toBe('Durable Works Ltd');

      v = typed.body.version;
      const identity = await patchStep(session, 'IDENTITY', {
        version: v,
        displayName: 'Durable Display',
        phoneNumber: '+46701234567',
      }).expect(200);
      expect(identity.body.data.displayName).toBe('Durable Display');

      // 3. the database
      const row = await prisma.providerProfile.findUnique({
        where: { id: profileId },
        select: {
          providerType: true,
          legalBusinessName: true,
          displayName: true,
          phoneNumber: true,
        },
      });
      expect(row).toMatchObject({
        providerType: 'BUSINESS',
        legalBusinessName: 'Durable Works Ltd',
        displayName: 'Durable Display',
        phoneNumber: '+46701234567',
      });

      // 4. a brand-new session
      const fresh = await signIn(PROVIDER_A);
      const reread = await draftOf(fresh).expect(200);
      expect(reread.body.data).toMatchObject({
        providerType: 'BUSINESS',
        legalBusinessName: 'Durable Works Ltd',
        displayName: 'Durable Display',
        phoneNumber: '+46701234567',
      });
    });

    it('WORK_AREA — city, country, coordinates and radius', async () => {
      const v = await currentVersion(session);
      const res = await patchStep(session, 'LOCATION', {
        version: v,
        serviceAreaCity: 'Uppsala',
        serviceAreaCountryCode: 'SE',
        serviceAreaCountry: 'Sweden',
        serviceAreaRadiusKm: 25,
      }).expect(200);
      expect(res.body.data.serviceAreaCity).toBe('Uppsala');

      const row = await prisma.providerProfile.findUnique({
        where: { id: profileId },
        select: { serviceAreaCity: true, serviceAreaRadiusKm: true },
      });
      expect(row).toMatchObject({ serviceAreaCity: 'Uppsala', serviceAreaRadiusKm: 25 });

      const fresh = await signIn(PROVIDER_A);
      const reread = await draftOf(fresh).expect(200);
      expect(reread.body.data).toMatchObject({
        serviceAreaCity: 'Uppsala',
        serviceAreaRadiusKm: 25,
      });
    });

    it('WORKING_HOURS — the week is REPLACED atomically, not appended to', async () => {
      let v = await currentVersion(session);
      await patchStep(session, 'AVAILABILITY', {
        version: v,
        timezone: 'Europe/Stockholm',
        availability: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
          { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
        ],
      }).expect(200);

      // Replace with a DIFFERENT week. The old intervals must be gone, not
      // merged: a structured replacement that appends silently doubles a
      // provider's week every time they edit it.
      v = await currentVersion(session);
      const replaced = await patchStep(session, 'AVAILABILITY', {
        version: v,
        timezone: 'Europe/Stockholm',
        availability: [{ dayOfWeek: 5, startMinute: 600, endMinute: 900 }],
      }).expect(200);
      expect(replaced.body.data.availability).toHaveLength(1);

      const rows = await prisma.providerAvailabilityInterval.findMany({
        where: { providerProfileId: profileId },
        select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        dayOfWeek: 5,
        startMinute: 600,
        endMinute: 900,
        timezone: 'Europe/Stockholm',
      });

      const fresh = await signIn(PROVIDER_A);
      const reread = await draftOf(fresh).expect(200);
      expect(reread.body.data.availability).toHaveLength(1);
      expect(reread.body.data.timezone).toBe('Europe/Stockholm');
    });

    it('PORTFOLIO task — headline and bio', async () => {
      const v = await currentVersion(session);
      await patchStep(session, 'PROFILE', {
        version: v,
        headline: 'Durable Plumbing',
        bio: 'Twenty years of pipes, taps and the occasional flood.',
      }).expect(200);

      const row = await prisma.providerProfile.findUnique({
        where: { id: profileId },
        select: { headline: true, bio: true },
      });
      expect(row.headline).toBe('Durable Plumbing');

      const fresh = await signIn(PROVIDER_A);
      const reread = await draftOf(fresh).expect(200);
      expect(reread.body.data.headline).toBe('Durable Plumbing');
      expect(reread.body.data.bio).toContain('Twenty years');
    });

    it('SERVICES_EXPERIENCE — specialties and years, which live in TWO places', async () => {
      let v = await currentVersion(session);

      const chosen = await patchStep(session, 'SPECIALTIES', {
        version: v,
        specialtyLeafIds: [CAT_LEAF],
        primarySpecialtyId: CAT_LEAF,
      }).expect(200);
      v = chosen.body.version;

      await patchStep(session, 'EXPERIENCE', {
        version: v,
        yearsOfExperience: 9,
        transportModes: ['CAR'],
      }).expect(200);

      // The specialty is NOT a draft column: choosing a leaf the provider does
      // not already hold files an APPLICATION. A durability test that only
      // re-read the draft would pass while the application was lost.
      const application = await prisma.providerCategoryApplication.findFirst({
        where: { providerProfileId: profileId, serviceCategoryId: CAT_LEAF },
        select: { status: true },
      });
      expect(application).not.toBeNull();

      const profile = await prisma.providerProfile.findUnique({
        where: { id: profileId },
        select: { yearsOfExperience: true },
      });
      expect(profile.yearsOfExperience).toBe(9);

      const fresh = await signIn(PROVIDER_A);
      const reread = await draftOf(fresh).expect(200);
      expect(reread.body.data.yearsOfExperience).toBe(9);

      // And the HUB agrees, which is the surface the provider actually returns
      // to after leaving a task. A draft that remembers while the hub forgets
      // is still a lost task from where the provider is standing.
      const hub = await as(fresh, request(http).get('/v1/me/provider/onboarding/hub')).expect(200);
      const servicesTask = hub.body.tasks.find(
        (t: { id: string }) => t.id === 'SERVICES_EXPERIENCE',
      );
      expect(servicesTask).toBeDefined();
      expect(servicesTask.status).not.toBe('AVAILABLE');
    });
  });

  // ── the sixth task: submission, on its own provider ──────────────────────

  describe('REVIEW_SUBMISSION survives a sign-out and a fresh sign-in', () => {
    let session: Session;
    let profileId: string;

    beforeAll(async () => {
      session = await becomeProvider(await register(PROVIDER_C));
      const profile = await prisma.providerProfile.findFirst({
        where: { userId: session.userId },
        select: { id: true },
      });
      profileId = profile.id;

      // Every provider-owned input, through the real step endpoints. A
      // fixture written straight to the database would submit a draft the
      // application never validated.
      let v = (await draftOf(session).expect(200)).body.version as number;
      const step = async (name: string, body: Record<string, unknown>) => {
        const res = await patchStep(session, name, { ...body, version: v }).expect(200);
        v = res.body.version as number;
      };

      await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
      await step('IDENTITY', { displayName: 'Sub Mitter', phoneNumber: '+963900000444' });
      await step('LOCATION', {
        serviceAreaCity: 'DurableCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 15,
      });
      await step('SPECIALTIES', { specialtyLeafIds: [CAT_LEAF], primarySpecialtyId: CAT_LEAF });
      await step('EXPERIENCE', { yearsOfExperience: 6, transportModes: ['CAR'] });
      await step('AVAILABILITY', {
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
        timezone: 'Asia/Damascus',
      });
      await step('PROFILE', {
        headline: 'Leak repair specialist for homes',
        bio: 'Six years of residential plumbing, mostly leak detection and pipe replacement.',
      });
    });

    it('consent records the LIVE published version and survives a new session', async () => {
      const review = await as(
        session,
        request(http).get('/v1/me/provider/onboarding/review'),
      ).expect(200);
      expect(review.body.canSubmit).toBe(false);
      expect(review.body.blockedReason?.field).toBe('consent');

      // The version the server says is live, never a literal: a test that
      // hard-coded one would keep passing after the terms were republished,
      // which is the exact case consent exists to catch.
      const live = review.body.terms.version as string;
      await patchStep(session, 'CONSENT', {
        acceptedConsentVersion: live,
        version: review.body.draftVersion,
      }).expect(200);

      const fresh = await signIn(PROVIDER_C);
      const after = await as(fresh, request(http).get('/v1/me/provider/onboarding/review')).expect(
        200,
      );
      expect(after.body.canSubmit).toBe(true);
      expect(after.body.blockedReason).toBeNull();
    });

    it('the submission itself survives, and the draft comes back LOCKED', async () => {
      const fresh = await signIn(PROVIDER_C);
      const review = await as(fresh, request(http).get('/v1/me/provider/onboarding/review')).expect(
        200,
      );

      await as(fresh, request(http).post('/v1/me/provider/onboarding/submit'))
        .send({ version: review.body.draftVersion })
        .expect(200);

      const row = await prisma.providerProfile.findUnique({
        where: { id: profileId },
        select: { submittedForReviewAt: true, onboardingState: true, status: true },
      });
      expect(row.submittedForReviewAt).not.toBeNull();
      expect(row.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(row.status).toBe('PENDING_REVIEW');

      // What matters after a sign-out is not a field. It is that the draft
      // comes back NOT EDITABLE: a fresh session that could still write would
      // let the provider change what a reviewer is already looking at.
      const reborn = await signIn(PROVIDER_C);
      const draft = await draftOf(reborn).expect(200);
      expect(draft.body.editable).toBe(false);

      const hub = await as(reborn, request(http).get('/v1/me/provider/onboarding/hub')).expect(200);
      expect(hub.body.status).not.toBe('DRAFT');

      // And a write is actually refused, rather than merely hidden by the UI
      // flag above.
      await patchStep(reborn, 'IDENTITY', {
        version: draft.body.version,
        displayName: 'Changed After Submission',
      }).expect(409);
    });
  });

  // ── the identity the browser's version guard depends on ──────────────────

  describe('draftId — what a version is a version OF', () => {
    it('two providers have different draftIds, and their versions are independent', async () => {
      const a = await signIn(PROVIDER_A);
      const b = await becomeProvider(await register(PROVIDER_B));

      const draftA = (await draftOf(a).expect(200)).body;
      const draftB = (await draftOf(b).expect(200)).body;

      expect(typeof draftA.draftId).toBe('string');
      expect(typeof draftB.draftId).toBe('string');
      // The whole point. A browser comparing bare versions across these two
      // would show one provider the other's application.
      expect(draftA.draftId).not.toBe(draftB.draftId);

      // A's draft has been written many times above; B's is new. So B's
      // version is legitimately LOWER, which is exactly the shape that a
      // version-only monotonic rule mistakes for a stale read.
      expect(draftA.version).toBeGreaterThan(draftB.version);

      // And the ids are stable across a write rather than regenerated.
      const bumped = await patchStep(b, 'IDENTITY', {
        version: draftB.version,
        displayName: 'B Display',
      }).expect(200);
      expect(bumped.body.draftId).toBe(draftB.draftId);
      expect(bumped.body.version).toBe(draftB.version + 1);
    });
  });

  // ── the optimistic lock, end to end ──────────────────────────────────────

  describe('optimistic concurrency', () => {
    it('a stale version is refused with 409 and the server names the version it holds', async () => {
      const s = await signIn(PROVIDER_A);
      const current = (await draftOf(s).expect(200)).body.version;

      const stale = await patchStep(s, 'PROFILE', {
        version: current - 1,
        headline: 'Written against a version the server has moved past',
      }).expect(409);

      expect(
        stale.body?.error?.details?.expectedVersion ?? stale.body?.details?.expectedVersion,
      ).toBe(current);

      // And nothing was written.
      const after = await draftOf(s).expect(200);
      expect(after.body.data.headline).toBe('Durable Plumbing');
      expect(after.body.version).toBe(current);
    });

    it('the same write replayed with the same version is refused, not applied twice', async () => {
      const s = await signIn(PROVIDER_A);
      const v = (await draftOf(s).expect(200)).body.version;

      await patchStep(s, 'PROFILE', { version: v, headline: 'Replay once' }).expect(200);
      // A retried request — a dropped response, a double tap — presents the
      // same token. The lock is what stops it landing a second time.
      await patchStep(s, 'PROFILE', { version: v, headline: 'Replay twice' }).expect(409);

      const after = await draftOf(s).expect(200);
      expect(after.body.data.headline).toBe('Replay once');
      expect(after.body.version).toBe(v + 1);
    });
  });
});
