import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@homeservicemarketplace/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';

import { AppConfigService } from '../../src/config/app-config.service';
import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { AddressRepository } from '../../src/infrastructure/persistence/addresses/address.repository';
import { ProviderProfileRepository } from '../../src/infrastructure/persistence/bids/provider-profile.repository';
import { AuditEventRepository } from '../../src/infrastructure/persistence/iam/audit-event.repository';
import { UserRepository } from '../../src/infrastructure/persistence/iam/user.repository';
import { ProviderOnboardingDraftRepository } from '../../src/infrastructure/persistence/provider/provider-onboarding-draft.repository';
import { ServiceRequestRepository } from '../../src/infrastructure/persistence/requests/service-request.repository';
import { ServiceRequestEventRepository } from '../../src/infrastructure/persistence/requests/service-request-event.repository';
import { ProviderCategoryApplicationRepository } from '../../src/infrastructure/persistence/services/provider-category-application.repository';
import { ServiceCategoryRepository } from '../../src/infrastructure/persistence/services/service-category.repository';
import { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { STORAGE_PORT } from '../../src/infrastructure/storage/storage.port';
import { AdminAuditService } from '../../src/modules/admin/admin-audit.service';
import { AdminCatalogService } from '../../src/modules/admin/catalog/admin-catalog.service';
import { AuditService } from '../../src/modules/iam/audit/audit.service';
import { RequestMediaService } from '../../src/modules/media/request-media.service';
import { ProviderOnboardingWizardService } from '../../src/modules/provider/onboarding/provider-onboarding-wizard.service';
import { MarketRegistryService } from '../../src/modules/provider/onboarding/market/market-registry.service';
import { ProviderOnboardingDefaultsService } from '../../src/modules/provider/onboarding/market/onboarding-defaults.service';
import { ProviderServiceAreaExpansionService } from '../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service';
import { RequestsService } from '../../src/modules/requests/requests.service';
import { ServicesService } from '../../src/modules/services/services.service';
import { ServicesController } from '../../src/modules/services/services.controller';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const cli = path.resolve(__dirname, '../../../../packages/database/dist/service-catalog-init.js');
const exec = promisify(execFile);
jest.setTimeout(90_000);

suite('launch catalog operator and marketplace consumers (PostgreSQL)', () => {
  let isolated: IsolatedDatabase | undefined;
  let db: PrismaClient;
  let url: URL;

  beforeEach(async () => {
    isolated = await createIsolatedDatabase('launch_catalog');
    db = isolated.prisma;
    const [target] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    url = new URL(process.env.DATABASE_URL!);
    url.pathname = '/' + target.name;
    url.searchParams.set('schema', 'public');
  });
  afterEach(async () => {
    await isolated?.dispose();
    isolated = undefined;
  });

  async function run(args: string[] = [], env = {}) {
    const { stdout } = await exec(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        ALLOW_HOSTED_CATALOG_INIT: 'true',
        ...env,
      },
    });
    return JSON.parse(stdout) as {
      mode: string;
      blocked: boolean;
      plan: { slug: string; action: string }[];
    };
  }

  it('previews without writes, serializes concurrent applies and replays without audit noise', async () => {
    const settingsBefore = await db.platformSetting.findMany({ orderBy: { key: 'asc' } });
    const preview = await run();
    expect(preview.mode).toBe('preview');
    expect(preview.plan.filter((p) => p.action === 'create')).toHaveLength(9);
    expect(await db.serviceCategory.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
    await expect(
      run(['--apply'], { NODE_ENV: 'production', ALLOW_HOSTED_CATALOG_INIT: '' }),
    ).rejects.toThrow(/ALLOW_HOSTED_CATALOG_INIT/);
    const applied = await Promise.all([run(['--apply']), run(['--apply'])]);
    expect(applied.map((r) => r.plan.filter((p) => p.action === 'create').length).sort()).toEqual([
      0, 9,
    ]);
    const before = await db.serviceCategory.findMany({ orderBy: { slug: 'asc' } });
    expect((await run(['--apply'])).plan.every((p) => p.action === 'keep')).toBe(true);
    expect(await db.serviceCategory.findMany({ orderBy: { slug: 'asc' } })).toEqual(before);
    expect(await db.auditEvent.count({ where: { type: 'ADMIN_CATEGORY_CREATED' } })).toBe(9);
    expect(await db.user.count()).toBe(0);
    expect(await db.providerProfile.count()).toBe(0);
    expect(await db.providerCategoryApplication.count()).toBe(0);
    expect(await db.role.count()).toBe(0);
    expect(await db.platformSetting.findMany({ orderBy: { key: 'asc' } })).toEqual(settingsBefore);
  });

  it('requires explicit adoption and keeps an existing request on the same legacy leaf ID', async () => {
    const leaf = await db.serviceCategory.create({
      data: {
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
        icon: 'custom',
        sortOrder: 18,
      },
    });
    const user = await db.user.create({
      data: { firstName: 'Catalog', lastName: 'Test', email: 'legacy@example.test' },
    });
    const job = await db.serviceRequest.create({
      data: {
        seekerUserId: user.id,
        categoryId: leaf.id,
        scheduleType: 'ASAP',
        addressSnapshot: {},
      },
    });
    await expect(run(['--apply'])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('Existing flat specialty'),
    });
    expect(await db.serviceCategory.count()).toBe(1);
    await run(['--adopt-flat', '--apply']);
    const group = await db.serviceCategory.findUniqueOrThrow({
      where: { slug: 'home-maintenance' },
    });
    expect(
      await db.serviceRequest.findUniqueOrThrow({
        where: { id: job.id },
        include: { category: true },
      }),
    ).toMatchObject({
      categoryId: leaf.id,
      category: { parentId: group.id, isLeaf: true, icon: 'custom', sortOrder: 18 },
    });
    expect(await db.auditEvent.count({ where: { type: 'ADMIN_CATEGORY_UPDATED' } })).toBe(1);
    expect((await run(['--apply'])).plan.every((item) => item.action === 'keep')).toBe(true);
  });

  it('preserves retired rows, editorial changes and alternate slugs, blocking the entire batch', async () => {
    const retired = {
      slug: 'cleaning',
      labelEn: 'Cleaning',
      labelAr: 'تنظيف',
      icon: 'x',
      isActive: false,
      deletedAt: new Date(),
    };
    await db.serviceCategory.createMany({
      data: [
        retired,
        { slug: 'plumbing', labelEn: 'Custom plumbing', labelAr: 'سباكة', icon: 'x' },
        { slug: 'electrician', labelEn: ' ELECTRICAL ', labelAr: 'كهربائي', icon: 'x' },
      ],
    });
    const before = await db.serviceCategory.findMany({ orderBy: { slug: 'asc' } });
    await expect(run(['--adopt-flat', '--apply'])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('Conflicting slug or label on electrician'),
    });
    expect(await db.serviceCategory.findMany({ orderBy: { slug: 'asc' } })).toEqual(before);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it('rolls back all categories and audit records on a late insert failure', async () => {
    await db.$executeRaw`ALTER TABLE "ServiceCategory" ADD CONSTRAINT catalog_test_failure CHECK (slug <> 'painting')`;
    await expect(run(['--apply'])).rejects.toMatchObject({ code: 1 });
    expect(await db.serviceCategory.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it('serves the admin tree and public DTOs, saves a pending specialty and persists the seeker request link', async () => {
    await run(['--apply']);
    const app = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [
        { provide: PrismaService, useValue: { client: db } },
        { provide: AppConfigService, useValue: { get: () => 'catalog-integration-test' } },
        { provide: STORAGE_PORT, useValue: {} },
        ServiceCategoryRepository,
        ServicesService,
        AdminAuditService,
        AdminCatalogService,
        ProviderProfileRepository,
        ProviderOnboardingDraftRepository,
        ProviderCategoryApplicationRepository,
        PlatformSettingRepository,
        UserRepository,
        AuditEventRepository,
        AuditService,
        TransactionRunner,
        MarketRegistryService,
        ProviderOnboardingDefaultsService,
        ProviderServiceAreaExpansionService,
        ProviderOnboardingWizardService,
        ServiceRequestRepository,
        ServiceRequestEventRepository,
        AddressRepository,
        OutboxRepository,
        RequestMediaService,
        RequestsService,
      ],
    }).compile();
    try {
      const catalog = app.get(ServicesController);
      const { roots } = await app.get(AdminCatalogService).categoryTree();
      expect(roots.map((r) => [r.slug, r.children.map((c) => c.slug)])).toEqual([
        ['home-maintenance', ['plumbing', 'electrical', 'ac-repair']],
        ['home-care', ['cleaning']],
        ['interior-finishes', ['carpentry', 'painting']],
      ]);
      const { items } = await catalog.list();
      expect(items).toHaveLength(9);
      for (const root of roots) {
        expect(root).toMatchObject({ isLeaf: false, isActive: true, parentId: null });
        for (const child of root.children) {
          expect(child).toMatchObject({ isLeaf: true, isActive: true, parentId: root.id });
          expect(items).toContainEqual({
            id: child.id,
            slug: child.slug,
            labelAr: child.labelAr,
            labelEn: child.labelEn,
            icon: child.icon,
            sortOrder: child.sortOrder,
            parentId: root.id,
            isLeaf: true,
          });
        }
      }

      const seeker = await db.user.create({
        data: { firstName: 'Catalog', lastName: 'Seeker', email: 'seeker@example.test' },
      });
      const provider = await db.user.create({
        data: {
          firstName: 'Catalog',
          lastName: 'Provider',
          email: 'provider@example.test',
          providerProfile: { create: { displayName: 'Catalog Provider', initials: 'CP' } },
        },
      });
      const group = roots[0];
      const leaf = group.children[0];
      const onboarding = app.get(ProviderOnboardingWizardService);
      const draft = await onboarding.get(provider.id);
      const select = (id: string, version: number) =>
        onboarding.patchStep(provider.id, 'SPECIALTIES', {
          version,
          specialtyLeafIds: [id],
        });
      await expect(select(group.id, draft.version)).rejects.toMatchObject({ status: 400 });
      const saved = await select(leaf.id, draft.version);
      expect(saved.data.pendingSpecialtyIds).toContain(leaf.id);
      expect(await db.providerProfileServiceCategory.count()).toBe(0);

      const requests = app.get(RequestsService);
      const create = (categoryId: string) =>
        requests.create(seeker.id, {
          categoryId,
          scheduleType: 'ASAP',
          manualAddress: { line1: '1 Test Street', city: 'Jeddah', country: 'SA' },
        });
      await expect(create(group.id)).rejects.toMatchObject({ status: 400 });
      const job = await create(leaf.id);
      expect(job.category?.id).toBe(leaf.id);
      await expect(
        requests.update(seeker.id, job.id, { categoryId: group.id }),
      ).rejects.toMatchObject({ status: 400 });
      await db.serviceCategory.update({ where: { id: group.id }, data: { isActive: false } });
      expect((await catalog.list()).items.map((r) => r.id)).not.toContain(leaf.id);
      await expect(create(leaf.id)).rejects.toMatchObject({ status: 400 });
      await expect(select(group.children[1].id, saved.version)).rejects.toMatchObject({
        status: 400,
      });
      expect((await requests.detail(seeker.id, job.id)).category?.id).toBe(leaf.id);
    } finally {
      await app.close();
    }
  });
});
