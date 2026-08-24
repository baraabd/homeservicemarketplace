import { Injectable } from '@nestjs/common';
import type {
  AdminCategoryMutationResponse,
  AdminCategoryNode,
  AdminCategoryTreeResponse,
  AdminEquipmentItem,
  AdminEquipmentListResponse,
  AdminEquipmentMutationResponse,
  CreateAdminCategoryRequest,
  CreateAdminEquipmentRequest,
  UpdateAdminCategoryRequest,
  UpdateAdminEquipmentRequest,
} from '@homeservicemarketplace/contracts';
import type { AuditEventType, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAuditService } from '../admin-audit.service';

// Sprint 8 — administration of the service-category tree and the equipment
// catalogue.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// These two tables decide what a provider can claim to do and what a seeker
// can search for, so every mutation is audited on the same terms as editing a
// person's standing.
//
// THERE IS NO DELETE, deliberately. A category a provider holds cannot be
// removed without silently revoking a competency an admin once approved, and
// an equipment code a saved draft references cannot be removed without
// breaking that draft. Retiring is `isActive: false`: the row disappears from
// new selections while every existing reference stays intact and explicable.

/** How deep the tree may go.
 *
 *  Two levels is what the wizard renders — groups and the specialties beneath
 *  them — and the bound exists so a mis-parented row cannot produce a chain
 *  the UI has no way to display. Raising it is a UI change, not just a number. */
