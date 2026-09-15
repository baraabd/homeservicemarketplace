import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';
import type { Prisma, VerificationCaseState } from '@homeservicemarketplace/database';

export type AdminProviderDirectoryFilters = Omit<
  ListAdminProvidersQuery,
  'status' | 'limit' | 'cursor'
> & {
  reviewerUserId?: string;
};

// The partial unique index guarantees at most one open case per provider.
// Historical assignments never match an operational assignment filter.
const OPEN_CASE_STATES: VerificationCaseState[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
];

/** Date-only filters denote UTC calendar days; a full ISO timestamp stays exact. */
export function adminSubmissionDate(value: string, endOfDay = false): Date {
  const date = new Date(value);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function adminProviderWhere(
  args: AdminProviderDirectoryFilters,
): Prisma.ProviderProfileWhereInput {
  const and: Prisma.ProviderProfileWhereInput[] = [{ deletedAt: null }];
  if (args.userId) and.push({ userId: args.userId });
  if (args.query)
    and.push({
      OR: [
        { displayName: { contains: args.query, mode: 'insensitive' } },
        { user: { is: { email: { contains: args.query, mode: 'insensitive' } } } },
      ],
    });
  if (args.country) and.push({ serviceAreaCountryCode: args.country.toUpperCase() });
  if (args.identityState)
    and.push(
      args.identityState === 'UNVERIFIED'
        ? { OR: [{ verificationState: 'UNVERIFIED' }, { verificationState: null }] }
        : { verificationState: args.identityState },
    );
  if (args.portfolioState)
    and.push({
      portfolioItems: {
        some: {
          moderationState: args.portfolioState,
          deletedAt: null,
        },
      },
    });
  if (args.submittedFrom || args.submittedTo)
    and.push({
      submittedForReviewAt: {
        ...(args.submittedFrom ? { gte: adminSubmissionDate(args.submittedFrom) } : {}),
        ...(args.submittedTo ? { lte: adminSubmissionDate(args.submittedTo, true) } : {}),
      },
    });
  if (args.assignment === 'MINE')
    and.push({
      verificationCases: {
        some: {
          state: { in: OPEN_CASE_STATES },
          assignedToUserId: args.reviewerUserId,
        },
      },
    });
  if (args.assignment === 'UNASSIGNED')
    and.push({
      verificationCases: {
        none: {
          state: { in: OPEN_CASE_STATES },
          assignedToUserId: { not: null },
        },
      },
    });
  return { AND: and };
}

export function adminProviderInclude(now: Date) {
  return {
    user: { select: { id: true, email: true, status: true, isActive: true, deletedAt: true } },
    serviceCategories: {
      select: {
        serviceCategory: {
          select: { id: true, slug: true, labelEn: true, labelAr: true },
        },
      },
    },
    verificationCases: {
      where: { state: { in: OPEN_CASE_STATES } },
      take: 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        state: true,
        submittedAt: true,
        assignedTo: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    },
    workAccessGrants: {
      where: {
        status: 'ACTIVE',
        revokedAt: null,
        grantedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      take: 1,
      select: { id: true },
    },
  } satisfies Prisma.ProviderProfileInclude;
}

export type AdminProviderDirectoryRow = Prisma.ProviderProfileGetPayload<{
  include: ReturnType<typeof adminProviderInclude>;
}> & { portfolioSummary: { total: number; pending: number; approved: number; rejected: number } };
