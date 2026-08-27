import { Injectable } from '@nestjs/common';
import type { VerificationCaseState } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { offerableCaseActions } from '../../provider/verification/policy/case-transitions';

// Sprint 9B.6 — the reviewer's work list.
//
// A QUEUE, not a table dump. Three decisions carry most of its value:
//
//   OLDEST FIRST. A review list ordered newest-first starves whoever has waited
//   longest, which is precisely how a backlog becomes an unfairness rather than
//   a delay. Ordered by submittedAt with id as the tie-break, so the order is
//   total and the cursor is stable.
//
//   LIVE CASES BY DEFAULT. Someone opening the queue wants work, not a museum
//   of everything that ever happened. Terminal cases are reachable by asking
//   for them explicitly.
//
//   ACTIONS PER ROW, from the canonical resolver, with self-review already
//   removed. A queue that shows buttons the mutation will refuse teaches people
//   to click and hope — the D-3 lesson, applied to a list.
//
// It selects NOTHING that identifies a document. Storage keys, filenames and
// hashes belong behind the audited read route, not in a page a reviewer leaves
// open all day.

/** The states a case is still actionable in. */
const LIVE_STATES: readonly VerificationCaseState[] = ['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'];

const ALL_STATES: readonly VerificationCaseState[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
];

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface VerificationQueueQuery {
  state?: VerificationCaseState;
  policyVersion?: string;
  search?: string;
  /** Sprint 9B.12 — submission window, inclusive at both ends. A queue with no
   *  date filter forces a reviewer working a backlog to page through
   *  everything to reach last week's submissions. */
  submittedFrom?: string;
  submittedTo?: string;
  limit?: number;
  cursor?: string;
}

export interface VerificationQueueItem {
  id: string;
  providerProfileId: string;
  providerDisplayName: string | null;
  state: VerificationCaseState;
  policyVersion: string;
  country: string | null;
  submittedAt: string | null;
  assignedToUserId: string | null;
  documentCount: number;
  availableActions: string[];
  blockedReason: 'SELF_REVIEW' | null;
}

export interface VerificationQueuePage {
  items: VerificationQueueItem[];
  nextCursor: string | null;
}

/** An inclusive date window for `submittedAt`, or null when neither end was
 *  given. Throws on anything it cannot parse. */
function parseRange(from?: string, to?: string): { gte?: Date; lte?: Date } | null {
  const parse = (value: string, field: string): Date => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Unusable date filter.', 400, {
        reason: 'UNPARSEABLE_DATE',
        field,
      });
    }
    return d;
  };

  const gte = from ? parse(from, 'submittedFrom') : undefined;
  const lte = to ? parse(to, 'submittedTo') : undefined;
  if (gte === undefined && lte === undefined) return null;
  if (gte && lte && gte.getTime() > lte.getTime()) {
    // An inverted window matches nothing, and a reviewer staring at an empty
    // queue would reasonably conclude there is no work rather than that they
    // typed the dates the wrong way round.
    throw new AppError('VALIDATION_ERROR', 'The date range ends before it begins.', 400, {
      reason: 'INVERTED_DATE_RANGE',
    });
  }
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

@Injectable()
export class AdminVerificationQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: VerificationQueueQuery,
    reviewerUserId: string,
  ): Promise<VerificationQueuePage> {
    const take = this.pageSize(query.limit);
    const search = (query.search ?? '').trim();

    // The submission window. An unparseable date is REFUSED rather than
    // dropped, for the same reason an unknown state is: a filter that silently
    // does nothing shows a list that does not match what was asked for, and it
    // looks like an answer.
    const range = parseRange(query.submittedFrom, query.submittedTo);

    if (query.state !== undefined && !ALL_STATES.includes(query.state)) {
      // Refused rather than ignored. Silently dropping an unknown filter shows
      // a list that does not match what was asked for, which is worse than an
      // error because it looks like an answer.
      throw new AppError('VALIDATION_ERROR', 'Unknown verification case state.', 400, {
        reason: 'UNKNOWN_STATE',
      });
    }

    const rows = (await this.prisma.client.verificationCase.findMany({
      where: {
        // A single state when asked for, the live set otherwise. Applied even
        // alongside a search, so searching can only ever NARROW the queue.
        state: query.state ?? { in: [...LIVE_STATES] },
        ...(query.policyVersion ? { policyVersion: query.policyVersion } : {}),
        ...(search.length > 0
          ? { providerProfile: { displayName: { contains: search, mode: 'insensitive' } } }
          : {}),
        ...(range ? { submittedAt: range } : {}),
      },
      select: {
        id: true,
        providerProfileId: true,
        state: true,
        policyVersion: true,
        country: true,
        submittedAt: true,
        assignedToUserId: true,
        providerProfile: { select: { displayName: true, userId: true } },
        _count: { select: { documents: true } },
      },
      // Total order: submittedAt can tie (or be null on a draft), and a cursor
      // over a non-total order silently skips or repeats rows.
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      // One extra row, so "is there a next page" is known without a second
      // count query over the whole queue.
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })) as Array<{
      id: string;
      providerProfileId: string;
      state: VerificationCaseState;
      policyVersion: string;
      country: string | null;
      submittedAt: Date | null;
      assignedToUserId: string | null;
      providerProfile: { displayName: string | null; userId: string | null } | null;
      _count: { documents: number };
    }>;

    const page = rows.slice(0, take);
    const items = page.map((row) => {
      // Self-review removed here as well as refused at the mutation.
      const isSelf =
        row.providerProfile?.userId != null && row.providerProfile.userId === reviewerUserId;

      return {
        id: row.id,
        providerProfileId: row.providerProfileId,
        providerDisplayName: row.providerProfile?.displayName ?? null,
        state: row.state,
        policyVersion: row.policyVersion,
        country: row.country,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        assignedToUserId: row.assignedToUserId,
        documentCount: row._count.documents,
        availableActions: isSelf ? [] : offerableCaseActions(row.state, 'reviewer'),
        blockedReason: isSelf ? ('SELF_REVIEW' as const) : null,
      };
    });

    return {
      items,
      nextCursor: rows.length > take ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Clamp UP but refuse nonsense.
   *
   * An absurdly large page is clamped, because the caller's intent is obvious
   * and a clamp costs them nothing. Zero or negative is REFUSED, because there
   * is no sensible interpretation and silently substituting a default answers a
   * question nobody asked.
   */
  private pageSize(limit?: number): number {
    if (limit === undefined) return DEFAULT_PAGE_SIZE;
    if (!Number.isFinite(limit) || limit < 1) {
      throw new AppError('VALIDATION_ERROR', 'limit must be a positive integer.', 400, {
        reason: 'INVALID_LIMIT',
      });
    }
    return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
  }
}
