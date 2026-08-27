/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this suite is skipped, and a
 * top-level import of AppModule would validate env and open pools on every
 * hermetic run. `any` on the Prisma/Nest handles for the same reason — the
 * generated client must not be typed in at module scope.
 */

export {};

import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureEmailDomain, acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';

// Sprint 9B.13 — the whole provider journey, through the REAL application.
//
// docs/sprint-09b13/PROVIDER_JOURNEY.md
//
// WHY THIS SUITE EXISTS
//
// Every sibling suite composes a MINIMAL Nest module: the controller under
// test, the services it needs, and hand-built database rows for everything
// upstream of it. Each is right about its own slice, and none of them can say
// whether the slices JOIN UP. A provider who registers cannot be shown to
// reach a work-access grant by any argument built out of those suites, because
// not one of them ever registers anybody.
//
// So this one boots `AppModule` — the real graph, the real guards, the real
// routes, real Postgres, real Redis, real storage on disk — and walks one
// person from "no account" to "suspended", asserting each step at the HTTP
// boundary. Where a step is performed by a background actor (the scanner
// sweep, the expiry sweep) the suite calls that actor's service directly,
// because in production a timer does, and there is no route to stand in for it.
//
// BOTH ENFORCEMENT FLAGS ARE ON. That is the configuration the journey is
// about: with them off, steps 9 and 16 cannot fail and the suite would be
// asserting nothing.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(300_000);

