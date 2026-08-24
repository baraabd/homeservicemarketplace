import type { ServiceCategory } from '@homeservicemarketplace/database';

import type { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ServicesService } from './services.service';

// Sprint 8 — listEquipment reads through PrismaService directly. Every case
// below exercises listCategories only, so the stub is deliberately empty
// rather than a half-mock that would imply coverage it does not give.
function prismaStub(): PrismaService {
  return {
    client: { equipmentCatalogItem: { findMany: jest.fn().mockResolvedValue([]) } },
  } as unknown as PrismaService;
}

function makeRow(overrides: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: 'sc-1',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '🔧',
    sortOrder: 0,
    // Sprint 8 — flat categories are leaves at the root.
    parentId: null,
    isLeaf: true,
    isActive: true,
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('ServicesService', () => {
  it('maps repo rows to ServiceCategorySummary DTOs (drops infra-only fields)', async () => {
    const repo = {
      listActive: jest
        .fn()
        .mockResolvedValue([
          makeRow(),
          makeRow({ id: 'sc-2', slug: 'electrical', labelEn: 'Electrical', sortOrder: 1 }),
        ]),
    } as unknown as ServiceCategoryRepository;

    const svc = new ServicesService(repo, prismaStub());
    const out = await svc.listCategories();

    expect(out).toEqual([
      {
        id: 'sc-1',
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
        icon: '🔧',
        sortOrder: 0,
        // Sprint 8 — served, not derived. A pre-hierarchy row is a
        // selectable competency at the root, exactly what it was before.
        parentId: null,
        isLeaf: true,
      },
      {
        id: 'sc-2',
        slug: 'electrical',
        labelEn: 'Electrical',
        labelAr: 'سباكة', // makeRow default — proves bilingual label passes through
        icon: '🔧',
        sortOrder: 1,
        parentId: null,
        isLeaf: true,
      },
    ]);
    // No persistence-only fields leak through.
    for (const dto of out) {
      expect(dto).not.toHaveProperty('isActive');
      expect(dto).not.toHaveProperty('createdAt');
      expect(dto).not.toHaveProperty('updatedAt');
      expect(dto).not.toHaveProperty('deletedAt');
    }
  });

  it('returns an empty array when the repo has no active rows', async () => {
    const repo = {
      listActive: jest.fn().mockResolvedValue([]),
    } as unknown as ServiceCategoryRepository;
    const svc = new ServicesService(repo, prismaStub());
    expect(await svc.listCategories()).toEqual([]);
  });

  it('delegates filter+order to the repository (does not re-sort or re-filter)', async () => {
    // Repository is responsible for { isActive: true, deletedAt: null,
    // orderBy: [sortOrder, slug] } — verified in service-category.repository.spec.
    // The service must NOT second-guess that contract: pass through what it
    // gets in order.
    const rows = [
      makeRow({ id: '1', sortOrder: 5, slug: 'cleaning' }),
      makeRow({ id: '2', sortOrder: 0, slug: 'plumbing' }),
    ];
    const repo = {
      listActive: jest.fn().mockResolvedValue(rows),
    } as unknown as ServiceCategoryRepository;
    const svc = new ServicesService(repo, prismaStub());
    const out = await svc.listCategories();
    expect(out.map((d) => d.id)).toEqual(['1', '2']);
  });
});
