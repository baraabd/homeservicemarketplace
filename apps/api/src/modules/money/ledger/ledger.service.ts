import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  AuditEventType,
  type LedgerAccount,
  type LedgerAccountOwnerType,
  type LedgerEntrySide,
  type PrismaTx,
} from '@homeservicemarketplace/database';

import {
  LedgerRepository,
  isLedgerUniqueViolation,
  type LedgerTransactionWithEntries,
} from '../../../infrastructure/persistence/ledger/ledger.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../../iam/audit/audit.service';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { MoneyDomainError, assertBalancedLedger, normalizeCurrency } from '../money-domain';

// R15 — the posting authority of the dark double-entry ledger.
//
// docs/production-readiness/r15/ACCOUNTING_POLICY.md
//
// Nothing in R15 calls this service on a live path: there is no route, no
// payment rail and no automatic posting from bookings. It exists so that a
// later, explicitly approved money feature has one authoritative, tested way
// to record an accounting event.
//
// Who may call it:
//   - an internal SYSTEM caller, named for the audit trail; reachable only
//     from server code, never from a request;
//   - a USER actor, only while a fresh database read shows the
//     `ledger:read` / `ledger:post` capability. R15 grants those to no role.

export const LEDGER_READ = 'ledger:read';
export const LEDGER_POST = 'ledger:post';

export type LedgerActor = { kind: 'SYSTEM'; system: string } | { kind: 'USER'; userId: string };

export interface LedgerLineInput {
  accountId: string;
  side: LedgerEntrySide;
  amountMinor: bigint;
}

export interface PostLedgerTransactionCommand {
  idempotencyKey: string;
  currency: string;
  description: string;
  lines: LedgerLineInput[];
  /** Why the record exists. Never evidence that money moved. */
  bookingId?: string | null;
  /** Opaque external identifier. Never evidence of capture or settlement. */
  externalReference?: string | null;
}

export interface ReverseLedgerTransactionCommand {
  idempotencyKey: string;
  transactionId: string;
  description: string;
}

export interface OpenLedgerAccountCommand {
  key: string;
  ownerType: LedgerAccountOwnerType;
  ownerUserId?: string | null;
  currency: string;
}

export interface LedgerEntryView {
  lineNo: number;
  accountId: string;
  side: LedgerEntrySide;
  amountMinor: bigint;
}

export interface LedgerTransactionView {
  id: string;
  kind: 'STANDARD' | 'REVERSAL';
  status: 'POSTED';
  currency: string;
  description: string;
  bookingId: string | null;
  externalReference: string | null;
  reversesTransactionId: string | null;
  postedAt: string;
  entries: LedgerEntryView[];
}

export interface LedgerPostingResult {
  transaction: LedgerTransactionView;
  replayed: boolean;
}

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ACCOUNT_KEY_RE = /^[a-z0-9][a-z0-9:._-]{2,119}$/;
const SYSTEM_RE = /^[a-z][a-z0-9._-]{2,63}$/;
const MAX_LINES = 100;
const MAX_HISTORY_PAGE = 200;
// Wait for a pooled connection rather than failing a legitimate command under
// a short burst; the posting itself is a handful of statements.
const LEDGER_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