export const MAX_CATEGORY_DEPTH = 2;

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // ── categories ────────────────────────────────────────────────────────

  /**
   * The whole tree, pre-nested.
   *
   * Nested by the SERVER rather than handed over flat: the client would
   * otherwise rebuild the tree on every render, and two clients would disagree
   * about where an orphan belongs. Inactive rows ARE included — an admin
   * screen that hides retired categories cannot un-retire one.
   */
  async categoryTree(): Promise<AdminCategoryTreeResponse> {
    const rows = await this.db().serviceCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { _count: { select: { providerProfiles: true } } },
    });

    const nodes = new Map<string, AdminCategoryNode>();
    for (const row of rows) {
      nodes.set(row.id, {
        id: row.id,
        slug: row.slug,
        labelEn: row.labelEn,
        labelAr: row.labelAr,
        icon: row.icon,
        parentId: row.parentId,
        isLeaf: row.isLeaf,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        children: [],
        providerCount: row._count.providerProfiles,
      });
    }

    const roots: AdminCategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      // An orphan — parent soft-deleted, or a row written before its parent —
      // is surfaced as a ROOT rather than dropped. Silently omitting it would
      // make a category invisible on the one screen that could repair it.
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return { roots };
  }

  async createCategory(
    adminUserId: string,
    input: CreateAdminCategoryRequest,
  ): Promise<AdminCategoryMutationResponse> {
    const created = await this.tx.run(async (trx) => {
      const slug = input.slug.trim().toLowerCase();
      const existing = await trx.serviceCategory.findFirst({ where: { slug } });
      if (existing) {
        throw new AppError('CONFLICT', `A category with the slug "${slug}" already exists.`, 409);
      }

      if (input.parentId) {
        const parent = await this.requireCategory(input.parentId, trx);
        // A parent that is itself selectable would let a provider hold both a
        // group and the specialties under it, which makes "what are they
        // approved for" ambiguous at exactly the moment it matters.
        if (parent.isLeaf) {
          throw new AppError(
            'VALIDATION_ERROR',
            'That parent is a selectable specialty. Mark it as a group before nesting under it.',
            400,
          );
        }
        const depth = await this.depthOf(parent.id, trx);
        if (depth + 1 >= MAX_CATEGORY_DEPTH) {
          throw new AppError(
            'VALIDATION_ERROR',
            `The catalogue is limited to ${MAX_CATEGORY_DEPTH} levels.`,
            400,
          );
        }
      }

      const row = await trx.serviceCategory.create({
        data: {
          slug,
          labelEn: input.labelEn.trim(),
          labelAr: input.labelAr.trim(),
          icon: input.icon?.trim() || 'wrench',
          parentId: input.parentId ?? null,
          // Defaults to true, matching every pre-Sprint-8 row: a category is
          // selectable unless someone deliberately makes it a heading.
          isLeaf: input.isLeaf ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });

      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_CATEGORY_CREATED' as AuditEventType,
          metadata: {
            categoryId: row.id,
            slug: row.slug,
            parentId: row.parentId,
            isLeaf: row.isLeaf,
          },
        },
        trx,
      );

      return row;
    });

    return { category: toNode(created, 0) };
  }

  async updateCategory(
    adminUserId: string,
    id: string,
    input: UpdateAdminCategoryRequest,
  ): Promise<AdminCategoryMutationResponse> {
    const { row, providerCount } = await this.tx.run(async (trx) => {
      const before = await this.requireCategory(id, trx);
      const holders = await trx.providerProfileServiceCategory.count({
        where: { serviceCategoryId: id },
      });

      if (input.parentId !== undefined && input.parentId !== before.parentId) {
        await this.assertReparentable(id, input.parentId, trx);
      }

      if (input.isLeaf === false) {
        // Turning a selectable specialty into a heading orphans everyone who
        // holds it: their competency stops being selectable while they keep
        // it, and nothing in the UI can explain the state. The admin must
        // move those grants first.
        if (holders > 0) {
          throw new AppError(
            'CONFLICT',
            `${holders} provider(s) hold this specialty. Move them before making it a group.`,
            409,
          );
        }
      }

      if (input.isLeaf === true) {
        // The reverse: a heading with children becoming selectable means a
        // provider can hold the group AND its specialties, and "what are they
        // approved for" stops having one answer.
        const children = await trx.serviceCategory.count({
          where: { parentId: id, deletedAt: null },
        });
        if (children > 0) {
          throw new AppError(
            'CONFLICT',
            'This group has specialties beneath it and cannot itself be selectable.',
            409,
          );
        }
      }

      const updated = await trx.serviceCategory.update({
        where: { id },
        data: {
          ...(input.labelEn !== undefined ? { labelEn: input.labelEn.trim() } : {}),
          ...(input.labelAr !== undefined ? { labelAr: input.labelAr.trim() } : {}),
          ...(input.icon !== undefined ? { icon: input.icon.trim() } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.isLeaf !== undefined ? { isLeaf: input.isLeaf } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });

      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_CATEGORY_UPDATED' as AuditEventType,
          metadata: {
            categoryId: id,
            // Before AND after. "isLeaf was changed" is not an audit trail;
            // "isLeaf went true → false while 0 providers held it" is.
            before: {
              parentId: before.parentId,
              isLeaf: before.isLeaf,
              isActive: before.isActive,
            },
            after: {
              parentId: updated.parentId,
              isLeaf: updated.isLeaf,
              isActive: updated.isActive,
            },
            providerCount: holders,
          },
        },
        trx,
      );

      return { row: updated, providerCount: holders };
    });

    return { category: toNode(row, providerCount) };
  }

  // ── equipment ─────────────────────────────────────────────────────────

  async listEquipment(): Promise<AdminEquipmentListResponse> {
    const rows = await this.db().equipmentCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { items: rows.map(toEquipment) };
  }

  async createEquipment(
    adminUserId: string,
    input: CreateAdminEquipmentRequest,
  ): Promise<AdminEquipmentMutationResponse> {
    const created = await this.tx.run(async (trx) => {
      // Uppercase snake, normalised on the way in. A code is a stable
      // identifier that clients key i18n off, so "VAN" and "van" arriving as
      // two rows would be two capabilities for one thing and matching would
      // find neither reliably.
      const code = input.code.trim().toUpperCase().replace(/\s+/g, '_');
      const existing = await trx.equipmentCatalogItem.findUnique({ where: { code } });
      if (existing) {
        throw new AppError('CONFLICT', `Equipment code "${code}" already exists.`, 409);
      }

      if (input.categoryId) await this.requireCategory(input.categoryId, trx);

      const row = await trx.equipmentCatalogItem.create({
        data: {
          code,
          labelEn: input.labelEn.trim(),
          labelAr: input.labelAr.trim(),
          categoryId: input.categoryId ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });

      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_EQUIPMENT_CREATED' as AuditEventType,
          metadata: { equipmentId: row.id, code: row.code, categoryId: row.categoryId },
        },
        trx,
      );

      return row;
    });

    return { item: toEquipment(created) };
  }

  async updateEquipment(
    adminUserId: string,
    id: string,
    input: UpdateAdminEquipmentRequest,
  ): Promise<AdminEquipmentMutationResponse> {
    const updated = await this.tx.run(async (trx) => {
      const before = await trx.equipmentCatalogItem.findUnique({ where: { id } });
      if (!before) throw new AppError('NOT_FOUND', 'Equipment item not found.', 404);

      if (input.categoryId) await this.requireCategory(input.categoryId, trx);

      const row = await trx.equipmentCatalogItem.update({
        where: { id },
        data: {
          ...(input.labelEn !== undefined ? { labelEn: input.labelEn.trim() } : {}),
          ...(input.labelAr !== undefined ? { labelAr: input.labelAr.trim() } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });

      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_EQUIPMENT_UPDATED' as AuditEventType,
          metadata: {
            equipmentId: id,
            code: row.code,
            before: { categoryId: before.categoryId, isActive: before.isActive },
            after: { categoryId: row.categoryId, isActive: row.isActive },
          },
        },
        trx,
      );

      return row;
    });

    return { item: toEquipment(updated) };
  }

  // ── the cycle guard ───────────────────────────────────────────────────

  /**
   * Refuse a re-parent that would create a cycle or exceed the depth bound.
   *
   * The database CHECK only catches the one-hop case (a category as its own
   * parent). A → B → A needs the ancestor chain walked, and getting it wrong
   * produces a tree that makes every recursive read hang rather than error —
   * the worst possible failure shape for a catalogue read on a hot path.
   */
  private async assertReparentable(
    id: string,
    parentId: string | null,
    trx: PrismaTx,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === id) {
      throw new AppError('VALIDATION_ERROR', 'A category cannot be its own parent.', 400);
    }

    const parent = await this.requireCategory(parentId, trx);
    if (parent.isLeaf) {
      throw new AppError(
        'VALIDATION_ERROR',
        'That parent is a selectable specialty. Mark it as a group before nesting under it.',
        400,
      );
    }

    // Walk UP from the proposed parent. If we reach the row being moved, the
    // move would close a loop. Bounded by a hop counter as well as by finding
    // the root: if the data is ALREADY cyclic — which this guard is meant to
    // prevent but cannot retroactively undo — an unbounded walk never returns.
    let cursor: string | null = parent.parentId;
    for (let hops = 0; cursor !== null && hops <= MAX_CATEGORY_DEPTH + 2; hops += 1) {
      if (cursor === id) {
        throw new AppError(
          'VALIDATION_ERROR',
          'That move would make the category an ancestor of itself.',
          400,
        );
      }
      const next: { parentId: string | null } | null = await trx.serviceCategory.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }

    const depth = await this.depthOf(parentId, trx);
    if (depth + 1 >= MAX_CATEGORY_DEPTH) {
      throw new AppError(
        'VALIDATION_ERROR',
        `The catalogue is limited to ${MAX_CATEGORY_DEPTH} levels.`,
        400,
      );
    }
  }

  /** Hops from a category up to its root. 0 for a root. */
  private async depthOf(id: string, trx: PrismaTx): Promise<number> {
    let depth = 0;
    let cursor: string | null = id;
    while (cursor !== null && depth <= MAX_CATEGORY_DEPTH + 2) {
      const row: { parentId: string | null } | null = await trx.serviceCategory.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
      if (cursor !== null) depth += 1;
    }
    return depth;
  }

  private async requireCategory(id: string, trx: PrismaTx) {
    const row = await trx.serviceCategory.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'Category not found.', 404);
    return row;
  }
}

function toNode(
  row: {
    id: string;
    slug: string;
    labelEn: string;
    labelAr: string;
    icon: string;
    parentId: string | null;
    isLeaf: boolean;
    isActive: boolean;
    sortOrder: number;
  },
  providerCount: number,
): AdminCategoryNode {
  return {
    id: row.id,
    slug: row.slug,
    labelEn: row.labelEn,
    labelAr: row.labelAr,
    icon: row.icon,
    parentId: row.parentId,
    isLeaf: row.isLeaf,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    // A mutation response describes ONE row. Nesting its subtree here would
    // make the response shape depend on where in the tree the row sits.
    children: [],
    providerCount,
  };
}

function toEquipment(row: {
  id: string;
  code: string;
  labelEn: string;
  labelAr: string;
  categoryId: string | null;
  isActive: boolean;
  sortOrder: number;
}): AdminEquipmentItem {
  return {
    id: row.id,
    code: row.code,
    labelEn: row.labelEn,
    labelAr: row.labelAr,
    categoryId: row.categoryId,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}
