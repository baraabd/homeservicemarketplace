/* eslint-disable @typescript-eslint/no-require-imports -- Load database services only inside the integration gate. */
import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@homeservicemarketplace/database';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// Actual controller, DTO validation, permission reads, repository, serializer,
// capability policy and PostgreSQL. The harness supplies an authenticated
// principal; this suite does not test JWT issuance or browser cookies.
dbDescribe('Admin provider directory contract (real HTTP and PostgreSQL)', () => {
  const prefix = fixturePrefix('admin-directory');
  const reviewerId = `${prefix}reviewer`;
  const roleId = `${prefix}role`;
  const ids = ['old', 'new', 'draft', 'active', 'returned'].map((name) => `${prefix}${name}`);
  const submittedAt = new Date('2026-01-05T09:30:00Z');
  let prisma: PrismaClient;
  let app: INestApplication;
  let lock: HeldLock | undefined;
  let actor: { id: string; roles: string[] } | null;

  class PrincipalGuard {
    canActivate(context: ExecutionContext) {
      if (!actor) throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
      context.switchToHttp().getRequest().user = actor;
      return true;
    }
  }

  async function cleanup() {
    if (!prisma) return;
    await prisma.providerPortfolioItem.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: prefix } } });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.verificationCase.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerProfile.deleteMany({ where: { id: { in: ids } } });
    await prisma.verificationRequirementPolicy.deleteMany({
      where: { version: `${prefix}policy` },
    });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: prefix } } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  }

  beforeAll(async () => {
    lock = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'seed', mode: 'shared' },
      { resource: 'workAccessGrants', mode: 'shared' },
      { resource: 'mediaAssets', mode: 'shared' },
    ]);
    prisma = (
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')
    ).prisma;
    await cleanup();
    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const {
      AdminVerificationController,
    } = require('../../src/modules/admin/verification/admin-verification.controller');
    const {
      AdminVerificationService,
    } = require('../../src/modules/admin/verification/admin-verification.service');
    const {
      AdminVerificationCaseService,
    } = require('../../src/modules/admin/verification/admin-verification-case.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const { AdminAuditService } = require('../../src/modules/admin/admin-audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const config = {
      isProduction: false,
      get: (key: string) => ['VERIFICATION_ENFORCED', 'WORK_ACCESS_ENFORCED'].includes(key),
    };
    const module = await Test.createTestingModule({
      controllers: [AdminVerificationController],
      providers: [
        Reflector,
        ProviderProfileRepository,
        RoleRepository,
        PermissionResolverService,
        AdminVerificationService,
        ProviderCapabilityService,
        SecurityEventsBus,
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: AppConfigService, useValue: config },
        { provide: RedisService, useValue: {} }, // Sensitive reads bypass Redis.
        ...[
          AdminVerificationCaseService,
          NotificationsService,
          AdminAuditService,
          AuditEventRepository,
          TransactionRunner,
        ].map((provide) => ({ provide, useValue: {} })),
        { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(PrincipalGuard)
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    await prisma.user.createMany({
      data: [...ids, reviewerId, `${prefix}other`].map((id) => ({
        id,
        email: `${id}@example.test`,
        firstName: id === reviewerId ? 'Review' : 'Test',
        lastName: 'Person',
        status: 'ACTIVE',
      })),
    });
    await prisma.role.create({
      data: { id: roleId, name: roleId, description: 'Directory contract fixture' },
    });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'user:read:any' },
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId: reviewerId, roleId } });
    await prisma.providerProfile.createMany({
      data: ids.map((id, index) => ({
        id,
        userId: id,
        displayName: `${prefix} Provider ${index}`,
        initials: 'TP',
        status:
          index < 2
            ? 'PENDING_REVIEW'
            : index === 2
              ? 'DRAFT'
              : index === 3
                ? 'ACTIVE'
                : 'REJECTED',
        onboardingState:
          index < 2 ? 'SUBMITTED' : index === 2 ? 'DRAFT' : index === 3 ? 'ACCEPTED' : 'RETURNED',
        verificationState: index < 2 ? 'PENDING' : index === 3 ? 'VERIFIED' : null,
        standingState: 'GOOD',
        serviceAreaCountryCode: 'XQ',
        submittedForReviewAt:
          index === 2 ? null : new Date(submittedAt.getTime() + index * 86_400_000),
        reviewedAt: index > 2 ? new Date('2026-02-01T00:00:00Z') : null,
        reviewedByUserId: index > 2 ? reviewerId : null,
      })),
    });
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: `${prefix}policy`,
        requirements: { verificationRequired: true, documents: [] },
        retiredAt: new Date(),
      },
    });
    // Historical assignment must not make the newer active case belong to this admin.
    await prisma.verificationCase.createMany({
      data: [
        {
          id: `${prefix}old-case`,
          providerProfileId: ids[0],
          state: 'IN_REVIEW',
          policyVersion: `${prefix}policy`,
          submittedAt,
          assignedToUserId: reviewerId,
        },
        {
          id: `${prefix}past-case`,
          providerProfileId: ids[1],
          state: 'REJECTED',
          policyVersion: `${prefix}policy`,
          assignedToUserId: reviewerId,
        },
        {
          id: `${prefix}new-case`,
          providerProfileId: ids[1],
          state: 'SUBMITTED',
          policyVersion: `${prefix}policy`,
          assignedToUserId: `${prefix}other`,
        },
      ],
    });
    for (const [index, state] of (
      ['PENDING', 'APPROVED', 'REJECTED', 'PENDING'] as const
    ).entries()) {
      const assetId = `${prefix}asset-${index}`;
      await prisma.mediaAsset.create({
        data: {
          id: assetId,
          ownerUserId: ids[0],
          storageKey: `${prefix}/${index}`,
          declaredMimeType: 'image/jpeg',
          detectedMimeType: 'image/jpeg',
          uploadCompletedAt: new Date(),
          sizeBytes: 12,
          visibility: 'RESTRICTED',
          scanState: 'CLEAN',
        },
      });
      await prisma.providerPortfolioItem.create({
        data: {
          id: `${prefix}item-${index}`,
          providerProfileId: ids[0],
          mediaAssetId: assetId,
          moderationState: state,
          deletedAt: index === 3 ? new Date() : null,
        },
      });
    }
    await prisma.providerWorkAccessGrant.createMany({
      data: [
        {
          id: `${prefix}pending-grant`,
          providerProfileId: ids[0],
          reason: `${prefix}pending`,
          status: 'ACTIVE',
          grantedAt: new Date('2026-01-01'),
        },
        {
          id: `${prefix}active-grant`,
          providerProfileId: ids[3],
          reason: `${prefix}active`,
          status: 'ACTIVE',
          grantedAt: new Date('2026-01-01'),
        },
      ],
    });
    actor = { id: reviewerId, roles: ['admin'] };
  });

  afterAll(async () => {
    try {
      await app?.close();
      await cleanup();
    } finally {
      await lock?.release();
      await prisma?.$disconnect();
    }
  });

  const list = (query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get('/v1/admin/providers')
      .query({ query: prefix, status: 'ALL', ...query });

  it('serializes real submission timestamps and stable oldest-first pages with exact totals', async () => {
    const first = await list({
      status: 'PENDING_REVIEW',
      sort: 'SUBMITTED_OLDEST',
      limit: 1,
    }).expect(200);
    expect(first.body.items.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
    expect(first.body.items[0].submittedForReviewAt).toBe(submittedAt.toISOString());
    expect(first.body).toMatchObject({
      total: 2,
      nextCursor: ids[0],
      counts: { all: 5, pendingReview: 2, active: 1, returned: 1, suspended: 0, draft: 1 },
    });
    const second = await list({
      status: 'PENDING_REVIEW',
      sort: 'SUBMITTED_OLDEST',
      limit: 1,
      cursor: first.body.nextCursor,
    }).expect(200);
    expect(second.body.items.map((row: { id: string }) => row.id)).toEqual([ids[1]]);
    expect(second.body).toMatchObject({ total: 2, nextCursor: null });
    const draft = await list({ status: 'DRAFT' }).expect(200);
    expect(draft.body.items[0].submittedForReviewAt).toBeNull();
  });

  it('projects independent account, identity, portfolio and canonical work permission facts', async () => {
    const { body } = await request(app.getHttpServer())
      .get(`/v1/admin/providers/${ids[0]}`)
      .expect(200);
    expect(body).toMatchObject({
      account: { status: 'ACTIVE', isActive: true, deletedAt: null },
      onboardingState: 'SUBMITTED',
      verificationState: 'PENDING',
      portfolio: { total: 3, pending: 1, approved: 1, rejected: 1 },
      verificationCase: { assignedTo: { id: reviewerId, name: 'Review Person' } },
      workAccess: { hasLiveGrant: true, canWork: false, denialReason: 'AWAITING_REVIEW' },
    });
    expect(body.attentionReasons).toEqual(
      expect.arrayContaining([
        'IDENTITY_IN_REVIEW',
        'PORTFOLIO_REVIEW_REQUIRED',
        'APPLICATION_REVIEW_REQUIRED',
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('storageKey');
    const active = await list({ status: 'ACTIVE' }).expect(200);
    expect(active.body.items[0].workAccess).toEqual({
      hasLiveGrant: true,
      canWork: true,
      denialReason: null,
    });
    expect(active.body.items[0].reviewedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('filters current identity assignment, state, portfolio, country and date on the server', async () => {
    const mine = await list({
      assignment: 'MINE',
      identityState: 'PENDING',
      portfolioState: 'PENDING',
      country: 'xq',
    }).expect(200);
    expect(mine.body.items.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
    expect(mine.body.total).toBe(1);
    const unassigned = await list({ assignment: 'UNASSIGNED' }).expect(200);
    expect(unassigned.body.total).toBe(3);
    const range = await list({
      submittedFrom: '2026-01-06',
      submittedTo: '2026-01-06',
    }).expect(200);
    expect(range.body.items.map((row: { id: string }) => row.id)).toEqual([ids[1]]);
    const unverified = await list({ identityState: 'UNVERIFIED' }).expect(200);
    expect(unverified.body.total).toBe(2);
  });

  it('rejects unusable filters instead of silently broadening the queue', async () => {
    await list({ submittedFrom: '2026-02-01', submittedTo: '2026-01-01' }).expect(400);
    await list({ submittedFrom: '2026-02-31' }).expect(400);
    await list({ identityState: 'invented' }).expect(400);
    await list({ assignment: 'ANOTHER_USER' }).expect(400);
    await list({ country: 'Syria' }).expect(400);
  });

  it('never mistakes a live grant for work permission or an expired grant for live access', async () => {
    await prisma.user.update({ where: { id: ids[3] }, data: { status: 'SUSPENDED' } });
    try {
      const suspended = await list({ status: 'ACTIVE' }).expect(200);
      expect(suspended.body.items[0].workAccess).toEqual({
        hasLiveGrant: true,
        canWork: false,
        denialReason: 'ACCOUNT_INELIGIBLE',
      });
    } finally {
      await prisma.user.update({ where: { id: ids[3] }, data: { status: 'ACTIVE' } });
    }
    await prisma.providerWorkAccessGrant.update({
      where: { id: `${prefix}active-grant` },
      data: { expiresAt: new Date('2026-01-02') },
    });
    try {
      const expired = await list({ status: 'ACTIVE' }).expect(200);
      expect(expired.body.items[0].workAccess).toEqual({
        hasLiveGrant: false,
        canWork: false,
        denialReason: 'NO_WORK_ACCESS',
      });
    } finally {
      await prisma.providerWorkAccessGrant.update({
        where: { id: `${prefix}active-grant` },
        data: { expiresAt: null },
      });
    }
  });

  it('rechecks directory permission from PostgreSQL on the next request', async () => {
    await prisma.userRole.deleteMany({ where: { userId: reviewerId, roleId } });
    try {
      await list().expect(403);
    } finally {
      await prisma.userRole.create({ data: { userId: reviewerId, roleId } });
    }
  });
});
