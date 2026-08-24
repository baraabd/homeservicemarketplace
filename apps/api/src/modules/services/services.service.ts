import { Injectable } from '@nestjs/common';
import type {
  EquipmentCatalogSummary,
  ServiceCategorySummary,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';

@Injectable()
export class ServicesService {
  constructor(
    private readonly categories: ServiceCategoryRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Returns the active catalog as DTOs. Mapping happens here (not in the
  // controller) so the controller stays thin and the persistence row
  // shape never escapes the module boundary.
  async listCategories(): Promise<ServiceCategorySummary[]> {
    const rows = await this.categories.listActive();
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      icon: r.icon,
      sortOrder: r.sortOrder,
      // Sprint 8 — the hierarchy, served alongside the flat list rather than
      // on a second endpoint. Every pre-Sprint-8 row carries parentId null and
      // isLeaf true, so a client that ignores both behaves exactly as before.
      //
      // isLeaf is SERVED, never derived client-side. Deriving it from "has no
      // children" would make selectability a client inference and would flip
      // silently when a parent's last child is deactivated.
      parentId: r.parentId,
      isLeaf: r.isLeaf,
    }));
  }

  /**
   * Sprint 8 — the equipment catalogue.
   *
   * Public and read-only for the same reason the category list is: it is part
   * of what the marketplace says it can do, and the onboarding wizard needs it
   * before a provider has any standing to speak of.
   */
  async listEquipment(): Promise<EquipmentCatalogSummary[]> {
    const rows = await this.prisma.client.equipmentCatalogItem.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      categoryId: r.categoryId,
      sortOrder: r.sortOrder,
    }));
  }
}
