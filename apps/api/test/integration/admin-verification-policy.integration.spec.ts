/* eslint-disable @typescript-eslint/no-require-imports -- Database dependencies load only inside the integration gate. */
import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { ExecutionContext, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@homeservicemarketplace/database';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// Real HTTP, role/permission guards, current DB memberships, policy service,
// catalog/market registry, transactions, audit and PostgreSQL. The harness
// supplies the authenticated principal; JWT issuance is covered separately.
// The role name on that principal stays unchanged while DB grants are revoked.
dbDescribe('Restricted verification policy settings (real HTTP and PostgreSQL)', () => {
  const prefix = fixturePrefix('policy-settings');
  const userId = `${prefix}admin`;
  const categoryId = `${prefix}trade`;
  const privateRoleId = `${prefix}role`;
  const version = '2026.09-policy-settings-test-v1';
  const URL = '/v1/admin/verification/policies';
  let prisma: PrismaClient;
  let app: INestApplication;
  let lock: HeldLock | undefined;
  let adminRoleId: string;
  let permissionId: string;
  let originalAdminGrant = false;
  let originalGrantRead = false;
  let actor = { id: userId, roles: ['admin'] };

  class PrincipalGuard {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      req.user = actor;
      req.authTransport = 'cookie';
      return true;
    }
  }

  async function cleanup() {
    if (!prisma) return;
    await prisma.auditEvent.deleteMany({ where: { userId } });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: privateRoleId } });
    await prisma.role.deleteMany({ where: { id: privateRoleId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  const mutate = (path = URL) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', 'hsm_csrf=policy-fixture')
      .set('x-csrf-token', 'policy-fixture');
  const grantPrivate = () =>
    prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: privateRoleId, permissionId } },
      create: { roleId: privateRoleId, permissionId },
      update: {},
    });
  const policyInput = {
    version,
    country: null,
    providerType: 'INDIVIDUAL',
    categoryId,
    requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
  };

  beforeAll(async () => {
    // Revocation exercises a seeded admin-role grant. Exclude seeders and
    // other IAM fixture users, restore the exact original grant in finally.
    lock = await acquireAdvisoryLocks([
      { resource: 'seed', mode: 'exclusive' },
      { resource: 'marketRegistry', mode: 'shared' },
    ]);
    prisma = (
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')
    ).prisma;
    await cleanup();
    adminRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } })).id;
    permissionId = (
      await prisma.permission.findUniqueOrThrow({ where: { key: 'verification:policy:manage' } })
    ).id;
    originalAdminGrant = !!(await prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: adminRoleId, permissionId } },
    }));
    originalGrantRead = true;
    await prisma.rolePermission.deleteMany({ where: { roleId: adminRoleId, permissionId } });
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        firstName: 'Policy',
        lastName: 'Manager',
        status: 'ACTIVE',
      },
    });
    await prisma.role.create({ data: { id: privateRoleId, name: privateRoleId } });
    await prisma.userRole.createMany({
      data: [
        { userId, roleId: adminRoleId },
        { userId, roleId: privateRoleId },
      ],
    });
    await prisma.serviceCategory.create({
      data: {
        id: categoryId,
        slug: categoryId,
        labelEn: 'Policy fixture trade',
        labelAr: 'تخصص اختبار السياسات',
        icon: 'wrench',
        isLeaf: true,
        isActive: true,
      },
    });

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const {
      AdminVerificationPolicyController,
    } = require('../../src/modules/admin/verification/admin-verification-policy.controller');
    const {
      AdminVerificationPolicyService,
    } = require('../../src/modules/admin/verification/admin-verification-policy.service');
    const {
      VerificationSettingsService,
    } = require('../../src/modules/provider/verification/verification-settings.service');
    const {
      MarketRegistryService,
    } = require('../../src/modules/provider/onboarding/market/market-registry.service');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const config = { isProduction: false, get: () => false };
    const module = await Test.createTestingModule({
      controllers: [AdminVerificationPolicyController],
      providers: [
        Reflector,
        RoleRepository,
        PermissionResolverService,
        AdminVerificationPolicyService,
        TransactionRunner,
        VerificationSettingsService,
        MarketRegistryService,
        PlatformSettingRepository,
        AuditEventRepository,
        AuditService,
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: AppConfigService, useValue: config },
        // Any accidental cached authorization call fails; the policy must use
        // the current DB memberships and grants on every request.
        { provide: RedisService, useValue: {} },
        { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(PrincipalGuard)
      .compile();
    app = module.createNestApplication();
    app.use(require('cookie-parser')());
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (prisma && originalGrantRead) {
        if (originalAdminGrant)
          await prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: adminRoleId, permissionId } },
            create: { roleId: adminRoleId, permissionId },
            update: {},
          });
        else
          await prisma.rolePermission.deleteMany({ where: { roleId: adminRoleId, permissionId } });
      }
      await cleanup();
    } finally {
      await lock?.release();
      await prisma?.$disconnect();
    }
  });

  it('denies an admin without the distinct permission for every settings action', async () => {
    await request(app.getHttpServer()).get(URL).expect(403);
    await request(app.getHttpServer()).get(`${URL}/options`).expect(403);
    await mutate().send(policyInput).expect(403);
    await mutate(`${URL}/${version}/retire`).expect(403);
    expect(await prisma.verificationRequirementPolicy.count({ where: { version } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { userId } })).toBe(0);
  });

  it('reads the real choices after a distinct role grants policy management', async () => {
    await grantPrivate();
    await request(app.getHttpServer()).get(URL).expect(200);
    const response = await request(app.getHttpServer()).get(`${URL}/options`).expect(200);
    expect(response.body.categories).toContainEqual({
      id: categoryId,
      labelEn: 'Policy fixture trade',
      labelAr: 'تخصص اختبار السياسات',
      selectable: true,
    });
    expect(response.body.countries.length).toBeGreaterThan(0);
  });

  it('retains CSRF protection when the policy permission is present', async () => {
    await request(app.getHttpServer()).post(URL).send(policyInput).expect(403);
    expect(await prisma.verificationRequirementPolicy.count({ where: { version } })).toBe(0);
  });

  it('publishes the scoped requirement and audit in persisted storage', async () => {
    const response = await mutate().send(policyInput).expect(201);
    expect(response.body.policy).toMatchObject({
      version,
      categoryId,
      providerType: 'INDIVIDUAL',
      state: 'ACTIVE',
    });
    const saved = await prisma.verificationRequirementPolicy.findUniqueOrThrow({
      where: { version },
    });
    expect(saved.requirements).toEqual(policyInput.requirements);
    expect(saved.publishedByUserId).toBe(userId);
    expect(
      await prisma.auditEvent.count({ where: { userId, type: 'VERIFICATION_POLICY_PUBLISHED' } }),
    ).toBe(1);
  });

  it('revokes reads and writes on the next request while the principal still says admin', async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: privateRoleId, permissionId } });
    expect(actor.roles).toEqual(['admin']);
    await request(app.getHttpServer()).get(URL).expect(403);
    await request(app.getHttpServer()).get(`${URL}/options`).expect(403);
    await mutate(`${URL}/${version}/retire`).expect(403);
    expect(
      (await prisma.verificationRequirementPolicy.findUniqueOrThrow({ where: { version } }))
        .retiredAt,
    ).toBeNull();
    expect(
      await prisma.auditEvent.count({ where: { userId, type: 'VERIFICATION_POLICY_RETIRED' } }),
    ).toBe(0);
  });

  it('rejects a removed admin membership even when another role still grants the policy permission', async () => {
    await grantPrivate();
    await prisma.userRole.delete({ where: { userId_roleId: { userId, roleId: adminRoleId } } });
    await request(app.getHttpServer()).get(URL).expect(403);
    await mutate(`${URL}/${version}/retire`).expect(403);
    await prisma.userRole.create({ data: { userId, roleId: adminRoleId } });
  });

  it('requires the admin role as well as the policy permission', async () => {
    actor = { id: userId, roles: ['provider'] };
    await request(app.getHttpServer()).get(URL).expect(403);
    actor = { id: userId, roles: ['admin'] };
  });

  it('stops a version while preserving its immutable requirements and audit', async () => {
    const response = await mutate(`${URL}/${version}/retire`).expect(200);
    expect(response.body.policy).toMatchObject({ state: 'RETIRED', isLive: false });
    const saved = await prisma.verificationRequirementPolicy.findUniqueOrThrow({
      where: { version },
    });
    expect(saved.retiredAt).not.toBeNull();
    expect(saved.requirements).toEqual(policyInput.requirements);
    expect(
      await prisma.auditEvent.count({ where: { userId, type: 'VERIFICATION_POLICY_RETIRED' } }),
    ).toBe(1);
    await mutate(`${URL}/${version}/retire`).expect(409);
    expect(
      await prisma.auditEvent.count({ where: { userId, type: 'VERIFICATION_POLICY_RETIRED' } }),
    ).toBe(1);
  });
});
