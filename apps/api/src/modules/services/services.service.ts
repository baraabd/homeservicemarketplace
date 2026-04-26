import { Injectable } from '@nestjs/common';
import type { ServiceCategorySummary } from '@homeservicemarketplace/contracts';

import { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';

@Injectable()
export class ServicesService {
  constructor(private readonly categories: ServiceCategoryRepository) {}

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
    }));
  }
}
