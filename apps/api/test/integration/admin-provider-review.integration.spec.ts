/* eslint-disable @typescript-eslint/no-require-imports -- Database services load only inside the DB gate. */
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
import type { PrismaClient, Prisma } from '@homeservicemarketplace/database';
import type {
  AdminProviderReview,
  ApproveAdminProviderReviewRequest,
} from '@homeservicemarketplace/contracts';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Real HTTP, repositories, permissions, PostgreSQL transactions and capability
// policy. The harness supplies the authenticated principal and bypasses CSRF;
// it does not exercise token issuance or browser cookies. No production guard
// or decision service is replaced. Fixtures do not pretend to be onboarding.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(180_000);
let actor: { id: string; roles: string[] } | null = null;
class PrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (!actor) throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    context.switchToHttp().getRequest().user = actor;
    return true;
  }
}
class CsrfHarnessGuard implements CanActivate {
  canActivate() {
    return true;
  }
}

dbDescribe('Admin provider review workspace (real PostgreSQL and HTTP)', () => {
  const prefix = fixturePrefix('admin-review');
  const owner = `${prefix}owner`;
  const reviewer = `${prefix}reviewer`;
  const roleId = `${prefix}role`;
  const profileId = `${prefix}provider`;
  const caseId = `${prefix}case`;
  const submissionId = `${prefix}submission`;
  const categoryId = `${prefix}category`;
  const applicationId = `${prefix}application`;
  const assetId = `${prefix}asset`;
  const policy = `2026.09-${prefix}-v1`;
  const keys = ['user:read:any', 'verification:decide', 'verification:evidence:view'];
  let prisma: PrismaClient;
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let locks: HeldLock | undefined;
  let outbox: import('../../src/infrastructure/outbox/outbox.repository').OutboxRepository;
  let capture: typeof import('../../src/modules/provider/onboarding/review/provider-review-snapshot').readProviderReviewSnapshot;

  const asAdmin = () => {
    actor = { id: reviewer, roles: ['admin'] };
  };
  const getReview = () => request(http).get(`/v1/admin/providers/${profileId}/review`);
  const approve = (body: ApproveAdminProviderReviewRequest) =>
    request(http).post(`/v1/admin/providers/${profileId}/review/approve`).send(body);
  const command = (
    review: AdminProviderReview,
    idempotencyKey = `${prefix}decision`,
  ): ApproveAdminProviderReviewRequest => ({
    submissionId: review.submission!.id,
    expectedRevision: review.revision,
    idempotencyKey,
    reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
  });
  const read = async (): Promise<AdminProviderReview> => (await getReview().expect(200)).body;
  const persisted = () =>
    Promise.all([
      prisma.providerProfile.findUniqueOrThrow({ where: { id: profileId } }),
      prisma.providerOnboardingSubmission.findUniqueOrThrow({ where: { id: submissionId } }),
      prisma.verificationCase.findUniqueOrThrow({ where: { id: caseId } }),
      prisma.providerWorkAccessGrant.findMany({ where: { providerProfileId: profileId } }),
      prisma.notification.findMany({ where: { userId: owner } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: { startsWith: prefix } } }),
    ]);

  async function cleanup() {
    if (!prisma) return;
    await prisma.notification.deleteMany({ where: { userId: { startsWith: prefix } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: prefix } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { startsWith: prefix } } });
    await prisma.verificationDecision.deleteMany({ where: { caseId: { startsWith: prefix } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { startsWith: prefix } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: prefix } } });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: profileId } });
    await prisma.verificationCase.deleteMany({ where: { providerProfileId: profileId } });
    await prisma.providerProfile.deleteMany({ where: { id: profileId } });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: prefix } } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'outbox', mode: 'shared' },
      { resource: 'seed', mode: 'shared' },
      { resource: 'workAccessGrants', mode: 'shared' },
      { resource: 'mediaAssets', mode: 'shared' },
    ]);
    prisma = (
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')
    ).prisma;
    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      ProviderCategoryApplicationRepository,
    } = require('../../src/infrastructure/persistence/services/provider-category-application.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { AdminAuditService } = require('../../src/modules/admin/admin-audit.service');
    const {
      AdminProviderReviewController,
    } = require('../../src/modules/admin/provider-review/provider-review.controller');
    const {
      AdminProviderReviewService,
    } = require('../../src/modules/admin/provider-review/provider-review.service');
    const {
      AdminProviderReviewRepository,
    } = require('../../src/modules/admin/provider-review/provider-review.repository');
    const {
      AdminVerificationCaseService,
    } = require('../../src/modules/admin/verification/admin-verification-case.service');
    const {
      AdminCategoryApplicationsController,
    } = require('../../src/modules/admin/category-applications/admin-category-applications.controller');
    const {
      AdminCategoryApplicationsService,
    } = require('../../src/modules/admin/category-applications/admin-category-applications.service');
    const {
      VerificationCaseWorkflowService,
    } = require('../../src/modules/provider/verification/case/verification-case-workflow.service');
    const {
      ProviderVerificationCaseService,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.service');
    const {
      ProviderVerificationCaseController,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.controller');
    const {
      VerificationSettingsService,
    } = require('../../src/modules/provider/verification/verification-settings.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    capture =
      require('../../src/modules/provider/onboarding/review/provider-review-snapshot').readProviderReviewSnapshot;
    const config = {
      isProduction: false,
      get: (key: string) =>
        ['WORK_ACCESS_ENFORCED', 'VERIFICATION_ENFORCED'].includes(key) ? true : undefined,
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminProviderReviewController,
        AdminCategoryApplicationsController,
        ProviderVerificationCaseController,
      ],
      providers: [
        AdminProviderReviewService,
        AdminProviderReviewRepository,
        AdminVerificationCaseService,
        AdminCategoryApplicationsService,
        ProviderCategoryApplicationRepository,
        VerificationCaseWorkflowService,
        ProviderVerificationCaseService,
        VerificationSettingsService,
        ProviderCapabilityService,
        PermissionResolverService,
        RoleRepository,
        ProviderProfileRepository,
        AdminAuditService,
        AuditService,
        AuditEventRepository,
        PlatformSettingRepository,
        TransactionRunner,
        OutboxRepository,
        SecurityEventsBus,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: 'AppConfigService', useValue: config },
        // Any accidental cache use fails this suite: sensitive permissions must
        // come from current membership, even with a stale admin role claim.
        {
          provide: RedisService,
          useValue: {
            getClient: () => {
              throw new Error('Unexpected permission cache access');
            },
          },
        },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(PrincipalGuard)
      .overrideGuard(CsrfGuard)
      .useClass(CsrfHarnessGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    http = app.getHttpServer();
    outbox = app.get(OutboxRepository);
    await cleanup();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: policy } });
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: policy,
        country: 'ZZ',
        providerType: 'INDIVIDUAL',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        // Case tests use the exact stamped policy. Retirement keeps this fixture
        // out of the live-policy unique index and other suites' policy resolver.
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        retiredAt: new Date('2026-01-02T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await prisma.verificationRequirementPolicy.update({
      where: { version: policy },
      data: { retiredAt: new Date('2026-01-02T00:00:00Z') },
    });
    for (const id of [owner, reviewer])
      await prisma.user.create({
        data: {
          id,
          email: `${id}@review.test`,
          firstName: 'Review',
          lastName: 'Fixture',
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
    await prisma.role.create({ data: { id: roleId, name: roleId } });
    for (const key of keys) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userRole.create({ data: { userId: reviewer, roleId } });
    await prisma.serviceCategory.create({
      data: {
        id: categoryId,
        slug: categoryId,
        labelEn: 'Home electrical work',
        labelAr: 'الأعمال الكهربائية المنزلية',
        icon: 'bolt',
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: profileId,
        userId: owner,
        displayName: 'Reviewed Electrician',
        initials: 'RE',
        providerType: 'INDIVIDUAL',
        status: 'PENDING_REVIEW',
        onboardingState: 'SUBMITTED',
        verificationState: 'PENDING',
        standingState: 'GOOD',
        phoneNumber: '+963900000111',
        headline: 'Residential electrical maintenance',
        bio: 'Experienced residential electrician with detailed references and a complete service application.',
        serviceAreaCountry: 'Test country',
        serviceAreaCountryCode: 'ZZ',
        serviceAreaCity: 'Review City',
        serviceAreaRadiusKm: 20,
        primaryServiceCategoryId: categoryId,
        yearsOfExperience: 7,
        transportModes: ['CAR'],
        acceptedConsentVersion: 'v1',
        consentAcceptedAt: new Date('2026-01-01T00:00:00Z'),
        submittedForReviewAt: new Date(),
      },
    });
    await prisma.providerProfileServiceCategory.create({
      data: { providerProfileId: profileId, serviceCategoryId: categoryId },
    });
    await prisma.providerAvailabilityInterval.create({
      data: {
        providerProfileId: profileId,
        dayOfWeek: 1,
        startMinute: 540,
        endMinute: 1020,
        timezone: 'Asia/Damascus',
      },
    });
    await prisma.verificationCase.create({
      data: {
        id: caseId,
        providerProfileId: profileId,
        policyVersion: policy,
        state: 'SUBMITTED',
        country: 'ZZ',
        providerType: 'INDIVIDUAL',
        submittedAt: new Date(),
        requirementsSnapshot: {
          policyVersion: policy,
          verificationRequired: true,
          subjectScope: {
            countryCode: 'ZZ',
            providerType: 'INDIVIDUAL',
            categoryIds: [categoryId],
          },
          requirements: [
            { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: policy },
          ],
        },
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        ownerUserId: owner,
        verificationCaseId: caseId,
        visibility: 'RESTRICTED',
        storageKey: `verification/${caseId}/${assetId}.pdf`,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'a'.repeat(64),
        scanState: 'CLEAN',
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.verificationDocument.create({
      data: {
        id: `${prefix}document`,
        caseId,
        mediaAssetId: assetId,
        kind: 'INDIVIDUAL_IDENTITY',
        uploadedByUserId: owner,
      },
    });
    const snapshot = await prisma.$transaction((tx) => capture(tx, profileId));
    await prisma.providerOnboardingSubmission.create({
      data: {
        id: submissionId,
        providerProfileId: profileId,
        policyVersion: 'onboarding-v1',
        snapshot: {},
        reviewSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        submittedByUserId: owner,
      },
    });
    asAdmin();
  });

  afterAll(async () => {
    await cleanup();
    if (prisma)
      await prisma.verificationRequirementPolicy.deleteMany({ where: { version: policy } });
    await app?.close();
    await prisma?.$disconnect();
    await locks?.release();
  });

  it('returns complete submitted metadata without evidence credentials and keeps it immutable', async () => {
    const review = await read();
    expect(review.availableActions).toEqual(expect.arrayContaining(['approve', 'requestChanges']));
    expect(review.submission?.snapshot).toMatchObject({
      schemaVersion: 1,
      profile: { yearsOfExperience: 7, phoneVerifiedAt: null },
      services: { primarySpecialtyId: categoryId },
      workArea: { countryCode: 'ZZ', radiusKm: 20 },
      availability: {
        intervals: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' }],
      },
      consent: { acceptedVersion: 'v1' },
      portfolio: [],
    });
    expect(JSON.stringify(review)).not.toContain('storageKey');
    expect(JSON.stringify(review)).not.toContain(`verification/${caseId}`);
    expect(review.canWork).toBe(false);
    await prisma.providerProfile.update({
      where: { id: profileId },
      data: { displayName: 'Changed after submission' },
    });
    const changed = await read();
    expect(changed.submission?.snapshot).toEqual(review.submission?.snapshot);
    expect(changed.current.profile.displayName).toBe('Changed after submission');
    expect(changed.blockers).toContainEqual({
      code: 'SUBMITTED_CONTENT_CHANGED',
      taskId: 'REVIEW_SUBMISSION',
    });
    await approve(command(review)).expect(409);
  });

  it('requires explicit specialty moderation, then rejects the previously viewed revision', async () => {
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: profileId },
    });
    await prisma.providerCategoryApplication.create({
      data: {
        id: applicationId,
        providerProfileId: profileId,
        serviceCategoryId: categoryId,
        status: 'PENDING',
      },
    });
    const snapshot = await prisma.$transaction((tx) => capture(tx, profileId));
    await prisma.providerOnboardingSubmission.update({
      where: { id: submissionId },
      data: { reviewSnapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
    const before = await read();
    expect(before.availableActions).not.toContain('approve');
    expect(before.blockers.some((blocker) => blocker.code === 'CATEGORY_REVIEW_REQUIRED')).toBe(
      true,
    );
    await approve(command(before)).expect(409);
    await request(http)
      .patch(`/v1/admin/category-applications/${applicationId}/review`)
      .send({ action: 'APPROVE' })
      .expect(200);
    await approve(command(before)).expect(409);
    const current = await read();
    expect(current.availableActions).toContain('approve');
    await approve(command(current)).expect(200);
  });

  it('commits application, identity, grant, audit and notification together and replays exactly once', async () => {
    const input = {
      ...command(await read()),
      note: 'Internal risk assessment must remain private.',
    };
    const first = await approve(input).expect(200);
    expect(first.body).toMatchObject({
      changed: true,
      review: {
        canWork: true,
        provider: {
          providerStatus: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          verificationState: 'VERIFIED',
        },
      },
    });
    expect(first.body.review.capabilities.allowed).toContain('SUBMIT_BID');
    const second = await approve(input).expect(200);
    expect(second.body.changed).toBe(false);
    const [profile, submission, kase, grants, notifications, events] = await persisted();
    expect(profile.status).toBe('ACTIVE');
    expect(submission.reviewedRevision).toBe(input.expectedRevision);
    expect(submission.decisionIdempotencyKey).toBe(input.idempotencyKey);
    expect(kase.state).toBe('VERIFIED');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ caseId, status: 'ACTIVE', revokedAt: null });
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain(input.note);
    expect(events.filter((event) => event.eventType === 'provider.review.decided')).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: { userId: reviewer, type: 'ADMIN_PROVIDER_APPROVED' },
      }),
    ).toBe(1);
    await approve({ ...input, note: 'Different content with the same receipt' }).expect(409);
  });

  it('persists actionable task feedback separately from private reviewer notes without granting work', async () => {
    const review = await read();
    const { reasonCode: _reason, ...base } = command(review);
    const response = await request(http)
      .post(`/v1/admin/providers/${profileId}/review/request-changes`)
      .send({
        ...base,
        note: 'Private investigator note',
        feedback: [
          {
            taskId: 'WORK_AREA',
            field: 'radiusKm',
            reasonCode: 'DETAIL_REQUIRED',
            providerMessage: 'Please confirm the city and service radius.',
          },
        ],
      })
      .expect(200);
    expect(response.body.review.submission.feedback.items[0]).toMatchObject({
      taskId: 'WORK_AREA',
      providerMessage: 'Please confirm the city and service radius.',
    });
    expect(JSON.stringify(response.body)).not.toContain('Private investigator note');
    const [profile, submission, kase, grants, notifications] = await persisted();
    expect(profile).toMatchObject({ status: 'REJECTED', onboardingState: 'RETURNED' });
    expect(submission.decisionNote).toBe('Private investigator note');
    expect(kase.state).toBe('SUBMITTED');
    expect(grants).toHaveLength(0);
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain('Private investigator note');
    expect((await read()).canWork).toBe(false);
  });

  it.each(['SUBMITTED', 'IN_REVIEW'] as const)(
    'returns %s identity evidence for provider correction in the same decision',
    async (state) => {
      await prisma.verificationCase.update({ where: { id: caseId }, data: { state } });
      const { reasonCode: _reason, ...base } = command(await read());
      await request(http)
        .post(`/v1/admin/providers/${profileId}/review/request-changes`)
        .send({
          ...base,
          note: 'Internal reviewer context remains private',
          feedback: [
            {
              taskId: 'BASICS_IDENTITY',
              field: 'verificationDocuments',
              reasonCode: 'DOCUMENT_ILLEGIBLE',
              providerMessage: 'Replace the blurred identity document with a clear copy.',
            },
          ],
        })
        .expect(200);
      const [profile, submission, kase, grants, notifications] = await persisted();
      expect(profile.onboardingState).toBe('RETURNED');
      expect(submission.decision).toBe('RETURNED');
      expect(kase.state).toBe('ACTION_REQUIRED');
      expect(grants).toHaveLength(0);
      expect(notifications).toHaveLength(1);
      expect(
        await prisma.verificationDecision.count({ where: { caseId, outcome: 'ACTION_REQUIRED' } }),
      ).toBe(1);
      actor = { id: owner, roles: ['provider'] };
      const own = await request(http).get('/v1/me/provider/verification/case').expect(200);
      // ACTION_REQUIRED is the upload service's evidence-accepting state. The
      // real owner read also offers submit, so the returned case can leave it.
      expect(own.body.case).toMatchObject({
        id: caseId,
        state: 'ACTION_REQUIRED',
        availableActions: ['submit'],
      });
      expect(JSON.stringify(own.body)).not.toContain('Internal reviewer context remains private');
    },
  );

  it('reopens verification for an evidence correction after identity approval and closes the previous grant', async () => {
    await prisma.verificationCase.update({
      where: { id: caseId },
      data: { state: 'VERIFIED', decidedAt: new Date() },
    });
    await prisma.providerProfile.update({
      where: { id: profileId },
      data: { verificationState: 'VERIFIED', verified: true },
    });
    await prisma.providerWorkAccessGrant.create({
      data: {
        id: `${prefix}previous-grant`,
        providerProfileId: profileId,
        caseId,
        status: 'ACTIVE',
        reason: 'Verified evidence fixture',
        source: 'VERIFIED_DOCUMENTS',
        grantedAt: new Date(),
        grantedByUserId: reviewer,
      },
    });
    const { reasonCode: _reason, ...base } = command(await read());
    await request(http)
      .post(`/v1/admin/providers/${profileId}/review/request-changes`)
      .send({
        ...base,
        feedback: [
          {
            taskId: 'BASICS_IDENTITY',
            field: 'identityDocument',
            reasonCode: 'DOCUMENT_ILLEGIBLE',
            providerMessage: 'Upload a legible replacement identity document.',
          },
        ],
      })
      .expect(200);
    const [profile, submission, kase, grants, notifications] = await persisted();
    expect(profile).toMatchObject({ onboardingState: 'RETURNED', verificationState: 'EXPIRED' });
    expect(submission.decision).toBe('RETURNED');
    expect(kase.state).toBe('EXPIRED');
    expect(grants).toHaveLength(1);
    expect(grants[0].status).toBe('EXPIRED');
    expect(grants[0].revokedAt).toBeNull(); // Renewal expires access; it is not a revocation sanction.
    expect(notifications).toHaveLength(1);
    // Publish only this isolated fixture scope to prove the normal provider
    // create endpoint can now start a fresh pinned case. Other cases remain
    // judged against their original immutable policy snapshots.
    await prisma.verificationRequirementPolicy.update({
      where: { version: policy },
      data: { retiredAt: null },
    });
    actor = { id: owner, roles: ['provider'] };
    const next = await request(http)
      .post('/v1/me/provider/verification/case')
      .send({ idempotencyKey: `${prefix}replacement` })
      .expect(200);
    expect(next.body.created).toBe(true);
    expect(next.body.case.id).not.toBe(caseId);
    expect(next.body.case).toMatchObject({
      state: 'DRAFT',
      policyVersion: policy,
      availableActions: ['submit'],
    });
    expect(
      await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: profileId, status: 'ACTIVE', revokedAt: null },
      }),
    ).toBe(0);
  });

  it.each(['PENDING', 'QUARANTINED', 'SCAN_FAILED'] as const)(
    'refuses approval while evidence is %s',
    async (scanState) => {
      await prisma.mediaAsset.update({ where: { id: assetId }, data: { scanState } });
      const review = await read();
      expect(review.availableActions).not.toContain('approve');
      expect(review.permissions.canViewEvidence).toBe(true);
      expect(review.verification?.documents[0]?.viewable).toBe(false);
      await approve(command(review)).expect(409);
      expect(
        await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: profileId } }),
      ).toBe(0);
    },
  );

  it('refuses a country change, even when the earlier evidence remains clean', async () => {
    await prisma.providerProfile.update({
      where: { id: profileId },
      data: { serviceAreaCountryCode: 'SE' },
    });
    const review = await read();
    expect(review.availableActions).not.toContain('approve');
    await approve(command(review)).expect(409);
  });

  it('rejects evidence replacement even when the case state is unchanged', async () => {
    const viewed = await read();
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { sha256: 'b'.repeat(64) } });
    expect((await prisma.verificationCase.findUniqueOrThrow({ where: { id: caseId } })).state).toBe(
      'SUBMITTED',
    );
    await approve(command(viewed)).expect(409);
    const refreshed = await read();
    expect(refreshed.revision).not.toBe(viewed.revision);
    expect(
      await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: profileId } }),
    ).toBe(0);
  });

  it('validates correction tasks and non-empty messages before writing a decision', async () => {
    const { reasonCode: _reason, ...base } = command(await read());
    for (const feedback of [
      [],
      [{ taskId: 'WORK_AREA', reasonCode: 'DETAIL_REQUIRED', providerMessage: '   ' }],
      [
        {
          taskId: 'UNKNOWN_TASK',
          reasonCode: 'DETAIL_REQUIRED',
          providerMessage: 'Change this detail.',
        },
      ],
    ]) {
      await request(http)
        .post(`/v1/admin/providers/${profileId}/review/request-changes`)
        .send({ ...base, feedback })
        .expect(400);
    }
    expect(
      (await prisma.providerOnboardingSubmission.findUniqueOrThrow({ where: { id: submissionId } }))
        .decidedAt,
    ).toBeNull();
    expect(await prisma.notification.count({ where: { userId: owner } })).toBe(0);
  });

  it('sees permission removal immediately despite a stale admin role claim', async () => {
    const review = await read();
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'verification:decide' },
    });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
    });
    const readOnly = await read();
    expect(readOnly.availableActions).toEqual([]);
    await approve(command(review)).expect(403);
    await prisma.userRole.deleteMany({ where: { userId: reviewer } });
    await getReview().expect(403);
  });

  it('refuses anonymous, non-admin, self-review and restricted accounts', async () => {
    const input = command(await read());
    actor = null;
    await getReview().expect(401);
    actor = { id: reviewer, roles: ['provider'] };
    await getReview().expect(403);
    await prisma.userRole.create({ data: { userId: owner, roleId } });
    actor = { id: owner, roles: ['admin'] };
    expect((await read()).blockers).toContainEqual({ code: 'SELF_REVIEW' });
    await approve(input).expect(409);
    asAdmin();
    await prisma.user.update({
      where: { id: owner },
      data: { status: 'SUSPENDED', isActive: false },
    });
    await approve(command(await read())).expect(409);
    expect(
      await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: profileId } }),
    ).toBe(0);
  });

  it('rolls back every state and durable side effect when the last outbox write fails', async () => {
    const input = command(await read());
    const original = outbox.enqueue.bind(outbox);
    jest.spyOn(outbox, 'enqueue').mockImplementation(async (event, tx) => {
      if (event.eventType === 'provider.review.decided')
        throw new Error('Synthetic late transaction failure');
      return original(event, tx);
    });
    await approve(input).expect(500);
    const [profile, submission, kase, grants, notifications, events] = await persisted();
    expect(profile).toMatchObject({ status: 'PENDING_REVIEW', onboardingState: 'SUBMITTED' });
    expect(submission.decidedAt).toBeNull();
    expect(kase.state).toBe('SUBMITTED');
    expect(grants).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(await prisma.verificationDecision.count({ where: { caseId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { userId: reviewer } })).toBe(0);
  });

  it('allows one winner when two reviewers decide the same submitted revision concurrently', async () => {
    const review = await read();
    const responses = await Promise.all([
      approve(command(review, `${prefix}race-a`)),
      approve(command(review, `${prefix}race-b`)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: profileId } }),
    ).toBe(1);
    expect(await prisma.notification.count({ where: { userId: owner } })).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { userId: reviewer, type: 'ADMIN_PROVIDER_APPROVED' },
      }),
    ).toBe(1);
  });

  it('does not fabricate a complete historic application or allow cross-provider submission IDs', async () => {
    const review = await read();
    await approve({ ...command(review), submissionId: `${prefix}unknown-submission` }).expect(404);
    await prisma.providerOnboardingSubmission.update({
      where: { id: submissionId },
      data: {
        reviewSnapshot: (
          require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')
        ).Prisma.DbNull,
      },
    });
    const historic = await read();
    expect(historic.submission?.snapshot).toBeNull();
    expect(historic.blockers).toContainEqual({ code: 'SNAPSHOT_UNAVAILABLE' });
    await approve(command(historic)).expect(409);
  });
});
