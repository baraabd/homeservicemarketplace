import type { PrismaTx } from '@homeservicemarketplace/database';

/** Presentation default only. This never approves a category or grants work. */
export async function seedPrimarySpecialty(db: PrismaTx, providerProfileId: string) {
  const profile = await db.providerProfile.findUnique({
    where: { id: providerProfileId },
    select: {
      primaryServiceCategoryId: true,
      serviceCategories: { include: { serviceCategory: true } },
      categoryApplications: {
        where: { status: 'PENDING', supersededAt: null },
        include: { serviceCategory: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  // An explicitly chosen primary is not replaced, including one later retired.
  if (!profile || profile.primaryServiceCategoryId != null) return null;

  const candidates = [
    ...(profile.serviceCategories ?? []).map((row) => row.serviceCategory),
    ...(profile.categoryApplications ?? []).map((row) => row.serviceCategory),
  ].filter((category) => category.isLeaf && category.isActive && category.deletedAt === null);
  candidates.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const category = candidates[0];
  if (!category) return null;

  // Recheck membership and eligibility at write time. An explicit primary or
  // withdrawn application arriving after the read must win this race.
  const eligibleCategory = { isLeaf: true, isActive: true, deletedAt: null };
  const written = await db.providerProfile.updateMany({
    where: {
      id: providerProfileId,
      primaryServiceCategoryId: null,
      OR: [
        {
          serviceCategories: {
            some: { serviceCategoryId: category.id, serviceCategory: eligibleCategory },
          },
        },
        {
          categoryApplications: {
            some: {
              serviceCategoryId: category.id,
              status: 'PENDING',
              supersededAt: null,
              serviceCategory: eligibleCategory,
            },
          },
        },
      ],
    },
    data: { primaryServiceCategoryId: category.id },
  });
  return written.count === 1 ? category : null;
}