d('Provider journey, flags ON (real AppModule, real Postgres, real Redis)', () => {
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let mail: any;
  let scanner: any;
  let expiry: any;

  const EMAIL_DOMAIN = fixtureEmailDomain('provider-journey');
  const addr = (local: string): string => `${local}@${EMAIL_DOMAIN}`;
  const PROVIDER_EMAIL = addr('walker');
  const REVIEWER_EMAIL = addr('reviewer');
  const PASSWORD = 'Journey!Passw0rd';

  // XH: the live-policy-per-scope index is GLOBAL, and XA–XG are taken by the
  // sibling suites. A country nobody else claims is what lets this suite own a
  // policy without serialising against them.
  const JOURNEY_COUNTRY = 'XH';
  const POLICY_VERSION = '2099.13-provider-journey-v1';
  const LEAF_CATEGORY_ID = 'it-provider-journey-leaf';

  /** The smallest thing that is genuinely a PDF.
   *
   *  Real bytes, because the upload route derives the type from the CONTENT
   *  and would reject a string that merely claims to be one — which is the
   *  behaviour the MIME-spoofing tests rely on and this journey must not
   *  bypass. */
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

  let storageRoot: string;
  let restrictedRoot: string;
  let lifecycleLock: HeldLock;
  let outboxLock: HeldLock;

  const savedEnv: Record<string, string | undefined> = {};

  /** The env the real app boots on here. Quoted verbatim in the report, so
   *  "the flags were on" is checkable rather than claimed. */
  const ENV: Record<string, string> = {
    NODE_ENV: 'test',
    // Long enough for the schema's 32-character floor, and deliberately
    // low-entropy and self-describing: a random-looking literal in a spec file
    // is indistinguishable from a real leaked key to a secret scanner, and to
    // the next person reading it.
    JWT_ACCESS_SECRET: 'test-only-not-a-secret-not-a-secret-value',
    // The OTP round-trip is part of the journey, so the dev shortcut that
    // auto-verifies a new account is OFF. This is the production setting.
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
    // The two flags this journey is about.
    WORK_ACCESS_ENFORCED: 'true',
    VERIFICATION_ENFORCED: 'true',
    // A scanner that can actually return CLEAN. `none` never does, so evidence
    // would stay unreadable and step 7 could not happen at all.
    EVIDENCE_SCANNER_DRIVER: 'test',
    // Every background timer OFF. This suite drives those actors itself, at
    // the moment the journey reaches them; a timer firing on its own would
    // make the ordering non-deterministic.
    OUTBOX_WORKER_ENABLED: 'false',
    VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
    MONGODB_ENABLED: 'false',
    REALTIME_SOCKET_IO: 'false',
  };

  // ── session handling ─────────────────────────────────────────────────────
  //
  // Real cookies, real CSRF. The double-submit token is echoed from the cookie
  // into the header exactly as a browser client does, because the CsrfGuard on
  // every mutating route is part of what the journey is proving.

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

  /** A request carrying this session's cookies and CSRF header. */
  function as(session: Session, req: request.Test): request.Test {
    return req
      .set('Cookie', session.cookies.join('; '))
      .set('X-CSRF-Token', session.csrf)
      .set('X-Client-Kind', 'web');
  }

  /** The most recent OTP mailed to `email`.
   *
   *  Read from the in-memory mail adapter rather than the database, because
   *  the database stores only a hash — which is the correct design, and means
   *  the only way to learn a code is to be the person who received it. */
  function latestOtp(email: string): string {
    const messages = (
      mail.outbox as Array<{ to: string; subject?: string; text?: string; html?: string }>
    ).filter((m) => m.to === email);
    const last = messages[messages.length - 1];
    if (!last) throw new Error(`no mail was sent to ${email}`);
    const body = `${last.text ?? ''} ${last.html ?? ''}`;
    const code = /\b(\d{6})\b/.exec(body);
    if (!code) throw new Error(`no 6-digit code in the mail to ${email}`);
    return code[1];
  }

  /** Register, verify the OTP, and come back with a live session. */
  async function registerAndSignIn(email: string): Promise<Session> {
    const registered = await request(http)
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Jo', lastName: 'Walker' })
      .expect(202);
    expect(registered.body.otpRequired).toBe(true);

    const verified = await request(http)
      .post('/v1/auth/verify-otp')
      // A WEB client, so the session arrives as cookies. Mobile clients get
      // tokens in the body instead, and the CSRF guard this journey exercises
      // only applies to the cookie-bearing kind.
      .set('X-Client-Kind', 'web')
      .send({ challengeId: registered.body.challengeId, code: latestOtp(email) })
      .expect(200);

    const cookies = parseCookies(verified);
    const user = await prisma.user.findUnique({ where: { email } });
    return { cookies, csrf: csrfFrom(cookies), userId: user.id };
  }

  /** Which capabilities the server currently ALLOWS this session.
   *
   *  The payload is a list of `{ capability, allowed }` — every capability,
   *  each with its verdict — so a bare `toContain('SUBMIT_BID')` is satisfied
   *  for a provider who is explicitly DENIED it. Reducing to the allowed names
   *  once, here, is what stops an assertion in this file from passing
   *  vacuously; the first draft of step 9 did exactly that. */
  function allowedCapabilities(body: {
    capabilities: Array<{ capability: string; allowed: boolean }>;
  }): string[] {
    return body.capabilities.filter((c) => c.allowed).map((c) => c.capability);
  }

  /** Rotate the session, so a role granted since it was issued is usable. */
  async function refresh(session: Session): Promise<Session> {
    const rotated = await as(session, request(http).post('/v1/auth/refresh')).send({}).expect(200);
    const cookies = parseCookies(rotated);
    return {
      userId: session.userId,
      cookies: cookies.length > 0 ? cookies : session.cookies,
      csrf: cookies.length > 0 ? csrfFrom(cookies) : session.csrf,
    };
  }

  /** Clear this suite's registration budget in Redis.
   *
   *  The throttle is real, Redis-backed and keyed by IP as well as by email,
   *  and every account the journey creates arrives from 127.0.0.1. Left alone,
   *  the third run of the suite in an hour would 429 on step 1 — a failure
   *  about the previous run rather than about anything under test. The keys
   *  cleared are exactly this suite's: loopback, and its own two addresses.
   *  registration-throttle.integration.spec.ts uses synthetic 198.51.100.x
   *  identities, so nothing here can hide a real throttle regression. */
  async function resetRegistrationBudget(): Promise<void> {
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    const redis = app.get(RedisService).getClient();
    const identities = ['127.0.0.1', '::1', PROVIDER_EMAIL, REVIEWER_EMAIL];
    const keys = identities.flatMap((id) => [
      `rl:auth:register:ip:${id}`,
      `rl:auth:register:ip:${id}:blocked`,
      `rl:auth:register:email:${id}`,
      `rl:auth:register:email:${id}:blocked`,
    ]);
    await redis.del(...keys);
  }

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
    const profileIds = profiles.map((p: { id: string }) => p.id);
    const cases = await prisma.verificationCase.findMany({
      where: { providerProfileId: { in: profileIds } },
      select: { id: true },
    });
    const caseIds = cases.map((c: { id: string }) => c.id);

    // Assets are collected BEFORE they are deleted, because the outbox rows
    // this suite produces are keyed by asset id.
    //
    // The scanner sweep is global and keys `evidence.scanned` by the ASSET —
    // a generated cuid, not anything carrying this suite's prefix. Cleaning
    // only by case and profile left exactly one such row behind per run, and
    // outbox.integration.spec.ts, which is a queue CONSUMER asserting on
    // table-wide claims, picked it up and failed for a defect that was not its
    // own. Deterministically, three runs out of three.
    const assets = await prisma.mediaAsset.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const assetIds = assets.map((a: { id: string }) => a.id);

    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.auditEvent.deleteMany({ where: { userId } });
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...caseIds, ...profileIds, ...assetIds, ...ids] } },
    });
    await prisma.verificationDecision.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: userId } });
    await prisma.verificationCase.deleteMany({ where: { id: { in: caseIds } } });
    await prisma.providerWorkAccessGrant.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerEquipment.deleteMany({ where: { providerProfileId: { in: profileIds } } });
    await prisma.providerServiceArea.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerOnboardingDraft.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { in: profileIds } } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.verificationToken.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  beforeAll(async () => {
    // EXCLUSIVE on both, and this is not caution — it is what this suite is.
    //
    // A fixture namespace isolates rows a suite CREATES. It cannot isolate a
    // sweep, and this journey drives two of them: `scanPending()` scans every
    // PENDING asset in the database, and `runOnce()` expires every grant that
    // is due. Both are global by design — that is correct in production, where
    // there is one of each and it should reach everything.
    //
    // Held shared, the journey therefore reached into sibling suites mid-flight
    // and the run was flaky in a way that pointed at innocent tests: three
    // consecutive full runs produced two different failures, in
    // `outbox.integration` ("reclaims an event orphaned by a worker that died
    // mid-flight") and in `work-access-enforcement` ("two concurrent sweeps
    // expire once"), and a clean third. Neither suite was broken; this one had
    // expired their grants and enqueued rows their consumer then claimed.
    //
    // db-isolation.ts already names the case: a suite that intentionally
    // mutates SHARED rows table-wide takes the lock EXCLUSIVE. Ordered
    // lifecycle-then-outbox, the same order every other suite uses, so no two
    // suites can deadlock on the pair.
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'exclusive');
    outboxLock = await acquireAdvisoryLock('outbox', 'exclusive');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-journey-pub-'));
    restrictedRoot = mkdtempSync(join(tmpdir(), 'hsm-journey-res-'));

    for (const [k, v] of Object.entries({
      ...ENV,
      LOCAL_STORAGE_DIR: storageRoot,
      RESTRICTED_STORAGE_DIR: restrictedRoot,
    })) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    // SMTP off, so the in-memory adapter is bound and the OTP is readable.
    // Forced rather than defaulted: a developer with SMTP_HOST in their shell
    // would otherwise mail the code to Mailpit and this suite could not read it.
    savedEnv.SMTP_HOST = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    const { AppModule } = require('../../src/app.module') as typeof import('../../src/app.module');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');
    const {
      EvidenceScanService,
    } = require('../../src/modules/provider/verification/media/evidence-scan.service');
    const {
      VerificationExpiryService,
    } = require('../../src/modules/provider/verification/expiry/verification-expiry.service');

    // The mail transport is REPLACED, not merely defaulted.
    //
    // A verification code exists to be known only by whoever received the
    // mail — the database stores a hash, which is the right design and means
    // the only way for this suite to learn a code is to be the mailbox. So it
    // is the mailbox. Overriding the port rather than relying on SMTP_HOST
    // being absent also makes the suite independent of the developer's .env:
    // this machine has SMTP_HOST=localhost, which bound Nodemailer and sent
    // the journey's codes to Mailpit where no assertion could reach them.
    const { MAIL_PORT } = require('../../src/infrastructure/mail/mail.port');
    mail = new InMemoryMailAdapter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PORT)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();

    // The same bootstrap main.ts performs, in the same order.
    //
    // Not decoration: without `cookieParser` the session cookie this journey
    // depends on is never parsed, `req.cookies` is undefined, and every
    // authenticated step answers 401 — which is what happened, and is a
    // property of the harness rather than of the application. Without the
    // ValidationPipe every DTO rule the journey leans on (forbidNonWhitelisted
    // among them) would be absent, and the suite would be walking an app that
    // accepts payloads the real one rejects.
    const cookieParser = require('cookie-parser');
    const express = require('express');
    app.use(cookieParser());
    app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    await app.init();
    http = app.getHttpServer();

    scanner = app.get(EvidenceScanService);
    expiry = app.get(VerificationExpiryService);

    await resetRegistrationBudget();
    await cleanupFixtures();
    await seedCatalogue();
  });

  /** The two rows the journey needs to exist before anyone walks it: a leaf
   *  specialty to apply for, and the verification policy in force where this
   *  provider says they will work. Both are catalogue data an operator
   *  maintains, not something a provider creates. */
  async function seedCatalogue(): Promise<void> {
    await prisma.serviceCategory.upsert({
      where: { id: LEAF_CATEGORY_ID },
      update: { isActive: true, isLeaf: true },
      create: {
        id: LEAF_CATEGORY_ID,
        slug: LEAF_CATEGORY_ID,
        labelEn: 'Journey plumbing',
        labelAr: 'سباكة الرحلة',
        icon: 'wrench',
        isLeaf: true,
        isActive: true,
      },
    });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY_VERSION } });
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY_VERSION,
        country: JOURNEY_COUNTRY,
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        // In the PAST: a policy is live once it is published, so a future
        // date would leave this scope with no live policy and the resolver
        // would fall back to the dev default — which is what happened.
        publishedAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
  }

  /** Make this user a reviewer.
   *
   *  Through the seeded `admin` role rather than by inventing permissions: the
   *  point of the review steps is that the REAL permission checks pass for
   *  someone who genuinely holds them, and fail for the provider, who does not. */
  async function grantAdmin(userId: string): Promise<void> {
    const role = await prisma.role.findFirst({ where: { name: 'admin' } });
    if (!role) throw new Error('the admin role is not seeded');
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
  }

  /** Turn the redacted preview on or off through the platform setting that
   *  governs it. Default-off is the shipped behaviour (9B.9), so the journey
   *  has to arm it before step 10 can see anything at all. */
  async function setPreviewPolicy(enabled: boolean): Promise<void> {
    const key = 'provider_marketplace_preview';
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value: { enabled, cellKm: 25, maxItems: 10, maxReach: 20 } },
      create: { key, value: { enabled, cellKm: 25, maxItems: 10, maxReach: 20 } },
    });
  }

  afterAll(async () => {
    await cleanupFixtures().catch(() => undefined);
    await app?.close();
    rmSync(storageRoot, { recursive: true, force: true });
    rmSync(restrictedRoot, { recursive: true, force: true });
    await prisma?.$disconnect();
    await outboxLock?.release();
    await lifecycleLock?.release();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // ── the journey ──────────────────────────────────────────────────────────
  //
  // One ordered walk. Each step depends on the one before it, which is the
  // point: a suite that could run these in any order would not be describing a
  // journey. State that carries between steps lives here.

  let provider: Session;
  let reviewer: Session;
  let providerProfileId: string;
  let caseId: string;
  let assetId: string;
  let documentId: string;

  it('step 1-2: registers, verifies the OTP, and holds a real session', async () => {
    provider = await registerAndSignIn(PROVIDER_EMAIL);

    const me = await as(provider, request(http).get('/v1/auth/me')).expect(200);
    expect(me.body.email).toBe(PROVIDER_EMAIL);

    // The OTP was consumed, not merely presented: the account is verified and
    // active, which is what everything downstream is allowed to assume.
    const row = await prisma.user.findUnique({ where: { id: provider.userId } });
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.status).toBe('ACTIVE');
  });

  it('step 3: upgrades to a provider and completes onboarding', async () => {
    // An upgrade is not an application: it grants the provider role and opens
    // a DRAFT profile, and nothing else.
    const upgraded = await as(provider, request(http).post('/v1/me/provider/upgrade'))
      .send({})
      .expect(200);
    providerProfileId = upgraded.body.profile.id;
    expect(providerProfileId).toBeTruthy();

    // A leaf specialty must be APPROVED by an admin before it counts, so the
    // The session was minted BEFORE the upgrade, so its token still says
    // "customer". Roles live in the access token, not in a per-request lookup,
    // which is the deliberate trade for not hitting the database on every
    // call — and it means a role gained mid-session is not usable until the
    // token is refreshed. A real client does exactly this.
    provider = await refresh(provider);

    // A leaf specialty must be APPROVED by an admin before it counts, so the
    // reviewer is created here and used twice — once for the specialty, once
    // for the verification decision.
    reviewer = await registerAndSignIn(REVIEWER_EMAIL);
    await grantAdmin(reviewer.userId);
    reviewer = await refresh(reviewer);

    const draft = () => as(provider, request(http).get('/v1/me/provider/onboarding/draft'));
    let view = (await draft().expect(200)).body;

    const patch = async (step: string, body: Record<string, unknown>) => {
      const res = await as(
        provider,
        request(http).patch(`/v1/me/provider/onboarding/steps/${step}`),
      ).send({ version: view.version, ...body });
      // The server's own words on failure. `expect(200)` alone would report
      // "expected 200, got 400" and hide the field it objected to, which is
      // the only useful part.
      if (res.status !== 200) {
        throw new Error(`${step} was refused (${res.status}): ${JSON.stringify(res.body)}`);
      }
      view = res.body;
      return res.body;
    };

    await patch('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await patch('IDENTITY', { displayName: 'Jo the Fixer', phoneNumber: '+46701234567' });
    await patch('LOCATION', {
      serviceAreaCity: 'Journeyville',
      serviceAreaCountry: JOURNEY_COUNTRY,
      serviceAreaRadiusKm: 25,
    });
    await patch('SPECIALTIES', { specialtyLeafIds: [LEAF_CATEGORY_ID] });
    await patch('EXPERIENCE', { yearsOfExperience: 7 });
    await patch('AVAILABILITY', {
      timezone: 'Europe/Stockholm',
      availability: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
    });
    await patch('PROFILE', {
      headline: 'Careful work, on time, every time',
      bio: 'Fifteen years of plumbing, tiling and the small repairs nobody else will take on.',
    });
    await patch('CONSENT', { acceptedConsentVersion: 'v1' });

    // The specialty is a REQUEST until an admin agrees. Approving it is a real
    // review, made by the reviewer over the real admin route.
    const application = await prisma.providerCategoryApplication.findFirst({
      where: { providerProfileId, status: 'PENDING' },
    });
    expect(application).not.toBeNull();
    await as(
      reviewer,
      request(http).patch(`/v1/admin/category-applications/${application.id}/review`),
    )
      .send({ action: 'APPROVE' })
      .expect(200);

    view = (await draft().expect(200)).body;
    const submitted = await as(
      provider,
      request(http).post('/v1/me/provider/onboarding/submit'),
    ).send({ version: view.version });
    if (submitted.status !== 200) {
      // The server names the fields it is still waiting for. Reporting them is
      // the difference between "submit failed" and a diagnosis.
      throw new Error(
        `submit was refused (${submitted.status}): ${JSON.stringify(submitted.body)}`,
      );
    }

    // Submitting grants NOTHING. It moves the application into the queue and
    // asks for documents; that is the whole of it.
    expect(submitted.body.state).toBe('DOCUMENTS_REQUIRED');

    // ── the phone-verification boundary, proved on a REAL account ────────
    //
    // This provider registered through the real flow, so nothing ever set
    // `phoneVerifiedAt` — nothing in the system can. Until Sprint 9B.13 the
    // wizard nonetheless asked the policy about it and was refused, which made
    // the submission above impossible for every provider alive.
    //
    // The two assertions together are the boundary: the platform does NOT
    // pretend the number was verified (the column is still null), and it no
    // longer blocks on a question it cannot accept an answer to.
    const profile = await prisma.providerProfile.findUnique({
      where: { id: providerProfileId },
    });
    expect(profile.phoneVerifiedAt).toBeNull();
    expect(profile.phoneNumber).toBe('+46701234567');

    // And the application is now LOCKED. The edit lock is the counterpart to
    // being in a queue: a reviewer must not be judging a document that changes
    // under them. (That changing the number clears any stored verification is
    // a unit-level rule — see provider-onboarding-wizard.service.spec.ts —
    // because here there is no verification to clear and never can be.)
    const reread = (await draft().expect(200)).body;
    expect(reread.editable).toBe(false);
    const locked = await as(
      provider,
      request(http).patch('/v1/me/provider/onboarding/steps/IDENTITY'),
    ).send({ version: reread.version, phoneNumber: '+46701234568' });
    expect(locked.status).toBe(409);
  });

  it('step 4: resolves the policy and opens a verification case', async () => {
    const created = await as(provider, request(http).post('/v1/me/provider/verification/case'))
      .send({})
      .expect(200);

    caseId = created.body.case.id;
    expect(created.body.case.state).toBe('DRAFT');
    // The case was opened under the policy in force for where they will WORK.
    expect(created.body.case.policyVersion).toBe(POLICY_VERSION);
    // The contract publishes an ARRAY of requirements and a top-level
    // verificationRequired. Asserted on the WIRE, because the web client reads
    // exactly this and a controller cast can make any shape typecheck.
    expect(Array.isArray(created.body.case.requirements)).toBe(true);
    expect(created.body.case.requirements[0]).toEqual({
      kind: 'INDIVIDUAL_IDENTITY',
      serviceCategoryId: null,
    });
    expect(typeof created.body.case.verificationRequired).toBe('boolean');
    expect(created.body.case.verificationRequired).toBe(true);
    // The raw snapshot must not escape under the array's name. `fromVersion`
    // and a nested `requirements` key are the two fingerprints of the shape
    // that shipped for three sprints and crashed the provider screen.
    expect(JSON.stringify(created.body.case.requirements)).not.toContain('fromVersion');
    expect(created.body.case.requirements).not.toHaveProperty('requirements');

    // Resuming is not creating. A retry after a dropped response must not open
    // a second case.
    const resumed = await as(provider, request(http).post('/v1/me/provider/verification/case'))
      .send({})
      .expect(200);
    expect(resumed.body.case.id).toBe(caseId);
    expect(resumed.body.created).toBe(false);
  });

  it('step 5-6: uploads evidence and finalizes it', async () => {
    const prepared = await as(
      provider,
      request(http).post('/v1/me/provider/verification/evidence/prepare'),
    )
      .send({
        kind: 'INDIVIDUAL_IDENTITY',
        declaredMimeType: 'application/pdf',
        sizeBytes: PDF.length,
        filename: 'passport.pdf',
      })
      .expect(200);

    assetId = prepared.body.assetId;
    expect(assetId).toBeTruthy();
    // No signed URL, no storage key: the bytes go to the API, which is what
    // keeps the object store unreachable from a browser (ADR 0009).
    expect(JSON.stringify(prepared.body)).not.toContain('verification/');

    await as(
      provider,
      request(http).put(`/v1/me/provider/verification/evidence/${assetId}/content`),
    )
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(200);

    const finalized = await as(
      provider,
      request(http).post(`/v1/me/provider/verification/evidence/${assetId}/finalize`),
    )
      .send({})
      .expect(200);

    documentId = finalized.body.documentId ?? finalized.body.document?.id;
    expect(documentId).toBeTruthy();

    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    // Server-derived facts, not the client's claims.
    expect(asset.sizeBytes).toBe(PDF.length);
    expect(asset.detectedMimeType).toBe('application/pdf');
    expect(asset.visibility).toBe('RESTRICTED');
  });

  it('step 7: the scanner clears the document, and only then is it readable', async () => {
    const before = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    expect(before.scanState).toBe('PENDING');

    // Unscanned evidence is unreadable even by the person who uploaded it.
    await as(
      provider,
      request(http).get(`/v1/verification/documents/${documentId}/content`),
    ).expect(404);

    await scanner.scanPending({ limit: 500 });

    const after = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    expect(after.scanState).toBe('CLEAN');
    await as(
      provider,
      request(http).get(`/v1/verification/documents/${documentId}/content`),
    ).expect(200);
  });

  it('step 8: submits the case for review', async () => {
    const submitted = await as(
      provider,
      request(http).post('/v1/me/provider/verification/case/submit'),
    )
      .send({})
      .expect(200);

    expect(submitted.body.state).toBe('SUBMITTED');

    // Idempotent: a replayed submission is not a second submission.
    const replay = await as(
      provider,
      request(http).post('/v1/me/provider/verification/case/submit'),
    )
      .send({})
      .expect(200);
    expect(replay.body.state).toBe('SUBMITTED');
    expect(replay.body.changed).toBe(false);
  });

  it('step 9: working operations are refused while the case is only submitted', async () => {
    // The whole reason the flags exist. Submitting evidence is not being
    // verified, and being verified is not holding work access.
    const feed = await as(provider, request(http).get('/v1/provider/available-requests'));
    expect(feed.status).toBe(403);
    expect(feed.body.error.code).toBe('FORBIDDEN');

    const capabilities = await as(
      provider,
      request(http).get('/v1/me/provider/capabilities'),
    ).expect(200);
    const denied = allowedCapabilities(capabilities.body);
    expect(denied).not.toContain('SUBMIT_BID');
    expect(denied).not.toContain('VIEW_MARKETPLACE');
    // The one thing they CAN do while they wait.
    expect(denied).toContain('PREVIEW_MARKETPLACE');
  });

  it('step 10: the preview is OFF until an operator turns it on, and redacted when they do', async () => {
    // ── fail-closed first ────────────────────────────────────────────────
    //
    // The setting is deleted rather than set to false, because "absent" is the
    // state a fresh deployment is actually in, and it is the one a policy can
    // get wrong by omission. The route must answer with nothing to see —
    // NOT 403, so that toggling the setting is not observable as a status
    // change by anyone probing it.
    await prisma.platformSetting.deleteMany({ where: { key: 'provider_marketplace_preview' } });

    const off = await as(provider, request(http).get('/v1/me/provider/marketplace-preview')).expect(
      200,
    );
    expect(off.body.items ?? []).toHaveLength(0);

    // ── and now, armed ───────────────────────────────────────────────────
    await setPreviewPolicy(true);

    const preview = await as(
      provider,
      request(http).get('/v1/me/provider/marketplace-preview'),
    ).expect(200);

    const serialized = JSON.stringify(preview.body);
    // Nothing that identifies a seeker, locates a job precisely, or points at
    // a stored object. Asserted over the WHOLE payload rather than field by
    // field: a leak added later would arrive under a name this test does not
    // know, and the point is that no such name is allowed at all.
    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/"latitude"|"lat"\s*:\s*-?\d+\.\d{3,}/);
    // No storage key, no restricted namespace, no raw owner id.
    expect(serialized).not.toContain('verification/');
    expect(serialized).not.toContain(provider.userId);
    expect(serialized).not.toContain(providerProfileId);
    for (const item of preview.body.items ?? []) {
      expect(item).not.toHaveProperty('address');
      expect(item).not.toHaveProperty('customerName');
      expect(item).not.toHaveProperty('phone');
    }
  });

  it('step 10b: the evidence they uploaded is not reachable as public media', async () => {
    // The two media worlds must not meet. Portfolio images are public and
    // cacheable; identity evidence is restricted, streamed and audited. A
    // relational mis-link or a shared storage root is what would join them, so
    // the assertion is made against the PUBLIC route with the real key.
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    expect(asset.visibility).toBe('RESTRICTED');
    expect(asset.storageKey).toMatch(/^verification\//);

    const viaPublic = await request(http).get(`/v1/media/files/${asset.storageKey}`);
    expect(viaPublic.status).toBeGreaterThanOrEqual(400);
    expect(viaPublic.headers['cache-control'] ?? '').not.toContain('public');

    // And the portfolio surface lists nothing, because evidence is not
    // portfolio media and nothing moved it there.
    const portfolio = await as(provider, request(http).get('/v1/me/provider/portfolio')).expect(
      200,
    );
    expect(JSON.stringify(portfolio.body)).not.toContain('verification/');
    expect(portfolio.body.items ?? []).toHaveLength(0);
  });

  it('step 11: an authorized reviewer can see the case; an unauthorized one cannot', async () => {
    const queue = await as(
      reviewer,
      request(http).get('/v1/admin/verification/cases').query({ state: 'SUBMITTED' }),
    ).expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(caseId);

    const detail = await as(
      reviewer,
      request(http).get(`/v1/admin/verification/cases/${caseId}`),
    ).expect(200);
    expect(detail.body.availableActions).toContain('approve');

    // The provider is not a reviewer, and asking is not a way to find out
    // whether the case exists.
    await as(provider, request(http).get(`/v1/admin/verification/cases/${caseId}`)).expect(403);
  });

  it('step 12-13: approval writes the decision, the grant, the audit row, the notification and the outbox event together', async () => {
    const approved = await as(
      reviewer,
      request(http).post(`/v1/admin/verification/cases/${caseId}/approve`),
    )
      .send({ reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE', expectedState: 'SUBMITTED' })
      .expect(200);
    expect(approved.body.state).toBe('VERIFIED');

    const [kase, decisions, grants, notifications, events] = await Promise.all([
      prisma.verificationCase.findUnique({ where: { id: caseId } }),
      prisma.verificationDecision.findMany({ where: { caseId } }),
      prisma.providerWorkAccessGrant.findMany({ where: { providerProfileId } }),
      prisma.notification.findMany({ where: { userId: provider.userId } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: caseId } }),
    ]);

    // Atomic means all of it, or none of it. Five rows, one transaction.
    expect(kase.state).toBe('VERIFIED');
    expect(decisions).toHaveLength(1);
    expect(grants).toHaveLength(1);
    expect(grants[0].status).toBe('ACTIVE');
    expect(grants[0].source).toBe('VERIFIED_DOCUMENTS');
    // A grant with no end is a grant nobody re-checks.
    expect(grants[0].expiresAt).not.toBeNull();
    expect(notifications.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);

    // The reviewer's private note never reaches the provider.
    expect(JSON.stringify(notifications)).not.toContain('DOCUMENTS_COMPLETE_AND_LEGIBLE_NOTE');
  });

  it('step 14: the marketplace opens', async () => {
    const capabilities = await as(
      provider,
      request(http).get('/v1/me/provider/capabilities'),
    ).expect(200);
    const working = allowedCapabilities(capabilities.body);
    expect(working).toContain('VIEW_MARKETPLACE');
    expect(working).toContain('SUBMIT_BID');
    // The preview is the consolation prize for NOT having access; holding
    // access must retire it, or a verified provider is offered both.
    expect(working).not.toContain('PREVIEW_MARKETPLACE');

    await as(provider, request(http).get('/v1/provider/available-requests')).expect(200);

    // And the preview is no longer what they get — they have the real feed.
    await as(provider, request(http).get('/v1/me/provider/marketplace-preview')).expect(403);
  });

  it('step 15-16: expiry closes the grant, and work is denied again on the very next request', async () => {
    // Wind the grant back so it is due, rather than waiting a year. The sweep
    // is given the real clock; nothing about the decision is faked.
    // The whole window moves, not just its end: a CHECK constraint
    // (`provider_work_access_grant_expiry_after_grant`) refuses a grant that
    // expires before it was issued, and rightly — such a row could only be a
    // bug. Winding both ends back keeps the row exactly as valid as a real
    // grant issued last year.
    const now = Date.now();
    await prisma.providerWorkAccessGrant.updateMany({
      where: { providerProfileId, status: 'ACTIVE' },
      data: {
        grantedAt: new Date(now - 2 * 60 * 60_000),
        expiresAt: new Date(now - 60_000),
      },
    });

    // Denied at the expiry instant, BEFORE any sweep runs: access is a
    // read-time predicate, so a sweep that never ran cannot leave it open.
    await as(provider, request(http).get('/v1/provider/available-requests')).expect(403);

    const swept = await expiry.runOnce({ now: new Date(), limit: 100 });
    expect(swept.expired).toBeGreaterThanOrEqual(1);

    const grant = await prisma.providerWorkAccessGrant.findFirst({
      where: { providerProfileId },
      orderBy: { createdAt: 'desc' },
    });
    expect(grant.status).toBe('EXPIRED');
    await as(provider, request(http).get('/v1/provider/available-requests')).expect(403);
  });

  it('step 17-18: suspension blocks the account, whatever the verification says', async () => {
    // THE TWO AXES ARE VISIBLE HERE, and this step is where the journey proves
    // they are not the same thing.
    //
    // The provider has been VERIFIED since step 12 and worked the marketplace
    // in step 14, yet their ACCOUNT is still PENDING_REVIEW: approving a
    // verification case decides documents, and it does not touch the account
    // lifecycle. `suspend` is legal only from ACTIVE, so the account has to be
    // approved on its own axis first — which is a second, separate decision by
    // the same reviewer.
    const before = await prisma.providerProfile.findUnique({ where: { id: providerProfileId } });
    expect(before.status).toBe('PENDING_REVIEW');

    await as(reviewer, request(http).post(`/v1/admin/providers/${providerProfileId}/approve`))
      .send({})
      .expect(200);

    await as(reviewer, request(http).post(`/v1/admin/providers/${providerProfileId}/suspend`))
      .send({ reason: 'Journey test suspension' })
      .expect(200);

    const capabilities = await as(
      provider,
      request(http).get('/v1/me/provider/capabilities'),
    ).expect(200);
    const suspended = allowedCapabilities(capabilities.body);
    expect(suspended).not.toContain('VIEW_MARKETPLACE');
    expect(suspended).not.toContain('SUBMIT_BID');
    // Not even the consolation prize: a suspended provider is not browsing.
    await as(provider, request(http).get('/v1/me/provider/marketplace-preview')).expect(403);
    await as(provider, request(http).get('/v1/provider/available-requests')).expect(403);

    // The case and its evidence survive the suspension untouched. A suspension
    // is a decision about the ACCOUNT; it neither reopens nor erases a case.
    //
    // EXPIRED, not VERIFIED — the case followed its own grant out of validity
    // back in step 15, which is the case axis moving for case reasons. The
    // suspension did not move it, and the approval that put it there is still
    // on the record.
    const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    expect(kase.state).toBe('EXPIRED');
    const decisions = await prisma.verificationDecision.findMany({ where: { caseId } });
    expect(decisions.map((dec: { outcome: string }) => dec.outcome)).toContain('APPROVED');
    const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    expect(asset.scanState).toBe('CLEAN');
  });
});
