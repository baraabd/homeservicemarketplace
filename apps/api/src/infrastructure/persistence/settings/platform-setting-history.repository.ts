import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 8 — append-only history for platform settings.
//
// PlatformSetting holds only the current value and who last touched it. That
// cannot answer "what was this threshold when the decision was made?", which
// is the question that actually gets asked — usually months later, by someone
// disputing an outcome. Every write appends here so the answer outlives the
// next write.
//
// There is deliberately no update and no delete. A mutable audit trail is not
// one, and the ability to rewrite it is worth more to an attacker than the
// setting itself.

export interface PlatformSettingHistoryRow {
  id: string;
  key: string;
  previousValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue;
  changedBy: string | null;
  changedAt: Date;
  reason: string | null;
}

@Injectable()
export class PlatformSettingHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  /** Record one change. Called inside the SAME transaction as the setting
   *  write, so a value can never land without its trail entry — the two
   *  committing separately is how a history grows holes exactly where someone
   *  had a reason to want one. */
  append(
    input: {
      key: string;
      previousValue: Prisma.JsonValue | null;
      newValue: Prisma.JsonValue;
      changedBy: string | null;
      reason?: string | null;
    },
    tx?: PrismaTx,
  ): Promise<PlatformSettingHistoryRow> {
    return this.db(tx).platformSettingHistory.create({
      data: {
        key: input.key,
        previousValue: input.previousValue ?? undefined,
        newValue: input.newValue as Prisma.InputJsonValue,
        changedBy: input.changedBy,
        reason: input.reason ?? null,
      },
    }) as Promise<PlatformSettingHistoryRow>;
  }

  /** Newest first, cursor-paginated.
   *
   *  Ordered by `changedAt DESC, id DESC`: two writes in the same millisecond
   *  are entirely possible in a bulk update, and without the id tiebreak the
   *  cursor would loop over them forever. */
  listByKey(
    args: { key: string; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<PlatformSettingHistoryRow[]> {
    return this.db(tx).platformSettingHistory.findMany({
      where: { key: args.key },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    }) as Promise<PlatformSettingHistoryRow[]>;
  }
}
