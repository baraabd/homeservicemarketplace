import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type LedgerAccount,
  type LedgerAccountOwnerType,
  type LedgerEntry,
  type LedgerEntrySide,
  type LedgerTransaction,
  type LedgerTransactionKind,
  type PrismaTx,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// R15 — persistence for the dark double-entry ledger.
//
// Every write here runs inside the caller's database transaction. The
// repository never decides whether a posting is valid: the service checks the
// command, and the PostgreSQL triggers in 20261004150000_r15_ledger_foundation
// refuse anything unbalanced, mixed-currency, half-written or edited.

export type LedgerTransactionWithEntries = LedgerTransaction & { entries: LedgerEntry[] };

export interface LedgerHistoryRow extends LedgerEntry {
  transaction: Pick<
    LedgerTransaction,
    'id' | 'kind' | 'description' | 'postedAt' | 'reversesTransactionId' | 'bookingId'
  >;
}

const ENTRY_ORDER = [{ lineNo: 'asc' }] as const;

@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findAccountByKey(key: string, tx?: PrismaTx): Promise<LedgerAccount | null> {
    return this.db(tx).ledgerAccount.findUnique({ where: { key } });
  }

  findAccount(id: string, tx?: PrismaTx): Promise<LedgerAccount | null> {
    return this.db(tx).ledgerAccount.findUnique({ where: { id } });
  }

  findAccounts(ids: string[], tx: PrismaTx): Promise<LedgerAccount[]> {
    return tx.ledgerAccount.findMany({ where: { id: { in: ids } } });
  }

  createAccount(
    input: {
      key: string;
      ownerType: LedgerAccountOwnerType;
      ownerUserId: string | null;
      currency: string;
    },
    tx?: PrismaTx,
  ): Promise<LedgerAccount> {
    return this.db(tx).ledgerAccount.create({ data: input });
  }

  findTransactionByKey(
    idempotencyKey: string,
    tx?: PrismaTx,
  ): Promise<LedgerTransactionWithEntries | null> {
    return this.db(tx).ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: { orderBy: [...ENTRY_ORDER] } },
    });
  }

  findTransaction(id: string, tx?: PrismaTx): Promise<LedgerTransactionWithEntries | null> {
    return this.db(tx).ledgerTransaction.findUnique({
      where: { id },
      include: { entries: { orderBy: [...ENTRY_ORDER] } },
    });
  }

  findReversalOf(id: string, tx?: PrismaTx): Promise<LedgerTransaction | null> {
    return this.db(tx).ledgerTransaction.findUnique({ where: { reversesTransactionId: id } });
  }

  bookingExists(bookingId: string, tx: PrismaTx): Promise<boolean> {
    return tx.booking.count({ where: { id: bookingId } }).then((n) => n === 1);
  }

  createDraft(
    input: {
      kind: LedgerTransactionKind;
      currency: string;
      description: string;
      idempotencyKey: string;
      requestDigest: string;
      bookingId: string | null;
      externalReference: string | null;
      reversesTransactionId: string | null;
      actorUserId: string | null;
      actorSystem: string | null;
    },
    tx: PrismaTx,
  ): Promise<LedgerTransaction> {
    return tx.ledgerTransaction.create({ data: input });
  }

  insertEntry(
    input: {
      transactionId: string;
      lineNo: number;
      accountId: string;
      side: LedgerEntrySide;
      amountMinor: bigint;
      currency: string;
    },
    tx: PrismaTx,
  ): Promise<LedgerEntry> {
    return tx.ledgerEntry.create({ data: input });
  }

  /** DRAFT -> POSTED. The database trigger validates every invariant here. */
  markPosted(id: string, tx: PrismaTx): Promise<LedgerTransaction> {
    return tx.ledgerTransaction.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
  }

  /** Sums over POSTED entries only. Text casts keep bigint precision. */
  async balance(accountId: string): Promise<{ debitMinor: bigint; creditMinor: bigint }> {
    const rows = await this.prisma.client.$queryRaw<
      Array<{ debit: string; credit: string }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(e."amountMinor") FILTER (WHERE e."side" = 'DEBIT'), 0)::text AS debit,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE e."side" = 'CREDIT'), 0)::text AS credit
        FROM "LedgerEntry" e
        JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
       WHERE e."accountId" = ${accountId} AND t."status" = 'POSTED'`);
    const row = rows[0] ?? { debit: '0', credit: '0' };
    return { debitMinor: BigInt(row.debit), creditMinor: BigInt(row.credit) };
  }

  /** Newest first; entries are immutable, so (createdAt, id) paging is stable. */
  history(accountId: string, take: number, cursor?: string): Promise<LedgerHistoryRow[]> {
    return this.prisma.client.ledgerEntry.findMany({
      where: { accountId, transaction: { status: 'POSTED' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        transaction: {
          select: {
            id: true,
            kind: true,
            description: true,
            postedAt: true,
            reversesTransactionId: true,
            bookingId: true,
          },
        },
      },
    });
  }
}

/** True for a unique violation on the named column (P2002). */
export function isLedgerUniqueViolation(error: unknown, column?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!column) return true;
  const target = (error.meta as { target?: string | string[] } | undefined)?.target;
  const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return columns.some((c) => c === column || c.includes(column));
}
