import { Injectable } from '@nestjs/common';
import type { PrismaTx, ServiceCategory } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Read-only repository for the service-category catalog. The table is
// curated via seed/migration; the API surface only reads. Soft-deleted
// rows are filtered out at every read site so a category that's been
// retired never appears to the client even if a stale frontend cache
// still references its slug.
@Injectable()
export class ServiceCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // List active, non-deleted categories ordered by curation order then
  // slug for stable ties. Sort happens in the database.
  listActive(tx?: PrismaTx): Promise<ServiceCategory[]> {
    return this.db(tx).serviceCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  findBySlug(slug: string, tx?: PrismaTx): Promise<ServiceCategory | null> {
    return this.db(tx).serviceCategory.findFirst({
      where: { slug, deletedAt: null },
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<ServiceCategory | null> {
    return this.db(tx).serviceCategory.findFirst({
      where: { id, deletedAt: null },
    });
  }
}