@Injectable()
export class LedgerService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly permissions: PermissionResolverService,
  ) {}

  // ─── Accounts ──────────────────────────────────────────────────────────

  async openAccount(
    actor: LedgerActor,
    command: OpenLedgerAccountCommand,
    callerTx?: PrismaTx,
  ): Promise<{ account: LedgerAccount; replayed: boolean }> {
    const key = requirePattern(
      command.key,
      ACCOUNT_KEY_RE,
      'A valid ledger account key is required.',
    );
    const currency = currencyOf(command.currency);
    const ownerUserId = command.ownerUserId ?? null;
    if ((command.ownerType === 'PLATFORM') !== (ownerUserId === null)) {
      throw invalid('A platform account has no owner; a user account needs one.');
    }
    const wanted = { key, ownerType: command.ownerType, ownerUserId, currency };
    const replay = (existing: LedgerAccount) => {
      if (
        existing.ownerType !== wanted.ownerType ||
        existing.ownerUserId !== wanted.ownerUserId ||
        existing.currency !== wanted.currency
      ) {
        throw conflict('LEDGER_ACCOUNT_KEY_CONFLICT', 'This ledger account key is already in use.');
      }
      return { account: existing, replayed: true };
    };

    const execute = async (tx: PrismaTx) => {
      await this.authorize(actor, LEDGER_POST, tx);
      const existing = await this.repo.findAccountByKey(key, tx);
      if (existing) return replay(existing);
      return { account: await this.repo.createAccount(wanted, tx), replayed: false };
    };
    // An enlisted operation never commits independently or recovers outside
    // the caller's transaction. Its owner must propagate errors and retry the
    // whole transaction, not continue after a PostgreSQL uniqueness failure.
    if (callerTx) return execute(callerTx);

    try {
      return await this.tx.run(execute, LEDGER_TX_OPTIONS);
    } catch (error) {
      if (!isLedgerUniqueViolation(error, 'key')) throw error;
      const existing = await this.repo.findAccountByKey(key);
      if (!existing) throw error;
      return replay(existing);
    }
  }

  // ─── Posting ───────────────────────────────────────────────────────────

  async post(
    actor: LedgerActor,
    command: PostLedgerTransactionCommand,
    callerTx?: PrismaTx,
  ): Promise<LedgerPostingResult> {
    const key = requirePattern(
      command.idempotencyKey,
      KEY_RE,
      'A valid ledger idempotency key is required.',
    );
    const currency = currencyOf(command.currency);
    const description = describe(command.description);
    const bookingId = optionalText(command.bookingId, 64, 'bookingId');
    const externalReference = optionalText(command.externalReference, 200, 'externalReference');
    const lines = linesOf(command.lines, currency);
    const digest = digestOf({
      op: 'post',
      actor: actorTag(actor),
      currency,
      description,
      bookingId,
      externalReference,
      lines: lines.map((l) => [l.accountId, l.side, l.amountMinor.toString()]),
    });

    return this.write(
      actor,
      key,
      digest,
      async (tx) => {
        const accounts = await this.repo.findAccounts(
          [...new Set(lines.map((l) => l.accountId))],
          tx,
        );
        const byId = new Map(accounts.map((a) => [a.id, a]));
        for (const line of lines) {
          const account = byId.get(line.accountId);
          if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found.', 404);
          if (account.currency !== currency) {
            throw invalid('Every line must use an account in the transaction currency.');
          }
        }
        if (bookingId && !(await this.repo.bookingExists(bookingId, tx))) {
          throw new AppError('NOT_FOUND', 'Booking not found.', 404);
        }
        return {
          header: {
            kind: 'STANDARD' as const,
            currency,
            description,
            bookingId,
            externalReference,
            reversesTransactionId: null,
          },
          lines,
        };
      },
      callerTx,
    );
  }

  async reverse(
    actor: LedgerActor,
    command: ReverseLedgerTransactionCommand,
    callerTx?: PrismaTx,
  ): Promise<LedgerPostingResult> {
    const key = requirePattern(
      command.idempotencyKey,
      KEY_RE,
      'A valid ledger idempotency key is required.',
    );
    const description = describe(command.description);
    const transactionId = requirePattern(
      command.transactionId,
      /^[A-Za-z0-9_-]{1,64}$/,
      'A valid ledger transaction id is required.',
    );
    const digest = digestOf({ op: 'reverse', actor: actorTag(actor), transactionId, description });

    try {
      return await this.write(
        actor,
        key,
        digest,
        async (tx) => {
          const original = await this.repo.findTransaction(transactionId, tx);
          if (!original || original.status !== 'POSTED') {
            throw new AppError('NOT_FOUND', 'Posted ledger transaction not found.', 404);
          }
          if (original.kind !== 'STANDARD') {
            throw conflict('LEDGER_REVERSAL_OF_REVERSAL', 'A reversal cannot itself be reversed.');
          }
          if (await this.repo.findReversalOf(original.id, tx)) {
            throw conflict(
              'LEDGER_ALREADY_REVERSED',
              'This ledger transaction is already reversed.',
            );
          }
          return {
            header: {
              kind: 'REVERSAL' as const,
              currency: original.currency,
              description,
              bookingId: original.bookingId,
              externalReference: original.externalReference,
              reversesTransactionId: original.id,
            },
            lines: original.entries.map((e) => ({
              accountId: e.accountId,
              side: (e.side === 'DEBIT' ? 'CREDIT' : 'DEBIT') as LedgerEntrySide,
              amountMinor: e.amountMinor,
            })),
          };
        },
        callerTx,
      );
    } catch (error) {
      // Lost the race to another reversal of the same original under a
      // different key: the unique reversesTransactionId decided it.
      if (isLedgerUniqueViolation(error, 'reversesTransactionId')) {
        throw conflict('LEDGER_ALREADY_REVERSED', 'This ledger transaction is already reversed.');
      }
      throw error;
    }
  }

  /**
   * One logical command, exactly once. The idempotency key is unique in the
   * database; a concurrent duplicate either waits and replays, or loses the
   * unique race and replays after this transaction rolls back. When a caller
   * supplies a transaction, no nested transaction or out-of-transaction replay
   * is attempted: the caller propagates failures and retries its whole unit.
   */
  private async write(
    actor: LedgerActor,
    key: string,
    digest: string,
    prepare: (tx: PrismaTx) => Promise<{
      header: {
        kind: 'STANDARD' | 'REVERSAL';
        currency: string;
        description: string;
        bookingId: string | null;
        externalReference: string | null;
        reversesTransactionId: string | null;
      };
      lines: LedgerLineInput[];
    }>,
    callerTx?: PrismaTx,
  ): Promise<LedgerPostingResult> {
    const execute = async (tx: PrismaTx): Promise<LedgerPostingResult> => {
      await this.authorize(actor, LEDGER_POST, tx);
      const existing = await this.repo.findTransactionByKey(key, tx);
      if (existing) return replay(existing, digest);

      const { header, lines } = await prepare(tx);
      const draft = await this.repo.createDraft(
        {
          ...header,
          idempotencyKey: key,
          requestDigest: digest,
          actorUserId: actor.kind === 'USER' ? actor.userId : null,
          actorSystem: actor.kind === 'SYSTEM' ? actor.system : null,
        },
        tx,
      );
      let lineNo = 0;
      for (const line of lines) {
        lineNo += 1;
        await this.repo.insertEntry(
          { transactionId: draft.id, lineNo, currency: header.currency, ...line },
          tx,
        );
      }
      await this.repo.markPosted(draft.id, tx);
      // Part of the same database transaction: if the audit row cannot be
      // written, nothing is posted (AuditService rethrows).
      await this.audit.record(
        {
          type:
            header.kind === 'REVERSAL'
              ? AuditEventType.MONEY_LEDGER_REVERSED
              : AuditEventType.MONEY_LEDGER_POSTED,
          userId: actor.kind === 'USER' ? actor.userId : undefined,
          metadata: {
            ledgerTransactionId: draft.id,
            reversesTransactionId: header.reversesTransactionId,
            bookingId: header.bookingId,
            actorSystem: actor.kind === 'SYSTEM' ? actor.system : null,
          },
        },
        tx,
      );
      const posted = await this.repo.findTransaction(draft.id, tx);
      if (!posted)
        throw new AppError('INTERNAL_ERROR', 'Failed to reload ledger transaction.', 500);
      return { transaction: toView(posted), replayed: false };
    };
    // The enclosing operation owns commit/rollback. The returned view is
    // provisional until that transaction commits; it must not be sent as an
    // acknowledgement or trigger an external effect before then.
    if (callerTx) return execute(callerTx);

    try {
      return await this.tx.run(execute, LEDGER_TX_OPTIONS);
    } catch (error) {
      if (!isLedgerUniqueViolation(error)) throw error;
      const existing = await this.repo.findTransactionByKey(key);
      if (!existing) throw error;
      return replay(existing, digest);
    }
  }

  // ─── Reads (derived from posted entries only) ──────────────────────────

  async getTransaction(actor: LedgerActor, id: string): Promise<LedgerTransactionView> {
    await this.authorize(actor, LEDGER_READ);
    const row = await this.repo.findTransaction(id);
    if (!row || row.status !== 'POSTED') {
      throw new AppError('NOT_FOUND', 'Posted ledger transaction not found.', 404);
    }
    return toView(row);
  }

  async balance(actor: LedgerActor, accountId: string) {
    await this.authorize(actor, LEDGER_READ);
    const account = await this.repo.findAccount(accountId);
    if (!account) throw new AppError('NOT_FOUND', 'Ledger account not found.', 404);
    const sums = await this.repo.balance(accountId);
    return { accountId, currency: account.currency, ...sums };
  }

  async history(actor: LedgerActor, accountId: string, limit = 50, cursor?: string) {
    await this.authorize(actor, LEDGER_READ);
    const take = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_HISTORY_PAGE);
    const rows = await this.repo.history(accountId, take + 1, cursor);
    const page = rows.slice(0, take);
    return {
      items: page.map((row) => ({
        entryId: row.id,
        transactionId: row.transactionId,
        kind: row.transaction.kind,
        description: row.transaction.description,
        reversesTransactionId: row.transaction.reversesTransactionId,
        bookingId: row.transaction.bookingId,
        postedAt: row.transaction.postedAt?.toISOString() ?? null,
        side: row.side,
        amountMinor: row.amountMinor,
        currency: row.currency,
      })),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  // ─── Authority ─────────────────────────────────────────────────────────

  private async authorize(actor: LedgerActor, permission: string, tx?: PrismaTx): Promise<void> {
    if (actor.kind === 'SYSTEM') {
      if (typeof actor.system !== 'string' || !SYSTEM_RE.test(actor.system)) {
        throw new AppError('FORBIDDEN', 'An internal ledger caller must be named.', 403);
      }
      return;
    }
    if (actor.kind !== 'USER' || typeof actor.userId !== 'string' || !actor.userId) {
      throw new AppError('FORBIDDEN', 'Ledger access requires an authorized actor.', 403);
    }
    const rights = await this.permissions.resolveFreshForUser(actor.userId, tx);
    if (!rights.has(permission)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to use the ledger.', 403);
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

function replay(existing: LedgerTransactionWithEntries, digest: string): LedgerPostingResult {
  // A different digest is a different command — or a different actor. Either
  // way nothing about the stored transaction is returned.
  if (existing.requestDigest !== digest || existing.status !== 'POSTED') {
    throw conflict(
      'LEDGER_IDEMPOTENCY_CONFLICT',
      'This ledger idempotency key was already used for a different command.',
    );
  }
  return { transaction: toView(existing), replayed: true };
}

function toView(row: LedgerTransactionWithEntries): LedgerTransactionView {
  if (row.status !== 'POSTED' || !row.postedAt) {
    throw new AppError(
      'INTERNAL_ERROR',
      'An unposted ledger transaction is not authoritative.',
      500,
    );
  }
  return {
    id: row.id,
    kind: row.kind,
    status: 'POSTED',
    currency: row.currency,
    description: row.description,
    bookingId: row.bookingId,
    externalReference: row.externalReference,
    reversesTransactionId: row.reversesTransactionId,
    postedAt: row.postedAt.toISOString(),
    entries: row.entries.map((e) => ({
      lineNo: e.lineNo,
      accountId: e.accountId,
      side: e.side,
      amountMinor: e.amountMinor,
    })),
  };
}

function linesOf(raw: unknown, currency: string): LedgerLineInput[] {
  if (!Array.isArray(raw) || raw.length > MAX_LINES) {
    throw invalid(`A ledger transaction has between 2 and ${MAX_LINES} lines.`);
  }
  const lines = raw.map((line: Partial<LedgerLineInput> | null) => ({
    accountId: typeof line?.accountId === 'string' ? line.accountId : '',
    side: line?.side as LedgerEntrySide,
    amountMinor: line?.amountMinor as bigint,
  }));
  try {
    assertBalancedLedger(lines.map((l) => ({ ...l, currency })));
  } catch (error) {
    if (error instanceof MoneyDomainError) throw invalid(error.message, error.code);
    throw error;
  }
  return lines;
}

function currencyOf(raw: unknown): string {
  try {
    return normalizeCurrency(raw as string);
  } catch (error) {
    if (error instanceof MoneyDomainError) throw invalid(error.message, error.code);
    throw error;
  }
}

function describe(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('A ledger description is required.');
  const value = raw.normalize('NFC').trim();
  if (!value || [...value].length > 200)
    throw invalid('A ledger description has 1 to 200 characters.');
  return value;
}

function optionalText(raw: unknown, max: number, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) {
    throw invalid(`${field} must be a non-empty string of at most ${max} characters.`);
  }
  return raw.trim();
}

function requirePattern(raw: unknown, pattern: RegExp, message: string): string {
  if (typeof raw !== 'string' || !pattern.test(raw)) throw invalid(message);
  return raw;
}

function actorTag(actor: LedgerActor): string {
  return actor.kind === 'USER' ? `user:${actor.userId}` : `system:${actor.system}`;
}

/** SHA-256 of a canonical JSON array/object built by the caller in fixed key order. */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function invalid(message: string, reason?: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400, reason ? { reason } : undefined);
}

function conflict(reason: string, message: string): AppError {
  return new AppError('CONFLICT', message, 409, { reason });
}
