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
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 09B.29 Phase 3, JOURNEY E — concurrency, ownership and input trust.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// Journeys A–D established WHAT the lifecycle does. E asks whether it holds up
// when the client misbehaves: a stale tab, a double-tapped button, two people
// on one account, a payload that reaches for a column it must not set, and a
// read that should never be a write.
//
// These are the failure modes that do not show up in a happy-path test and are
// expensive to find in production, because each one corrupts state rather than
// erroring.
//
// WHAT IS REAL / NOT REAL: as Journey A — the wizard, the policy, the
// repositories, the transaction runner, the audit service, Postgres and Redis
// are real; `JwtAuthGuard` is stubbed and `CsrfGuard`/`RolesGuard`/
// `ProviderCapabilityGuard` are passed through, because this suite is about
// concurrency and input handling rather than authorisation. Ownership here
// means "the service scopes every read and write to the caller's own profile",
// which is exactly what the stub lets us probe: the identity is trusted, so any
// cross-tenant leak would be the service's own doing.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string; roles: string[] } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('Phase 3 Journey E — concurrency, ownership and input trust (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3e');
  const ALICE = `${P}alice`;
  const BOB = `${P}bob`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  let lifecycleLock: HeldLock;
  let aliceProfileId: string;
  let bobProfileId: string;

  const as = (id: string) => {
    currentUser = { id, roles: ['customer', 'provider'] };
  };

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getHub = () => request(http).get('/v1/me/provider/onboarding/hub');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeOf = (res: any): unknown => res.body?.error?.code;

  const versionOf = async (): Promise<number> =>
    (await getDraft().expect(200)).body.version as number;

  const profileOf = (id: string) => prisma.providerProfile.findUnique({ where: { id } });
  const submissionsOf = (id: string) =>
    prisma.providerOnboardingSubmission.findMany({ where: { providerProfileId: id } });

  async function cleanupFixtures(): Promise<void> {
    const rows = (await prisma.providerProfile.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);

    await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [LEAF, ROOT] } } });
  }

  /** Fill every provider-owned input for the CURRENT identity, stopping short
   *  of submitting, and return the draft version after the last write. */
  async function fillEverything(displayName: string, city: string): Promise<number> {
    let v = await versionOf();
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName, phoneNumber: '+963900000654' });
    await step('LOCATION', {
      serviceAreaCity: city,
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 18,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 6, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: `${displayName} — licensed electrician`,
      bio: 'Six years of residential electrical work, including rewiring, fault finding and emergency callouts.',
    });
    const review = await getReview().expect(200);
    const res = await patchStep('CONSENT', {
      acceptedConsentVersion: review.body.terms.version,
      version: review.body.draftVersion,
    }).expect(200);
    return res.body.version as number;
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
    const {
      ProviderOnboardingDraftRepository,
    } = require('../../src/infrastructure/persistence/provider/provider-onboarding-draft.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ProviderCategoryApplicationRepository,
    } = require('../../src/infrastructure/persistence/services/provider-category-application.repository');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      ProviderOnboardingWizardController,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.controller');
    const {
      ProviderOnboardingWizardService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.service');
    const {
      ProviderAvatarService,
    } = require('../../src/modules/provider/onboarding/avatar/provider-avatar.service');
    const {
      ProviderServiceAreaExpansionService,
    } = require('../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service');
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
    const { STORAGE_PORT } = require('../../src/infrastructure/storage/storage.port');

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'phase3-journey-e-secret',
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController, ProviderController],
      providers: [
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
        ProviderServiceAreaExpansionService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderProfileRepository,
        ProviderOnboardingDraftRepository,
        ServiceCategoryRepository,
        ProviderCategoryApplicationRepository,
        UserRepository,
        RoleRepository,
        PlatformSettingRepository,
        AuditService,
        AuditEventRepository,
        TransactionRunner,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: STORAGE_PORT, useValue: {} },
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

    for (const [id, first] of [
      [ALICE, 'Alice'],
      [BOB, 'Bob'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3e.test`,
          firstName: first,
          lastName: 'Nasr',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    await prisma.serviceCategory.create({
      data: { id: ROOT, slug: ROOT, labelEn: 'Electrical', labelAr: 'كهرباء', icon: 'bolt' },
    });
    await prisma.serviceCategory.create({
      data: {
        id: LEAF,
        slug: LEAF,
        labelEn: 'Rewiring',
        labelAr: 'إعادة تمديد الأسلاك',
        icon: 'bolt',
        parentId: ROOT,
      },
    });

    as(ALICE);
    await upgrade().expect(200);
    aliceProfileId = (await prisma.providerProfile.findFirst({ where: { userId: ALICE } })).id;

    as(BOB);
    await upgrade().expect(200);
    bobProfileId = (await prisma.providerProfile.findFirst({ where: { userId: BOB } })).id;
  });

  afterAll(async () => {
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── 1. a stale tab ───────────────────────────────────────────────────────

  describe('a write carrying a stale version', () => {
    beforeEach(() => as(ALICE));

    it('is refused with 409 rather than silently overwriting', async () => {
      const v = await versionOf();
      await patchStep('IDENTITY', {
        displayName: 'First writer',
        phoneNumber: '+963900000111',
        version: v,
      }).expect(200);

      // The second tab still holds `v`, which is now behind.
      const res = await patchStep('IDENTITY', {
        displayName: 'Stale writer',
        phoneNumber: '+963900000222',
        version: v,
      }).expect(409);
      expect(codeOf(res)).toBe('CONFLICT');
    });

    it('tells the client what to reload with, rather than just failing', async () => {
      const v = await versionOf();
      const res = await patchStep('IDENTITY', {
        displayName: 'Another stale writer',
        phoneNumber: '+963900000333',
        version: v - 1,
      }).expect(409);
      // A bare 409 leaves the client guessing whether to retry; the payload
      // carries the version it should have sent and the current state.
      expect(res.body.error.details).toMatchObject({
        expectedVersion: v,
        receivedVersion: v - 1,
      });
    });

    it('did not apply the stale write', async () => {
      const draft = await getDraft().expect(200);
      const body = JSON.stringify(draft.body);
      expect(body).toContain('First writer');
      expect(body).not.toContain('Stale writer');
      expect(body).not.toContain('Another stale writer');
    });

    it('did not burn a version on the refusals', async () => {
      // A rejected write that still advanced the counter would invalidate
      // every other open tab for no reason.
      const before = await versionOf();
      await patchStep('IDENTITY', {
        displayName: 'Rejected',
        phoneNumber: '+963900000444',
        version: before - 1,
      }).expect(409);
      expect(await versionOf()).toBe(before);
    });
  });

  // ── 2. a double-tapped step button ───────────────────────────────────────

  describe('two identical step writes racing on one version', () => {
    it('lets exactly one win', async () => {
      as(ALICE);
      const v = await versionOf();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          patchStep('IDENTITY', {
            displayName: `Racer ${i}`,
            phoneNumber: '+963900000555',
            version: v,
          }).then((r) => r.status),
        ),
      );
      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(4);
      // No 500: a lost race must be a conflict, not a crash.
      expect(new Set(results)).toEqual(new Set([200, 409]));
    });

    it('advanced the version exactly once', async () => {
      as(ALICE);
      const draft = await getDraft().expect(200);
      // Exactly one of the five racers is on the record.
      const winners = ['Racer 0', 'Racer 1', 'Racer 2', 'Racer 3', 'Racer 4'].filter((n) =>
        JSON.stringify(draft.body).includes(n),
      );
      expect(winners).toHaveLength(1);
    });
  });

  // ── 3. a double-tapped submit ────────────────────────────────────────────

  describe('concurrent submissions of one application', () => {
    it('accepts them all without error', async () => {
      as(ALICE);
      const v = await fillEverything('Alice Nasr', 'JourneyECity');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => postSubmit({ version: v }).then((r) => r.status)),
      );
      // Submission is IDEMPOTENT by construction rather than conflict-based:
      // the conditional claim means the losers return the application's real
      // state instead of an error the provider cannot act on.
      expect(new Set(results)).toEqual(new Set([200]));
    });

    it('recorded exactly one submission', async () => {
      expect(await submissionsOf(aliceProfileId)).toHaveLength(1);
    });

    it('audited the submission exactly once', async () => {
      const audits = await prisma.auditEvent.count({
        where: { userId: ALICE, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(audits).toBe(1);
    });

    it('moved the lifecycle exactly once', async () => {
      const p = await profileOf(aliceProfileId);
      expect(p.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(p.status).toBe('PENDING_REVIEW');
    });
  });

  // ── 4. two accounts ──────────────────────────────────────────────────────

  describe('ownership isolation', () => {
    it('shows each provider only their own application', async () => {
      as(BOB);
      const bob = await getDraft().expect(200);
      // Alice submitted above; Bob has not, and must not inherit her state.
      expect(JSON.stringify(bob.body)).not.toContain('Alice Nasr');

      as(ALICE);
      const alice = await getDraft().expect(200);
      expect(JSON.stringify(alice.body)).not.toContain('Bob Nasr');
    });

    it('keeps the lifecycle axes separate', async () => {
      const a = await profileOf(aliceProfileId);
      const b = await profileOf(bobProfileId);
      expect(a.status).toBe('PENDING_REVIEW');
      expect(b.status).toBe('DRAFT');
      expect(await submissionsOf(bobProfileId)).toHaveLength(0);
    });

    it('does not let one provider’s write reach the other’s draft', async () => {
      as(BOB);
      const v = await versionOf();
      await patchStep('IDENTITY', {
        displayName: 'Bob Nasr',
        phoneNumber: '+963900000777',
        version: v,
      }).expect(200);

      const alice = await profileOf(aliceProfileId);
      expect(alice.displayName).not.toBe('Bob Nasr');
      const bob = await profileOf(bobProfileId);
      expect(bob.displayName).toBe('Bob Nasr');
    });

    it('does not leak the other provider’s version counter', async () => {
      // Two drafts, two independent counters. A shared counter would make one
      // provider's autosave invalidate another's open tab.
      as(ALICE);
      const av = await versionOf();
      as(BOB);
      const bv = await versionOf();
      const rows = await prisma.providerOnboardingDraft.findMany({
        where: { providerProfileId: { in: [aliceProfileId, bobProfileId] } },
        select: { providerProfileId: true, version: true },
      });
      const byProfile = new Map(
        (rows as Array<{ providerProfileId: string; version: number }>).map((r) => [
          r.providerProfileId,
          r.version,
        ]),
      );
      expect(byProfile.get(aliceProfileId)).toBe(av);
      expect(byProfile.get(bobProfileId)).toBe(bv);
    });
  });

  // ── 5. payloads that reach for columns they must not set ─────────────────

  describe('mass assignment', () => {
    beforeEach(() => as(BOB));

    it.each([
      ['status', { status: 'ACTIVE' }],
      ['verified', { verified: true }],
      ['onboardingState', { onboardingState: 'ACCEPTED' }],
      ['verificationState', { verificationState: 'VERIFIED' }],
      ['standingState', { standingState: 'GOOD' }],
      ['userId', { userId: `${P}alice` }],
      ['providerProfileId', { providerProfileId: `${P}alice` }],
    ])('rejects a step payload carrying %s with 400', async (_label, extra) => {
      const v = await versionOf();
      const res = await patchStep('IDENTITY', {
        displayName: 'Bob Nasr',
        phoneNumber: '+963900000777',
        version: v,
        ...extra,
      }).expect(400);
      expect(codeOf(res)).toBe('VALIDATION_ERROR');
    });

    it('rejects them on submit too, not only on the step writes', async () => {
      const v = await versionOf();
      const res = await postSubmit({ version: v, status: 'ACTIVE', verified: true }).expect(400);
      expect(codeOf(res)).toBe('VALIDATION_ERROR');
    });

    it('applied none of it', async () => {
      // The assertion that matters. A 400 that had already written the column
      // would be worse than no validation at all.
      const b = await profileOf(bobProfileId);
      expect(b.status).toBe('DRAFT');
      expect(b.verified).toBe(false);
      expect(b.onboardingState).not.toBe('ACCEPTED');
      expect(b.verificationState).not.toBe('VERIFIED');
      expect(b.userId).toBe(BOB);
      expect(await submissionsOf(bobProfileId)).toHaveLength(0);
    });

    it('did not burn a version on a rejected payload', async () => {
      const before = await versionOf();
      await patchStep('IDENTITY', {
        displayName: 'Bob Nasr',
        phoneNumber: '+963900000777',
        version: before,
        status: 'ACTIVE',
      }).expect(400);
      expect(await versionOf()).toBe(before);
    });
  });

  // ── 6. reads are reads ───────────────────────────────────────────────────

  describe('GET is not a write', () => {
    beforeEach(() => as(BOB));

    /** Everything a stray write would disturb. */
    const snapshot = async () => {
      const p = await profileOf(bobProfileId);
      const draftRow = await prisma.providerOnboardingDraft.findFirst({
        where: { providerProfileId: bobProfileId },
      });
      return {
        status: p.status,
        onboardingState: p.onboardingState,
        profileUpdatedAt: p.updatedAt?.toISOString() ?? null,
        draftVersion: draftRow?.version ?? null,
        draftUpdatedAt: draftRow?.updatedAt?.toISOString() ?? null,
        submissions: (await submissionsOf(bobProfileId)).length,
        audits: await prisma.auditEvent.count({ where: { userId: BOB } }),
      };
    };

    it('has a snapshot that actually detects a write', async () => {
      // THE POSITIVE CONTROL. Without it, the next test passes for free if the
      // snapshot happens to capture nothing that ever moves — and a read-only
      // assertion that cannot fail is worse than no assertion, because it
      // reads like coverage.
      const before = await snapshot();
      const v = await versionOf();
      await patchStep('IDENTITY', {
        displayName: 'Bob Nasr',
        phoneNumber: '+963900000888',
        version: v,
      }).expect(200);
      const after = await snapshot();

      expect(after).not.toEqual(before);
      expect(after.draftVersion).toBe((before.draftVersion ?? 0) + 1);
      expect(after.draftUpdatedAt).not.toBe(before.draftUpdatedAt);
    });

    it('leaves the version, the timestamps and the row counts alone', async () => {
      const before = await snapshot();
      for (let i = 0; i < 3; i++) {
        await getDraft().expect(200);
        await getHub().expect(200);
        await getReview().expect(200);
      }
      // `updatedAt` is @updatedAt, so a read that touched the row for any
      // reason — a lazy backfill, a "seen at" stamp, an autovivified draft —
      // would move it. Included precisely because that is the kind of write
      // nobody intends.
      expect(await snapshot()).toEqual(before);
    });

    it('is repeatable — the same read answers the same thing', async () => {
      const a = await getHub().expect(200);
      const b = await getHub().expect(200);
      expect(b.body).toEqual(a.body);
    });
  });
});
