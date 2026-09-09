/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 09B.29, Phase 3 — the LEGACY V1 surface, over real HTTP.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// WHY V1 GETS ITS OWN REAL-HTTP SUITE
//
// The committed deployment configuration still defaults
// `VITE_PROVIDER_ONBOARDING_V2` to OFF, so V1 is the surface a production
// provider actually meets. It carried the same deadlock as V2 and a worse
// version of it: `toCandidate` supplied no `pendingSpecialtyCount`, so the
// policy could not tell "has not chosen a service" from "chose one and is
// waiting on us" and raised `serviceCategories: REQUIRED` for both. A provider
// who HAD chosen was told to choose, and the submission they could not unblock
// was refused.
//
// The unit spec pins the service. This pins the WIRE: that `awaitingReview`
// actually serialises out of `GET /v1/me/provider/onboarding`, that `missing`
// no longer carries platform-owned items, and that `POST
// /v1/me/provider/submit-for-review` really succeeds against real rows.
//
// `ProviderService` is stubbed because none of its routes are under test here;
// every collaborator that participates in the answers below is real.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('V1 legacy onboarding — pending specialty over real HTTP (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('v1pending');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  const getStatus = () => request(http).get('/v1/me/provider/onboarding');
  const postSubmit = () => request(http).post('/v1/me/provider/submit-for-review');

  async function makeProviderInputComplete(over: Record<string, unknown> = {}): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        displayName: 'Rania Khoury',
        headline: 'Certified electrician serving Damascus',
        bio: 'Eleven years of residential and light commercial electrical work, including rewiring and fault finding.',
        phoneNumber: '+963900000888',
        serviceAreaCity: 'V1TestCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 18,
        status: 'DRAFT',
        submittedForReviewAt: null,
        reviewedAt: null,
        rejectionReason: null,
        verified: false,
        verificationState: 'UNVERIFIED',
        standingState: 'GOOD',
        ...over,
      },
    });
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { ProviderController } = require('../../src/modules/provider/provider.controller');
    const { ProviderService } = require('../../src/modules/provider/provider.service');
    const {
      ProviderOnboardingService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      ProviderCapabilityGuard,
    } = require('../../src/modules/provider/guards/provider-capability.guard');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'v1-pending-test-secret',
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderController],
      providers: [
        ProviderOnboardingService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderProfileRepository,
        UserRepository,
        AuditService,
        AuditEventRepository,
        TransactionRunner,
        Reflector,
        // Not under test: none of its routes are exercised here.
        { provide: ProviderService, useValue: {} },
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .overrideGuard(ProviderCapabilityGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    await prisma.user.create({
      data: {
        id: USER,
        email: `${USER}@v1.test`,
        firstName: 'Rania',
        lastName: 'Khoury',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    await prisma.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'Electrical',
        labelAr: 'كهرباء',
        icon: 'bolt',
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: USER,
        displayName: 'Rania Khoury',
        initials: 'RK',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
  });

  beforeEach(async () => {
    currentUser = { id: USER };
    await prisma.auditEvent.deleteMany({ where: { userId: USER } });
    await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId: PP } });
    await prisma.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: PP } });
    await makeProviderInputComplete();
    await prisma.providerCategoryApplication.create({
      data: { providerProfileId: PP, serviceCategoryId: CATEGORY, status: 'PENDING' },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the additive field really crosses the wire ───────────────────────────

  describe('the response shape', () => {
    it('serialises awaitingReview out of the real endpoint', async () => {
      const res = await getStatus().expect(200);
      expect(res.body).toHaveProperty('awaitingReview');
      expect(res.body.awaitingReview).toEqual([
        { field: 'serviceCategories', code: 'AWAITING_REVIEW' },
      ]);
    });

    it('keeps every pre-existing field, so an old client cannot break', async () => {
      // Additive only. A client written before this sprint reads the same keys
      // it always did and ignores the new one.
      const res = await getStatus().expect(200);
      for (const key of [
        'complete',
        'missing',
        'submittedForReviewAt',
        'reviewedAt',
        'rejectionReason',
        'editable',
      ]) {
        expect(res.body).toHaveProperty(key);
      }
      expect(typeof res.body.complete).toBe('boolean');
      expect(Array.isArray(res.body.missing)).toBe(true);
    });

    it('never omits awaitingReview, even when there is nothing waiting', async () => {
      // A required field that is sometimes absent is worse than one that is
      // always an array: every consumer would need a null check the type does
      // not warn them about.
      await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId: PP } });
      await prisma.providerProfileServiceCategory.create({
        data: { providerProfileId: PP, serviceCategoryId: CATEGORY },
      });
      const res = await getStatus().expect(200);
      expect(res.body.awaitingReview).toEqual([]);
      expect(res.body.complete).toBe(true);
    });
  });

  // ── the deadlock, on the surface production actually serves ──────────────

  describe('a pending specialty does not deadlock V1', () => {
    it('reports provider input complete with nothing in missing', async () => {
      const res = await getStatus().expect(200);
      expect(res.body.complete).toBe(true);
      expect(res.body.missing).toEqual([]);
    });

    it('never tells the provider to choose a service they already chose', async () => {
      const res = await getStatus().expect(200);
      const codes = res.body.missing.map((m: { code: string }) => m.code);
      expect(codes).not.toContain('REQUIRED');
      expect(codes).not.toContain('AWAITING_REVIEW');
    });

    it('accepts the real submit-for-review and moves DRAFT → PENDING_REVIEW', async () => {
      await postSubmit().expect(200);
      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.status).toBe('PENDING_REVIEW');
      expect(profile.submittedForReviewAt).not.toBeNull();
    });

    it('writes exactly one submission audit event', async () => {
      await postSubmit().expect(200);
      const events = await prisma.auditEvent.findMany({
        where: { userId: USER, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(events).toHaveLength(1);
    });

    it('approves nothing and grants nothing by accepting the submission', async () => {
      await postSubmit().expect(200);
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: PP },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');

      const profile = await prisma.providerProfile.findUnique({
        where: { id: PP },
        include: { serviceCategories: true },
      });
      expect(profile.serviceCategories).toHaveLength(0);
      expect(profile.verified).toBe(false);
      expect(profile.status).not.toBe('ACTIVE');

      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: PP, revokedAt: null },
      });
      expect(grants).toBe(0);
    });
  });

  // ── the controls ─────────────────────────────────────────────────────────

  describe('genuine provider work still blocks V1', () => {
    it('blocks when nothing has been chosen, naming REQUIRED not AWAITING_REVIEW', async () => {
      await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId: PP } });
      const res = await getStatus().expect(200);
      expect(res.body.complete).toBe(false);
      expect(res.body.missing).toContainEqual({
        field: 'serviceCategories',
        code: 'REQUIRED',
      });
      expect(res.body.awaitingReview).toEqual([]);
      await postSubmit().expect(422);
    });

    it('blocks on an unrelated missing field while moderation is pending', async () => {
      await makeProviderInputComplete({ bio: null });
      const res = await getStatus().expect(200);
      expect(res.body.complete).toBe(false);
      expect(res.body.missing.map((m: { field: string }) => m.field)).toContain('bio');
      // The moderation item is still reported — on its own axis, not as work.
      expect(res.body.missing.map((m: { code: string }) => m.code)).not.toContain(
        'AWAITING_REVIEW',
      );
      expect(res.body.awaitingReview).toEqual([
        { field: 'serviceCategories', code: 'AWAITING_REVIEW' },
      ]);
      await postSubmit().expect(422);
    });

    it('refuses a second submission rather than queueing the application twice', async () => {
      await postSubmit().expect(200);
      await postSubmit().expect(409);
      const events = await prisma.auditEvent.findMany({
        where: { userId: USER, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(events).toHaveLength(1);
    });

    it('does not mutate state on repeated reads', async () => {
      const before = await prisma.providerProfile.findUnique({ where: { id: PP } });
      await getStatus().expect(200);
      await getStatus().expect(200);
      const after = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(after.status).toBe(before.status);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });
  });
});
