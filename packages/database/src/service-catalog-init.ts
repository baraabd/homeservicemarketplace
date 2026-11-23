import { parseArgs } from 'node:util';

import { PrismaClient } from '../generated/prisma';
import { SERVICE_GROUPS, SERVICE_SPECIALTIES } from './service-catalog-data';

const proposal = [
  ...SERVICE_GROUPS.map((group) => ({ ...group, isLeaf: false, parentSlug: null })),
  ...SERVICE_SPECIALTIES.map((leaf) => ({ ...leaf, isLeaf: true })),
];

const actorSystem = 'operator-cli:service-catalog-init';

async function initServiceCatalog(
  db: PrismaClient,
  { apply = false, adoptFlat = false }: { apply?: boolean; adoptFlat?: boolean } = {},
) {
  return db.$transaction(
    async (tx) => {
      // Admin edits do not take an advisory lock. Serialize the small apply
      // transaction with ordinary catalog writers as well as other operators.
      // Readers continue normally. READ COMMITTED sees the preceding commit.
      if (apply) {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        await tx.$executeRaw`LOCK TABLE "ServiceCategory" IN SHARE ROW EXCLUSIVE MODE`;
      }
      const rows = await tx.serviceCategory.findMany({
        select: {
          id: true,
          slug: true,
          parentId: true,
          labelAr: true,
          labelEn: true,
          isLeaf: true,
          isActive: true,
          deletedAt: true,
        },
      });
      const bySlug = new Map(rows.map((row) => [row.slug, row]));
      const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase();
      const plan = proposal.map((spec) => {
        const { slug, parentSlug, labelAr, labelEn, isLeaf } = spec;
        const row = bySlug.get(slug);
        const describe = (
          action: 'create' | 'keep' | 'adopt-flat' | 'conflict',
          reason?: string,
        ) => ({ ...spec, isActive: true, action, reason });

        const alias = rows.find(
          (r) =>
            r.slug !== slug &&
            (normalize(r.slug) === slug ||
              normalize(r.labelAr) === normalize(labelAr) ||
              normalize(r.labelEn) === normalize(labelEn)),
        );
        if (alias) return describe('conflict', `Conflicting slug or label on ${alias.slug}`);
        if (!row) return describe('create');
        if (
          row.deletedAt ||
          !row.isActive ||
          row.isLeaf !== isLeaf ||
          row.labelEn !== labelEn ||
          row.labelAr !== labelAr
        ) {
          return describe('conflict', 'Existing status, kind or bilingual labels differ');
        }
        if (isLeaf && rows.some((r) => r.parentId === row.id && !r.deletedAt)) {
          return describe('conflict', 'Selectable specialty already has children');
        }
        const expectedParentId = parentSlug === null ? null : bySlug.get(parentSlug)?.id;
        if (row.parentId === expectedParentId) {
          return describe('keep');
        }
        if (parentSlug && row.parentId === null) {
          return adoptFlat
            ? describe('adopt-flat')
            : describe('conflict', 'Existing flat specialty; review with --adopt-flat');
        }
        return describe('conflict', 'Existing parent differs');
      });

      const blocked = plan.some((item) => item.action === 'conflict');
      if (apply && !blocked) {
        const ids = new Map(rows.map((row) => [row.slug, row.id]));
        for (const item of plan) {
          const { action, parentSlug, slug, labelEn, labelAr, icon, sortOrder, isLeaf, isActive } =
            item;
          if (action === 'keep') continue;
          const parentId = parentSlug === null ? null : ids.get(parentSlug);
          if (parentId === undefined) throw new Error(`Missing group: ${parentSlug}`);
          const adopted = action === 'adopt-flat';
          const row = adopted
            ? await tx.serviceCategory.update({ where: { slug }, data: { parentId } })
            : await tx.serviceCategory.create({
                data: { slug, labelEn, labelAr, icon, sortOrder, isLeaf, isActive, parentId },
              });
          ids.set(row.slug, row.id);
          await tx.auditEvent.create({
            data: {
              type: adopted ? 'ADMIN_CATEGORY_UPDATED' : 'ADMIN_CATEGORY_CREATED',
              metadata: {
                actorSystem,
                categoryId: row.id,
                slug: row.slug,
                parentId,
                isLeaf: row.isLeaf,
                ...(adopted ? { before: { parentId: null }, after: { parentId } } : {}),
              },
            },
          });
        }
      }
      return { mode: apply ? 'apply' : 'preview', blocked, plan };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'adopt-flat': { type: 'boolean' },
    },
  });
  if (values.apply && values['dry-run']) throw new Error('Choose either --dry-run or --apply.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the intended catalog database.');
  const target = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
  if (
    values.apply &&
    (!local || process.env.NODE_ENV === 'production') &&
    process.env.ALLOW_HOSTED_CATALOG_INIT !== 'true'
  ) {
    throw new Error('Applying to this target requires ALLOW_HOSTED_CATALOG_INIT=true.');
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const result = await initServiceCatalog(db, {
      apply: values.apply,
      adoptFlat: values['adopt-flat'],
    });
    console.log(
      JSON.stringify(
        {
          target: target.host + target.pathname,
          schema: target.searchParams.get('schema') ?? 'public',
          ...result,
        },
        null,
        2,
      ),
    );
    if (result.blocked) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
