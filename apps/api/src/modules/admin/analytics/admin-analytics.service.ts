import { Injectable } from '@nestjs/common';
import type {
  AdminAnalyticsResponse,
  AdminAnalyticsSummary,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const DEFAULT_CURRENCY = 'USD';

// Sprint 6.4 — admin KPI summary. All counts via Prisma aggregates;
// no timeseries here. Runs every count in parallel so the response
// time tracks the slowest single COUNT, not their sum.
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(): Promise<AdminAnalyticsResponse> {
    const c = this.prisma.client;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      usersTotal,
      usersActive,
      usersSuspended,
      usersPending,
      usersNew7d,
      providersTotal,
      providersActive,
      providersPending,
      providersSuspended,
      providersRejected,
      reqOpen,
      reqAccepted,
      reqCompleted,
      bkScheduled,
      bkInProgress,
      bkCompleted,
      bkCancelled,
      bkGrossLifetime,
      bkGross30d,
      bkDominantCurrency,
      // Disputes use the typed-stub repo path; access via prisma.client cast.
      disputesOpen,
      disputesInReview,
      disputesResolved,
    ] = await Promise.all([
      c.user.count({ where: { deletedAt: null } }),
      c.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      c.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      c.user.count({ where: { deletedAt: null, status: 'PENDING_VERIFICATION' } }),
      c.user.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
      c.providerProfile.count({ where: { deletedAt: null } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'PENDING_REVIEW' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'REJECTED' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'OPEN_FOR_BIDS' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'BID_ACCEPTED' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'SCHEDULED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'IN_PROGRESS' } }),
      c.booking.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'CANCELLED' } }),
      c.booking.aggregate({
        where: { deletedAt: null, status: 'COMPLETED' },
        _sum: { priceAmount: true },
      }),
      c.booking.aggregate({
        where: {
          deletedAt: null,
          status: 'COMPLETED',
          updatedAt: { gte: thirtyDaysAgo },
        },
        _sum: { priceAmount: true },
      }),
      c.booking.groupBy({
        by: ['currency'],
        where: { deletedAt: null, status: 'COMPLETED' },
        _count: { currency: true },
        orderBy: { _count: { currency: 'desc' } },
        take: 1,
      }),
      // Disputes — use cast since the generated client may not
      // include the model in this dev shell (see DisputeRepository
      // for context).
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'OPEN' },
      }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'IN_REVIEW' },
      }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: {
          deletedAt: null,
          status: { in: ['RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'] },
        },
      }),
    ]);

    const summary: AdminAnalyticsSummary = {
      users: {
        total: usersTotal,
        active: usersActive,
        suspended: usersSuspended,
        pendingVerification: usersPending,
        newLast7Days: usersNew7d,
      },
      providers: {
        total: providersTotal,
        active: providersActive,
        pendingReview: providersPending,
        suspended: providersSuspended,
        rejected: providersRejected,
      },
      requests: {
        openForBids: reqOpen,
        bidAccepted: reqAccepted,
        completed: reqCompleted,
      },
      bookings: {
        scheduled: bkScheduled,
        inProgress: bkInProgress,
        completed: bkCompleted,
        cancelled: bkCancelled,
        grossLifetimeAmount: bkGrossLifetime._sum.priceAmount ?? 0,
        grossLast30DaysAmount: bkGross30d._sum.priceAmount ?? 0,
        currency: bkDominantCurrency[0]?.currency ?? DEFAULT_CURRENCY,
      },
      disputes: {
        open: disputesOpen,
        inReview: disputesInReview,
        resolvedLifetime: disputesResolved,
      },
      generatedAt: new Date().toISOString(),
    };
    return { summary };
  }
}
