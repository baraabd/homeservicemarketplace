import { prisma } from './index';
import { SERVICE_CATEGORIES } from './service-categories';

// Only this command creates missing references. Existing admin choices (including
// a hidden category, its labels and hierarchy) belong to the admin catalogue.
async function main(args: string[]): Promise<void> {
  const [mode = '--dry-run', ...slugs] = args;
  if (mode !== '--dry-run' && mode !== '--apply') {
    throw new Error('Usage: catalog:init [--dry-run [slug ...] | --apply slug ...]');
  }
  const selected = SERVICE_CATEGORIES.filter((row) => !slugs.length || slugs.includes(row.slug));
  if (slugs.length && selected.length !== slugs.length) {
    throw new Error('Choose unique slugs from the catalogue dry run.');
  }
  if (mode === '--apply' && (!slugs.length || process.env.ALLOW_CATALOG_INIT !== 'true')) {
    throw new Error('Apply requires named slugs and ALLOW_CATALOG_INIT=true for this run.');
  }
  const report = await prisma.$transaction(async (tx) => {
    const inserted =
      mode === '--apply'
        ? await tx.serviceCategory.createManyAndReturn({
            data: selected,
            skipDuplicates: true,
            select: { slug: true },
          })
        : [];
    const rows = await tx.serviceCategory.findMany({
      where: { slug: { in: selected.map(({ slug }) => slug) } },
      select: { slug: true, isActive: true, deletedAt: true, isLeaf: true },
    });
    return selected.map(({ slug }) => {
      const row = rows.find((item) => item.slug === slug);
      if (!row) return { slug, state: 'MISSING' };
      if (row.deletedAt || !row.isActive) return { slug, state: 'HIDDEN' };
      if (!row.isLeaf) return { slug, state: 'GROUP' };
      return { slug, state: inserted.some((item) => item.slug === slug) ? 'CREATED' : 'ACTIVE' };
    });
  });
  console.log(JSON.stringify({ mode, categories: report }, null, 2));
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((error: unknown) => {
      // Prisma diagnostics may include connection details. Report the code only.
      if (error instanceof Error && error.constructor === Error) console.error(error.message);
      else {
        const code = error as { code?: string; errorCode?: string } | null;
        console.error('Catalogue operation failed', code?.code ?? code?.errorCode ?? '');
      }
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
