import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx, ServiceCategory } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// The public catalog includes groups and standalone legacy specialties. A
// grouped specialty is available for new selections only while its group is live.
const visibleParent: Prisma.ServiceCategoryWhereInput = {
  OR: [
    { parentId: null },
    { parent: { isActive: true, isLeaf: false, deletedAt: null, parentId: null } },
  ],
};

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
      where: { ...visibleParent, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  findBySlug(slug: string, tx?: PrismaTx): Promise<ServiceCategory | null> {
    return this.db(tx).serviceCategory.findFirst({
      where: { ...visibleParent, slug, deletedAt: null },
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<ServiceCategory | null> {
    return this.db(tx).serviceCategory.findFirst({
      where: { ...visibleParent, id, deletedAt: null },
    });
  }

  // ── Sprint 8: the hierarchy ────────────────────────────────────────────
  // docs/adr/0008-category-hierarchy-and-onboarding-draft.md

  /** Root groups — the organisational headings the wizard offers first.
   *
   *  These are NOT necessarily unselectable: a pre-Sprint-8 category is a root
   *  (`parentId = null`) AND a leaf (`isLeaf = true`), because that is exactly
   *  what it was before the hierarchy existed. Selectability is read from
   *  `isLeaf`, never inferred from position. */
  listRoots(tx?: PrismaTx): Promise<ServiceCategory[]> {
    return this.db(tx).serviceCategory.findMany({
      where: { parentId: null, isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  /** The selectable leaves beneath a set of parents.
   *
   *  Filtered on `isLeaf` in the QUERY: a parent that is somehow also marked
   *  selectable must not be offered as one of its own children, and doing the
   *  filter here means no caller can forget it. */
  listLeavesByParents(parentIds: string[], tx?: PrismaTx): Promise<ServiceCategory[]> {
    if (parentIds.length === 0) return Promise.resolve([]);
    return this.db(tx).serviceCategory.findMany({
      where: {
        ...visibleParent,
        parentId: { in: parentIds },
        isLeaf: true,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  /** Fetch specific categories by id, active only.
   *
   *  Used to check what a client actually selected. Inactive and soft-deleted
   *  rows are excluded here rather than filtered by the caller, so a stale
   *  client holding a retired category id gets it rejected instead of stored. */
  findManyActiveByIds(ids: string[], tx?: PrismaTx): Promise<ServiceCategory[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db(tx).serviceCategory.findMany({
      where: { ...visibleParent, id: { in: ids }, isActive: true, deletedAt: null },
    });
  }
}
