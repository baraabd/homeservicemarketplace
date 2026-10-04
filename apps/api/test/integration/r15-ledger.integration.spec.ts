/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * R15 is DB-gated, so the generated Prisma client is loaded lazily only when
 * RUN_DB_INTEGRATION=1.
 */
export {};

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';

import { fixturePrefix } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';
import { registerLedgerCallerTransactionCases } from '../support/ledger-caller-transaction.cases';

// ─────────────────────────────────────────────────────────────────────────────
// R15 — the dark double-entry ledger against real PostgreSQL.
//
// The service is exercised directly (it has no route by design). Every claim
// is checked against the database rows, and every invariant the migration's
// triggers own is also attacked with raw SQL that bypasses the service.
//
// Posted ledger rows are append-only, so this suite never deletes them. Each
// run uses its own prefix; CI runs on a fresh database.
// ─────────────────────────────────────────────────────────────────────────────

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

/** Deterministic PRNG (mulberry32) so a property failure names a reproducible seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

d('R15 - authoritative double-entry ledger (real Postgres)', () => {
  let prisma: any;
  let ledger: any;
  let repo: any;
  let audit: any;
  let close: () => Promise<void>;

  const RUN = randomUUID().replace(/-/g, '').slice(0, 10);
  const P = `${fixturePrefix('r15ledger')}${RUN}-`;
  const KP = `r15${RUN}`; // idempotency keys: [A-Za-z0-9_-]{16,128}
  const AP = `it-r15-${RUN}`; // account keys: lowercase
  const OWNER = `${P}owner`;
  const POSTER = `${P}poster`;
  const NOBODY = `${P}nobody`;
  const SEEKER = `${P}seeker`;
  const PROVIDER_USER = `${P}provider-user`;
  const PROVIDER = `${P}provider`;
  const ROLE_ID = `${P}role`;
  const SYSTEM = { kind: 'SYSTEM', system: 'r15.acceptance' } as const;

  let seq = 0;
  const key = (label: string) => `${KP}_${label}_${(seq += 1)}`.padEnd(16, 'x');

  let usd1: string;
  let usd2: string;
  let usd3: string;
  let sek1: string;
  let bookingId: string;

  async function open(label: string, currency: string, owner?: string): Promise<string> {
    const { account } = await ledger.openAccount(SYSTEM, {
      key: `${AP}:${label}`,
      ownerType: owner ? 'USER' : 'PLATFORM',
      ownerUserId: owner ?? null,
      currency,
    });
    return account.id;
  }

  const transfer = (k: string, from: string, to: string, amount: bigint, extra: object = {}) =>
    ledger.post(SYSTEM, {
      idempotencyKey: k,
      currency: 'USD',
      description: 'R15 acceptance transfer',
      lines: [
        { accountId: from, side: 'DEBIT', amountMinor: amount },
        { accountId: to, side: 'CREDIT', amountMinor: amount },
      ],
      ...extra,
    });

  const rowsByKey = (k: string) => prisma.ledgerTransaction.count({ where: { idempotencyKey: k } });

  async function sql(text: string, ...values: unknown[]): Promise<void> {
    await prisma.$executeRawUnsafe(text, ...values);
  }

  /** Raw SQL that must be refused by the database itself. */
  async function refusedByDb(statements: (tx: any) => Promise<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await prisma.$transaction(async (tx: any) => {
        await statements(tx);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(String((caught as Error)?.message ?? caught)).toMatch(pattern);
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma, isReady: () => true };

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      LedgerRepository,
    } = require('../../src/infrastructure/persistence/ledger/ledger.repository');
    const { LedgerService } = require('../../src/modules/money/ledger/ledger.service');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');

    const flags: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r15-ledger'),
      PERMISSION_CACHE_TTL_SECONDS: 300,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LedgerService,
        LedgerRepository,
        TransactionRunner,
        AuditService,
        AuditEventRepository,
        RoleRepository,
        PermissionResolverService,
        { provide: PrismaService, useValue: prismaSvc },
        {
          provide: AppConfigService,
          useValue: { get: (k: string) => flags[k], isProduction: false },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: () => {
              throw new Error('R15 uses fresh database permissions, never the cache');
            },
          },
        },
      ],
    }).compile();
    ledger = moduleRef.get(LedgerService);
    repo = moduleRef.get(LedgerRepository);
    audit = moduleRef.get(AuditService);
    close = () => moduleRef.close();

    for (const id of [OWNER, POSTER, NOBODY, SEEKER, PROVIDER_USER]) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r15-ledger.test`,
          firstName: 'R15',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    await prisma.providerProfile.create({
      data: {
        id: PROVIDER,
        userId: PROVIDER_USER,
        displayName: 'R15 provider',
        initials: 'R1',
        status: 'ACTIVE',
      },
    });
    bookingId = `${P}booking`;
    await prisma.serviceRequest.create({
      data: {
        id: `${bookingId}-request`,
        seekerUserId: SEEKER,
        scheduleType: 'ASAP',
        addressSnapshot: {},
        status: 'BID_ACCEPTED',
      },
    });
    await prisma.bid.create({
      data: {
        id: `${bookingId}-bid`,
        requestId: `${bookingId}-request`,
        providerId: PROVIDER,
        amount: 100,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await prisma.booking.create({
      data: {
        id: bookingId,
        requestId: `${bookingId}-request`,
        bidId: `${bookingId}-bid`,
        seekerUserId: SEEKER,
        providerId: PROVIDER,
        priceAmount: 100,
        status: 'COMPLETED',
      },
    });

    // A role that holds the ledger capabilities, given to POSTER only. The
    // migration registers them and grants them to no live role.
    const post = await prisma.permission.findUnique({ where: { key: 'ledger:post' } });
    const read = await prisma.permission.findUnique({ where: { key: 'ledger:read' } });
    if (!post || !read) throw new Error('migration did not register ledger:post / ledger:read');
    await prisma.role.create({
      data: {
        id: ROLE_ID,
        name: `${P}ledger-operator`,
        description: 'R15 test role',
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: ROLE_ID, permissionId: post.id },
        { roleId: ROLE_ID, permissionId: read.id },
      ],
    });
    await prisma.userRole.create({ data: { userId: POSTER, roleId: ROLE_ID } });

    usd1 = await open('usd-1', 'USD');
    usd2 = await open('usd-2', 'USD', OWNER);
    usd3 = await open('usd-3', 'USD');
    sek1 = await open('sek-1', 'SEK');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    // Ledger rows are append-only and owner users are RESTRICTed by them;
    // only the role grant is removed. CI uses a disposable database.
    if (prisma) {
      await prisma.userRole.deleteMany({ where: { roleId: ROLE_ID } });
      await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_ID } });
      await prisma.role.deleteMany({ where: { id: ROLE_ID } });
    }
    await close?.();
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── Migration state ───────────────────────────────────────────────────

  it('ships no historical financial backfill and grants the capabilities to no live role', async () => {
    // Only this suite writes the ledger. Every row is ours: nothing was
    // imported from bookings or earnings summaries.
    const foreignTx = await prisma.ledgerTransaction.count({
      where: { NOT: { idempotencyKey: { startsWith: KP } } },
    });
    const foreignAccounts = await prisma.ledgerAccount.count({
      where: { NOT: { key: { startsWith: AP } } },
    });
    expect([foreignTx, foreignAccounts]).toEqual([0, 0]);

    const grants = await prisma.rolePermission.findMany({
      where: { permission: { key: { in: ['ledger:post', 'ledger:read'] } } },
      select: { roleId: true },
    });
    expect(grants.every((g: any) => g.roleId === ROLE_ID)).toBe(true);
  });

  registerLedgerCallerTransactionCases(() => ({
    prisma,
    ledger,
    repo,
    audit,
    system: SYSTEM,
    from: usd1,
    to: usd2,
    markerUserId: NOBODY,
    roleId: ROLE_ID,
    accountPrefix: AP,
    key,
  }));

  // ─── Posting ───────────────────────────────────────────────────────────

  it('posts a balanced transaction atomically, audits identifiers only, and reads back', async () => {
    const k = key('balanced');
    const result = await ledger.post(SYSTEM, {
      idempotencyKey: k,
      currency: 'usd',
      description: 'Three-line balanced posting',
      bookingId,
      externalReference: 'ext-ref-placeholder-001',
      lines: [
        { accountId: usd1, side: 'DEBIT', amountMinor: 1500n },
        { accountId: usd2, side: 'CREDIT', amountMinor: 1000n },
        { accountId: usd3, side: 'CREDIT', amountMinor: 500n },
      ],
    });
    expect(result.replayed).toBe(false);
    expect(result.transaction).toMatchObject({
      kind: 'STANDARD',
      status: 'POSTED',
      currency: 'USD',
      bookingId,
      externalReference: 'ext-ref-placeholder-001',
      reversesTransactionId: null,
    });

    const row = await prisma.ledgerTransaction.findUnique({
      where: { id: result.transaction.id },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    });
    expect(row.status).toBe('POSTED');
    expect(row.postedAt).toBeInstanceOf(Date);
    expect(row.actorSystem).toBe('r15.acceptance');
    expect(row.entries.map((e: any) => [e.lineNo, e.side, e.amountMinor, e.currency])).toEqual([
      [1, 'DEBIT', 1500n, 'USD'],
      [2, 'CREDIT', 1000n, 'USD'],
      [3, 'CREDIT', 500n, 'USD'],
    ]);

    const auditRow = await prisma.auditEvent.findFirst({
      where: {
        type: 'MONEY_LEDGER_POSTED',
        metadata: { path: ['ledgerTransactionId'], equals: row.id },
      },
    });
    expect(auditRow.metadata).toEqual({
      ledgerTransactionId: row.id,
      reversesTransactionId: null,
      bookingId,
      actorSystem: 'r15.acceptance',
    });
    expect(JSON.stringify(auditRow)).not.toMatch(/1500|1000|ext-ref/);

    const balance = await ledger.balance(SYSTEM, usd1);
    expect(balance.currency).toBe('USD');
    expect(balance.debitMinor - balance.creditMinor).toBeGreaterThanOrEqual(1500n);

    // A booking reference explains why the record exists. It does not make
    // the booking paid: no booking column changed.
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking.status).toBe('COMPLETED');
  });

  it.each([
    [
      'unbalanced',
      [
        [1000n, 'DEBIT'],
        [999n, 'CREDIT'],
      ],
    ],
    ['one line', [[1000n, 'DEBIT']]],
    [
      'debits only',
      [
        [500n, 'DEBIT'],
        [500n, 'DEBIT'],
      ],
    ],
    [
      'zero amount',
      [
        [0n, 'DEBIT'],
        [0n, 'CREDIT'],
      ],
    ],
    [
      'negative amount',
      [
        [-5n, 'DEBIT'],
        [-5n, 'CREDIT'],
      ],
    ],
    [
      'number, not bigint',
      [
        [10, 'DEBIT'],
        [10, 'CREDIT'],
      ],
    ],
    [
      'fractional',
      [
        [10.5, 'DEBIT'],
        [10.5, 'CREDIT'],
      ],
    ],
    [
      'bad side',
      [
        [10n, 'LEFT'],
        [10n, 'CREDIT'],
      ],
    ],
  ])('refuses %s without writing anything', async (_label, spec: any) => {
    const k = key('invalid');
    const accounts = [usd1, usd2];
    await expect(
      ledger.post(SYSTEM, {
        idempotencyKey: k,
        currency: 'USD',
        description: 'must not post',
        lines: spec.map(([amountMinor, side]: any, i: number) => ({
          accountId: accounts[i % 2],
          side,
          amountMinor,
        })),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(await rowsByKey(k)).toBe(0);
  });

  it('validates currency: shape, account currency, and never mixes currencies', async () => {
    for (const currency of ['US', 'DOLLAR', '', '12$']) {
      const k = key('cur');
      await expect(transfer(k, usd1, usd2, 10n, { currency })).rejects.toMatchObject({
        status: 400,
      });
      expect(await rowsByKey(k)).toBe(0);
    }
    // A SEK account cannot sit in a USD transaction, even balanced.
    const k = key('mixed');
    await expect(
      ledger.post(SYSTEM, {
        idempotencyKey: k,
        currency: 'USD',
        description: 'USD vs SEK',
        lines: [
          { accountId: usd1, side: 'DEBIT', amountMinor: 100n },
          { accountId: sek1, side: 'CREDIT', amountMinor: 100n },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await rowsByKey(k)).toBe(0);
  });

  it('refuses an unknown account or booking without writing anything', async () => {
    const k1 = key('noacct');
    await expect(transfer(k1, usd1, `${P}missing-account`, 10n)).rejects.toMatchObject({
      status: 404,
    });
    const k2 = key('nobooking');
    await expect(
      transfer(k2, usd1, usd2, 10n, { bookingId: `${P}missing-booking` }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect([await rowsByKey(k1), await rowsByKey(k2)]).toEqual([0, 0]);
  });

  // ─── Idempotency ───────────────────────────────────────────────────────

  it('replays the same command, refuses a changed one, and gives another actor nothing', async () => {
    const k = key('idem');
    const first = await transfer(k, usd1, usd2, 700n);
    const again = await transfer(k, usd1, usd2, 700n);
    expect(again).toMatchObject({ replayed: true, transaction: { id: first.transaction.id } });

    await expect(transfer(k, usd1, usd2, 701n)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'LEDGER_IDEMPOTENCY_CONFLICT' },
    });
    // Same key, same body, different actor: a conflict that reveals nothing.
    let other: any;
    try {
      await ledger.post(
        { kind: 'USER', userId: POSTER },
        {
          idempotencyKey: k,
          currency: 'USD',
          description: 'R15 acceptance transfer',
          lines: [
            { accountId: usd1, side: 'DEBIT', amountMinor: 700n },
            { accountId: usd2, side: 'CREDIT', amountMinor: 700n },
          ],
        },
      );
    } catch (error) {
      other = error;
    }
    expect(other).toMatchObject({ status: 409 });
    expect(JSON.stringify(other)).not.toContain(first.transaction.id);
    expect(await rowsByKey(k)).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { transactionId: first.transaction.id } })).toBe(
      2,
    );
  });

  // ─── Concurrency ───────────────────────────────────────────────────────

  it('turns five simultaneous identical commands into exactly one posting', async () => {
    const k = key('race');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => transfer(k, usd1, usd3, 333n)),
    );
    expect(new Set(results.map((r: any) => r.transaction.id)).size).toBe(1);
    expect(results.filter((r: any) => !r.replayed)).toHaveLength(1);
    expect(await rowsByKey(k)).toBe(1);
  });

  it('keeps distinct concurrent postings against one account all, and exact', async () => {
    const account = await open(`hot-${RUN}`, 'USD');
    const counter = await open(`hot-counter-${RUN}`, 'USD');
    const amounts = [1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n, 55n, 89n];
    for (let i = 0; i < amounts.length; i += 5) {
      await Promise.all(
        amounts.slice(i, i + 5).map((a) => transfer(key('hot'), account, counter, a)),
      );
    }
    const balance = await ledger.balance(SYSTEM, account);
    expect(balance).toMatchObject({ debitMinor: 231n, creditMinor: 0n });
    expect(await prisma.ledgerEntry.count({ where: { accountId: account } })).toBe(10);
  });

  // ─── Failure atomicity (controlled fault injection) ───────────────────

  it.each([
    ['after the header', 'insertEntry', 1],
    ['after the first entry', 'insertEntry', 2],
    ['before marking POSTED', 'markPosted', 1],
  ])('a crash %s leaves nothing, and the retry posts exactly once', async (_label, method, nth) => {
    const k = key('fault');
    const original = repo[method].bind(repo);
    let calls = 0;
    jest.spyOn(repo, method).mockImplementation(async (...args: any[]) => {
      calls += 1;
      if (calls === nth) throw new Error('r15 injected crash');
      return original(...args);
    });
    await expect(transfer(k, usd1, usd2, 4242n)).rejects.toThrow('r15 injected crash');
    jest.restoreAllMocks();

    expect(await rowsByKey(k)).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { transaction: { idempotencyKey: k } } })).toBe(
      0,
    );

    const retried = await transfer(k, usd1, usd2, 4242n);
    expect(retried.replayed).toBe(false);
    expect(await rowsByKey(k)).toBe(1);
  });

  it('a failed audit write rolls the whole posting back', async () => {
    const k = key('auditfail');
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('r15 audit store down'));
    await expect(transfer(k, usd1, usd2, 77n)).rejects.toThrow('r15 audit store down');
    expect(await rowsByKey(k)).toBe(0);
  });

  it('a lost response is recovered by retrying the same key', async () => {
    const k = key('lost');
    const first = await transfer(k, usd1, usd2, 900n); // the caller never saw this
    const retry = await transfer(k, usd1, usd2, 900n);
    expect(retry).toMatchObject({ replayed: true, transaction: { id: first.transaction.id } });
    expect(await rowsByKey(k)).toBe(1);
  });

  // ─── Reversal ──────────────────────────────────────────────────────────

  it('reverses by a mirrored, linked transaction and keeps the original untouched', async () => {
    const account = await open(`rev-${RUN}`, 'USD');
    const posted = await transfer(key('rev-src'), account, usd3, 1234n, { bookingId });
    const before = await prisma.ledgerTransaction.findUnique({
      where: { id: posted.transaction.id },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    });

    const reversed = await ledger.reverse(SYSTEM, {
      idempotencyKey: key('rev'),
      transactionId: posted.transaction.id,
      description: 'Correction of a mistaken posting',
    });
    expect(reversed.transaction).toMatchObject({
      kind: 'REVERSAL',
      currency: 'USD',
      reversesTransactionId: posted.transaction.id,
      bookingId,
    });
    expect(
      reversed.transaction.entries.map((e: any) => [e.accountId, e.side, e.amountMinor]),
    ).toEqual([
      [account, 'CREDIT', 1234n],
      [usd3, 'DEBIT', 1234n],
    ]);

    const after = await prisma.ledgerTransaction.findUnique({
      where: { id: posted.transaction.id },
      include: { entries: { orderBy: { lineNo: 'asc' } } },
    });
    expect(after).toEqual(before);
    expect(await ledger.balance(SYSTEM, account)).toMatchObject({
      debitMinor: 1234n,
      creditMinor: 1234n,
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          type: 'MONEY_LEDGER_REVERSED',
          metadata: { path: ['reversesTransactionId'], equals: posted.transaction.id },
        },
      }),
    ).toBe(1);
  });

  it('allows one reversal only, also under concurrency, and never a reversal of a reversal', async () => {
    const posted = await transfer(key('dup-src'), usd1, usd2, 55n);
    const attempts = await Promise.allSettled(
      [key('dup-a'), key('dup-b'), key('dup-c')].map((k) =>
        ledger.reverse(SYSTEM, {
          idempotencyKey: k,
          transactionId: posted.transaction.id,
          description: 'race',
        }),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const refused = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused.map((r) => r.reason?.details?.reason)).toEqual([
      'LEDGER_ALREADY_REVERSED',
      'LEDGER_ALREADY_REVERSED',
    ]);
    expect(
      await prisma.ledgerTransaction.count({
        where: { reversesTransactionId: posted.transaction.id },
      }),
    ).toBe(1);

    await expect(
      ledger.reverse(SYSTEM, {
        idempotencyKey: key('rev-of-rev'),
        transactionId: ok[0].value.transaction.id,
        description: 'not allowed',
      }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'LEDGER_REVERSAL_OF_REVERSAL' } });
  });

  it('posting and reversing the same transaction concurrently never corrupts it', async () => {
    const k = key('pvr');
    const posted = await transfer(k, usd1, usd2, 66n);
    const [replay, rev] = await Promise.all([
      transfer(k, usd1, usd2, 66n),
      ledger.reverse(SYSTEM, {
        idempotencyKey: key('pvr-rev'),
        transactionId: posted.transaction.id,
        description: 'race',
      }),
    ]);
    expect(replay.replayed).toBe(true);
    expect(rev.transaction.reversesTransactionId).toBe(posted.transaction.id);
    expect(await rowsByKey(k)).toBe(1);
  });

  // ─── Authorization ─────────────────────────────────────────────────────

  it('refuses an actor without a fresh ledger capability and an unnamed system caller', async () => {
    const k = key('authz');
    await expect(
      ledger.post(
        { kind: 'USER', userId: NOBODY },
        {
          idempotencyKey: k,
          currency: 'USD',
          description: 'ordinary user',
          lines: [
            { accountId: usd2, side: 'DEBIT', amountMinor: 1n },
            { accountId: usd1, side: 'CREDIT', amountMinor: 1n },
          ],
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(ledger.balance({ kind: 'USER', userId: OWNER }, usd2)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      ledger.post(
        { kind: 'SYSTEM', system: '' },
        {
          idempotencyKey: k,
          currency: 'USD',
          description: 'unnamed caller',
          lines: [
            { accountId: usd2, side: 'DEBIT', amountMinor: 1n },
            { accountId: usd1, side: 'CREDIT', amountMinor: 1n },
          ],
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await rowsByKey(k)).toBe(0);

    // The holder of the capability may post; revocation is immediate.
    const allowed = await ledger.post(
      { kind: 'USER', userId: POSTER },
      {
        idempotencyKey: k,
        currency: 'USD',
        description: 'operator posting',
        lines: [
          { accountId: usd1, side: 'DEBIT', amountMinor: 3n },
          { accountId: usd3, side: 'CREDIT', amountMinor: 3n },
        ],
      },
    );
    expect(allowed.replayed).toBe(false);
    const row = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: k } });
    expect([row.actorUserId, row.actorSystem]).toEqual([POSTER, null]);

    await prisma.userRole.delete({ where: { userId_roleId: { userId: POSTER, roleId: ROLE_ID } } });
    try {
      await expect(transferAs(POSTER, key('revoked'))).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.userRole.create({ data: { userId: POSTER, roleId: ROLE_ID } });
    }

    function transferAs(userId: string, k2: string) {
      return ledger.post(
        { kind: 'USER', userId },
        {
          idempotencyKey: k2,
          currency: 'USD',
          description: 'after revocation',
          lines: [
            { accountId: usd1, side: 'DEBIT', amountMinor: 1n },
            { accountId: usd3, side: 'CREDIT', amountMinor: 1n },
          ],
        },
      );
    }
  });

  // ─── Database-level invariants (service bypassed) ─────────────────────

  it('the database refuses edits and deletes of posted history', async () => {
    const posted = await transfer(key('immut'), usd1, usd2, 808n);
    const id = posted.transaction.id;
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "LedgerEntry" SET "amountMinor" = 1 WHERE "transactionId" = $1`,
          id,
        ),
      /immutable/,
    );
    await refusedByDb(
      (tx) => tx.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "transactionId" = $1`, id),
      /immutable/,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "LedgerTransaction" SET "description" = 'edited' WHERE "id" = $1`,
          id,
        ),
      /immutable/,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "LedgerTransaction" SET "status" = 'DRAFT', "postedAt" = NULL WHERE "id" = $1`,
          id,
        ),
      /immutable/,
    );
    await refusedByDb(
      (tx) => tx.$executeRawUnsafe(`DELETE FROM "LedgerTransaction" WHERE "id" = $1`, id),
      /cannot be deleted/,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "LedgerEntry" ("id","transactionId","lineNo","accountId","side","amountMinor","currency")
           VALUES ($1,$2,99,$3,'DEBIT',1,'USD')`,
          `${P}late-entry`,
          id,
          usd1,
        ),
      /immutable/,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(`UPDATE "LedgerAccount" SET "currency" = 'EUR' WHERE "id" = $1`, usd1),
      /immutable/,
    );

    const after = await prisma.ledgerEntry.findMany({ where: { transactionId: id } });
    expect(after.map((e: any) => e.amountMinor)).toEqual([808n, 808n]);
  });

  it('the database refuses to post an unbalanced, empty, one-sided or pre-posted transaction', async () => {
    const draft = async (
      tx: any,
      id: string,
      kind = 'STANDARD',
      reverses: string | null = null,
      currency = 'USD',
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "LedgerTransaction" ("id","kind","currency","description","idempotencyKey","requestDigest","reversesTransactionId","actorSystem")
         VALUES ($1,$2::"LedgerTransactionKind",$3,'raw','${KP}_raw_' || $1, repeat('a',64), $4, 'r15.raw')`,
        id,
        kind,
        currency,
        reverses,
      );
    const line = (
      tx: any,
      txId: string,
      n: number,
      account: string,
      side: string,
      amount: number,
      currency = 'USD',
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "LedgerEntry" ("id","transactionId","lineNo","accountId","side","amountMinor","currency")
         VALUES ($1,$2,$3,$4,$5::"LedgerEntrySide",$6,$7)`,
        `${txId}-${n}`,
        txId,
        n,
        account,
        side,
        amount,
        currency,
      );
    const post = (tx: any, id: string) =>
      tx.$executeRawUnsafe(
        `UPDATE "LedgerTransaction" SET "status"='POSTED', "postedAt"=now() WHERE "id"=$1`,
        id,
      );

    const a = `${RUN}rawa`;
    await refusedByDb(async (tx) => {
      await draft(tx, a);
      await line(tx, a, 1, usd1, 'DEBIT', 100);
      await line(tx, a, 2, usd2, 'CREDIT', 99);
      await post(tx, a);
    }, /unbalanced/);
    const b = `${RUN}rawb`;
    await refusedByDb(async (tx) => {
      await draft(tx, b);
      await post(tx, b);
    }, /at least one debit and one credit/);
    const c = `${RUN}rawc`;
    await refusedByDb(async (tx) => {
      await draft(tx, c);
      await line(tx, c, 1, usd1, 'DEBIT', 5);
      await line(tx, c, 2, usd2, 'DEBIT', 5);
      await post(tx, c);
    }, /at least one debit and one credit/);
    const e = `${RUN}rawe`;
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "LedgerTransaction" ("id","kind","status","postedAt","currency","description","idempotencyKey","requestDigest","actorSystem")
           VALUES ($1,'STANDARD','POSTED',now(),'USD','raw','${KP}_raw_' || $1, repeat('a',64),'r15.raw')`,
          e,
        ),
      /must be created as DRAFT/,
    );
    // Mixed currency is impossible by foreign key: a SEK account line in a
    // USD transaction, and a line whose currency differs from its header.
    const f = `${RUN}rawf`;
    await refusedByDb(async (tx) => {
      await draft(tx, f);
      await line(tx, f, 1, sek1, 'DEBIT', 5, 'USD');
    }, /LedgerEntry_accountId_currency_fkey|foreign key/i);
    const g = `${RUN}rawg`;
    await refusedByDb(async (tx) => {
      await draft(tx, g);
      await line(tx, g, 1, sek1, 'DEBIT', 5, 'SEK');
    }, /LedgerEntry_transactionId_currency_fkey|foreign key/i);
    await refusedByDb(async (tx) => {
      await draft(tx, `${RUN}rawh`);
      await line(tx, `${RUN}rawh`, 1, usd1, 'DEBIT', 0);
    }, /LedgerEntry_amount_positive/);

    for (const id of [a, b, c, e, f, g, `${RUN}rawh`]) {
      expect(await prisma.ledgerTransaction.count({ where: { id } })).toBe(0);
    }
  });

  it('the database refuses a reversal that does not mirror, or changes currency', async () => {
    const posted = await transfer(key('rawrev-src'), usd1, usd2, 400n);
    const insert = (tx: any, id: string, currency: string) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "LedgerTransaction" ("id","kind","currency","description","idempotencyKey","requestDigest","reversesTransactionId","actorSystem")
         VALUES ($1,'REVERSAL',$2,'raw','${KP}_raw_' || $1, repeat('b',64), $3, 'r15.raw')`,
        id,
        currency,
        posted.transaction.id,
      );
    const line = (
      tx: any,
      txId: string,
      n: number,
      account: string,
      side: string,
      amount: number,
      currency = 'USD',
    ) =>
      tx.$executeRawUnsafe(
        `INSERT INTO "LedgerEntry" ("id","transactionId","lineNo","accountId","side","amountMinor","currency")
         VALUES ($1,$2,$3,$4,$5::"LedgerEntrySide",$6,$7)`,
        `${txId}-${n}`,
        txId,
        n,
        account,
        side,
        amount,
        currency,
      );
    const post = (tx: any, id: string) =>
      tx.$executeRawUnsafe(
        `UPDATE "LedgerTransaction" SET "status"='POSTED', "postedAt"=now() WHERE "id"=$1`,
        id,
      );

    const wrongAmount = `${RUN}rr1`;
    await refusedByDb(async (tx) => {
      await insert(tx, wrongAmount, 'USD');
      await line(tx, wrongAmount, 1, usd1, 'CREDIT', 300);
      await line(tx, wrongAmount, 2, usd2, 'DEBIT', 300);
      await post(tx, wrongAmount);
    }, /mirror/);
    const sameSides = `${RUN}rr2`;
    await refusedByDb(async (tx) => {
      await insert(tx, sameSides, 'USD');
      await line(tx, sameSides, 1, usd1, 'DEBIT', 400);
      await line(tx, sameSides, 2, usd2, 'CREDIT', 400);
      await post(tx, sameSides);
    }, /mirror/);
    const otherCurrency = `${RUN}rr3`;
    await refusedByDb(async (tx) => {
      await insert(tx, otherCurrency, 'SEK');
      const sek2 = (
        await tx.$queryRawUnsafe(`SELECT "id" FROM "LedgerAccount" WHERE "key" = $1`, `${AP}:sek-1`)
      )[0].id;
      await line(tx, otherCurrency, 1, sek2, 'CREDIT', 400, 'SEK');
      await line(tx, otherCurrency, 2, sek2, 'DEBIT', 400, 'SEK');
      await post(tx, otherCurrency);
    }, /original currency/);
    expect(
      await prisma.ledgerTransaction.count({
        where: { reversesTransactionId: posted.transaction.id },
      }),
    ).toBe(0);
  });

  // ─── Property-style invariants ─────────────────────────────────────────

  it('for 40 seeded random balanced postings, every transaction and account balance is exact', async () => {
    const accounts: string[] = [];
    for (let i = 0; i < 6; i += 1) accounts.push(await open(`prop-${RUN}-${i}`, 'USD'));
    const expected = new Map<string, bigint>(accounts.map((a) => [a, 0n]));
    const seeds = Array.from({ length: 40 }, (_, i) => 1000 + i);

    for (const seed of seeds) {
      const rand = prng(seed);
      const debitCount = 1 + Math.floor(rand() * 3);
      const creditCount = 1 + Math.floor(rand() * 3);
      const debits = Array.from({ length: debitCount }, () =>
        BigInt(1 + Math.floor(rand() * 1_000_000)),
      );
      const total = debits.reduce((s, v) => s + v, 0n);
      // Split the same total across the credit lines, every part >= 1.
      const credits: bigint[] = [];
      let left = total;
      for (let i = 0; i < creditCount - 1 && left > 1n; i += 1) {
        const part = 1n + BigInt(Math.floor(rand() * Number(left - 1n)));
        credits.push(part);
        left -= part;
      }
      credits.push(left);
      const pick = () => accounts[Math.floor(rand() * accounts.length)];
      const lines = [
        ...debits.map((amountMinor) => ({ accountId: pick(), side: 'DEBIT', amountMinor })),
        ...credits.map((amountMinor) => ({ accountId: pick(), side: 'CREDIT', amountMinor })),
      ];
      try {
        await ledger.post(SYSTEM, {
          idempotencyKey: key(`prop${seed}`),
          currency: 'USD',
          description: `property seed ${seed}`,
          lines,
        });
      } catch (error) {
        throw new Error(
          `property seed ${seed} failed: ${(error as Error).message} ${JSON.stringify(lines, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
          { cause: error },
        );
      }
      for (const l of lines) {
        expected.set(
          l.accountId,
          expected.get(l.accountId)! + (l.side === 'DEBIT' ? l.amountMinor : -l.amountMinor),
        );
      }
    }

    const unbalanced = await prisma.$queryRawUnsafe(
      `SELECT t."id" FROM "LedgerTransaction" t JOIN "LedgerEntry" e ON e."transactionId" = t."id"
        WHERE t."status" = 'POSTED'
        GROUP BY t."id"
       HAVING SUM(CASE e."side" WHEN 'DEBIT' THEN e."amountMinor" ELSE -e."amountMinor" END) <> 0`,
    );
    expect(unbalanced).toEqual([]);
    for (const account of accounts) {
      const b = await ledger.balance(SYSTEM, account);
      expect([account, b.debitMinor - b.creditMinor]).toEqual([account, expected.get(account)]);
    }
  });

  // ─── Reads and query plans ─────────────────────────────────────────────

  it('pages account history deterministically and uses indexes for the hot lookups', async () => {
    const account = await open(`hist-${RUN}`, 'USD');
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const r = await transfer(key('hist'), account, usd3, BigInt(i + 1));
      ids.push(r.transaction.id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await ledger.history(SYSTEM, account, 3, cursor);
      seen.push(...page.items.map((item: any) => item.transactionId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const expected = await prisma.ledgerEntry.findMany({
      where: { accountId: account },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { transactionId: true },
    });
    expect(seen).toEqual(expected.map((e: any) => e.transactionId));
    expect(new Set(seen)).toEqual(new Set(ids));

    // Representative volume for the planner: 3,000 more postings spread over
    // 60 accounts, written in bulk through the same triggers.
    const bulk: string[] = [];
    for (let i = 0; i < 60; i += 1) bulk.push(await open(`bulk-${RUN}-${i}`, 'USD'));
    await sql(
      `INSERT INTO "LedgerTransaction" ("id","kind","currency","description","idempotencyKey","requestDigest","actorSystem")
       SELECT '${RUN}bulk' || g, 'STANDARD', 'USD', 'bulk', '${KP}_bulk_' || lpad(g::text, 8, '0'), repeat('c',64), 'r15.bulk'
         FROM generate_series(1, 3000) g`,
    );
    await sql(
      `INSERT INTO "LedgerEntry" ("id","transactionId","lineNo","accountId","side","amountMinor","currency")
       SELECT '${RUN}bulk' || g || '-' || n, '${RUN}bulk' || g, n,
              (ARRAY[${bulk.map((b) => `'${b}'`).join(',')}])[1 + ((g * 7 + n * 13) % 60)],
              CASE n WHEN 1 THEN 'DEBIT'::"LedgerEntrySide" ELSE 'CREDIT'::"LedgerEntrySide" END,
              1 + g, 'USD'
         FROM generate_series(1, 3000) g CROSS JOIN generate_series(1, 2) n`,
    );
    await sql(
      `UPDATE "LedgerTransaction" SET "status" = 'POSTED', "postedAt" = now() WHERE "id" LIKE '${RUN}bulk%'`,
    );
    await sql('ANALYZE "LedgerEntry"');
    await sql('ANALYZE "LedgerTransaction"');

    const plan = async (query: string, ...params: unknown[]) => {
      const rows: any[] = await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${query}`, ...params);
      return JSON.stringify(rows[0]['QUERY PLAN']);
    };
    const history = await plan(
      `SELECT e.* FROM "LedgerEntry" e JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
        WHERE e."accountId" = $1 AND t."status" = 'POSTED' ORDER BY e."createdAt" DESC, e."id" DESC LIMIT 51`,
      bulk[7],
    );
    const byKey = await plan(
      `SELECT * FROM "LedgerTransaction" WHERE "idempotencyKey" = $1`,
      `${KP}_bulk_00000042`,
    );
    const byBooking = await plan(
      `SELECT * FROM "LedgerTransaction" WHERE "bookingId" = $1`,
      bookingId,
    );
    const byReversal = await plan(
      `SELECT * FROM "LedgerTransaction" WHERE "reversesTransactionId" = $1`,
      `${RUN}bulk42`,
    );
    const entriesOf = await plan(
      `SELECT * FROM "LedgerEntry" WHERE "transactionId" = $1`,
      `${RUN}bulk42`,
    );
    // Plans are part of the evidence; the suite prints them for the record.
    console.log('R15 query plans', { history, byKey, byBooking, byReversal, entriesOf });
    expect(history).toContain('LedgerEntry_accountId_createdAt_id_idx');
    expect(byKey).toContain('LedgerTransaction_idempotencyKey_key');
    expect(byBooking).toContain('LedgerTransaction_bookingId_idx');
    expect(byReversal).toContain('LedgerTransaction_reversesTransactionId_key');
    expect(entriesOf).toContain('LedgerEntry_transactionId_lineNo_key');

    const unbalanced = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM (
         SELECT t."id" FROM "LedgerTransaction" t JOIN "LedgerEntry" e ON e."transactionId" = t."id"
          WHERE t."id" LIKE '${RUN}bulk%' GROUP BY t."id"
         HAVING SUM(CASE e."side" WHEN 'DEBIT' THEN e."amountMinor" ELSE -e."amountMinor" END) <> 0) x`,
    );
    expect(unbalanced).toEqual([{ n: 0 }]);
  });
});
