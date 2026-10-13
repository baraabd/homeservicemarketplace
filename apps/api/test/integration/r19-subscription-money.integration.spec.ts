/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * DB-gated: the generated Prisma client is loaded lazily only when
 * RUN_DB_INTEGRATION=1.
 */
export {};

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';

import { fixturePrefix } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// ─────────────────────────────────────────────────────────────────────────────
// R19 — subscription money foundation against real PostgreSQL.
//
// The confirmation → ledger posting → subscription period → outbox unit is
// exercised through the real LedgerService, AuditService and OutboxRepository
// (no route exists by design). Every rule the migration owns is also attacked
// with raw SQL that bypasses the service.
//
// Synthetic, non-production fixtures only: ISO 4217 test currencies XTS and
// XXX, a plan key prefixed it-r19-, synthetic ledger accounts. No real price,
// currency, account purpose or coupon is implied. Money rows are append-only,
// so the suite never deletes them; each run uses its own prefix.
// ─────────────────────────────────────────────────────────────────────────────

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

d('R19 - subscription confirmation, ledger posting and periods (real Postgres)', () => {
  let prisma: any;
  let activation: any;
  let ledger: any;
  let outbox: any;
  let close: () => Promise<void>;

  const RUN = randomUUID().replace(/-/g, '').slice(0, 10);
  const P = `${fixturePrefix('r19money')}${RUN}-`;
  const KP = `r19${RUN}`;
  const SYSTEM = { kind: 'SYSTEM', system: 'r19.acceptance' } as const;
  const PROVIDER = `${P}provider`;
  const OTHER_PROVIDER = `${P}provider-2`;
  const REVIEWER = `${P}reviewer`;
  let seq = 0;
  const key = (label: string) => `${KP}_${label}_${(seq += 1)}`.padEnd(16, 'x');

  let monthly: string;
  let annual: string;
  let debit: string;
  let credit: string;
  let xxxDebit: string;
  let receipt: string;

  async function account(label: string, currency: string) {
    const { account: row } = await ledger.openAccount(SYSTEM, {
      key: `it-r19-${RUN}:${label}`,
      ownerType: 'PLATFORM',
      currency,
    });
    return row.id as string;
  }

  async function intent(
    planVersionId: string,
    total: bigint,
    options: {
      status?: string;
      provider?: string;
      currency?: string;
      couponId?: string | null;
    } = {},
  ) {
    const row = await prisma.moneyPaymentIntent.create({
      data: {
        providerProfileId: options.provider ?? PROVIDER,
        planVersionId,
        method: 'STRIPE',
        currency: options.currency ?? 'XTS',
        subtotalMinor: total,
        discountMinor: 0n,
        totalMinor: total,
        couponId: options.couponId ?? null,
        idempotencyKey: key('intent'),
        requestDigest: 'a'.repeat(64),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    });
    const status = options.status ?? 'PROCESSING';
    if (status !== 'CREATED') {
      await prisma.moneyPaymentIntent.update({ where: { id: row.id }, data: { status } });
    }
    return row.id as string;
  }

  const command = (
    paymentIntentId: string,
    amountMinor: bigint,
    extra: Record<string, unknown> = {},
  ) => ({
    idempotencyKey: key('confirm'),
    paymentIntentId,
    source: 'PROVIDER_WEBHOOK',
    externalConfirmationId: `evt_${randomUUID()}`,
    amountMinor,
    currency: 'XTS',
    confirmedAt: new Date('2026-03-31T10:00:00Z'),
    ledgerAccounts: { debitAccountId: debit, creditAccountId: credit },
    ...extra,
  });

  async function counts(paymentIntentId: string) {
    const confirmation = await prisma.moneyPaymentConfirmation.findUnique({
      where: { paymentIntentId },
    });
    return {
      intentStatus: (
        await prisma.moneyPaymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId } })
      ).status,
      confirmations: confirmation ? 1 : 0,
      periods: confirmation
        ? await prisma.subscriptionPeriod.count({
            where: { paymentConfirmationId: confirmation.id },
          })
        : 0,
      events: confirmation
        ? await prisma.outboxEvent.count({
            where: { dedupeKey: `money.subscription.activated.v1:${confirmation.id}` },
          })
        : 0,
    };
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

  async function expectStatus(promise: Promise<unknown>, status: number) {
    await expect(promise).rejects.toMatchObject({ status });
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
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const {
      SubscriptionActivationService,
    } = require('../../src/modules/money/domain/subscription-activation.service');

    const flags: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r19-money'),
      PERMISSION_CACHE_TTL_SECONDS: 300,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionActivationService,
        OutboxRepository,
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
              throw new Error('R19 uses fresh database permissions, never the cache');
            },
          },
        },
      ],
    }).compile();
    activation = moduleRef.get(SubscriptionActivationService);
    ledger = moduleRef.get(LedgerService);
    outbox = moduleRef.get(OutboxRepository);
    close = () => moduleRef.close();

    for (const id of [`${PROVIDER}-user`, `${OTHER_PROVIDER}-user`, REVIEWER]) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r19-money.test`,
          firstName: 'R19',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    for (const id of [PROVIDER, OTHER_PROVIDER]) {
      await prisma.providerProfile.create({
        data: {
          id,
          userId: `${id}-user`,
          displayName: 'R19 provider',
          initials: 'R9',
          status: 'ACTIVE',
        },
      });
    }
    const plan = (interval: string, version: number, currency = 'XTS') =>
      prisma.subscriptionPlanVersion.create({
        data: {
          planKey: `it-r19-${RUN.toLowerCase()}`,
          version,
          billingInterval: interval,
          priceMinor: 1000n,
          currency,
          entitlements: [],
          publishedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
    monthly = (await plan('MONTHLY', 1)).id;
    annual = (await plan('ANNUAL', 2)).id;
    debit = await account('clearing', 'XTS');
    credit = await account('revenue', 'XTS');
    xxxDebit = await account('clearing-xxx', 'XXX');
    receipt = (
      await prisma.mediaAsset.create({
        data: {
          visibility: 'PRIVATE',
          storageKey: `${P}receipt`,
          declaredMimeType: 'image/png',
          sizeBytes: 10,
          ownerUserId: `${PROVIDER}-user`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await close?.();
  });

  // ─── Atomic unit ──────────────────────────────────────────────────────

  it('one confirmation posts once, opens one period and enqueues one identifier-only event', async () => {
    const id = await intent(monthly, 1000n);
    const result = await activation.confirmAndActivate(command(id, 1000n));
    expect(result).toMatchObject({
      contractVersion: 'hsm.money.v1',
      status: 'ACTIVE',
      replayed: false,
    });
    // Month-end clamping comes from the existing domain rule.
    expect(result.periodStartsAt).toBe('2026-03-31T10:00:00.000Z');
    expect(result.periodEndsAt).toBe('2026-04-30T10:00:00.000Z');
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });

    const posting = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: result.ledgerTransactionId },
      include: { entries: true },
    });
    expect(posting).toMatchObject({
      status: 'POSTED',
      kind: 'STANDARD',
      currency: 'XTS',
      bookingId: null,
    });
    expect(posting.entries.map((e: any) => [e.side, e.amountMinor])).toEqual(
      expect.arrayContaining([
        ['DEBIT', 1000n],
        ['CREDIT', 1000n],
      ]),
    );
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { dedupeKey: `money.subscription.activated.v1:${result.paymentConfirmationId}` },
    });
    expect(Object.keys(event.payload).sort()).toEqual([
      'contractVersion',
      'paymentConfirmationId',
      'subscriptionId',
      'subscriptionPeriodId',
    ]);
    // Identifiers only: no value is the amount or the currency.
    expect(Object.values(event.payload)).not.toContain('1000');
    expect(Object.values(event.payload)).not.toContain('XTS');
    expect(Object.values(event.payload).every((v) => typeof v === 'string' && v !== '')).toBe(true);
  });

  it('a replay returns the stored result; an altered payload with the same key changes nothing', async () => {
    const id = await intent(monthly, 1000n);
    const first = command(id, 1000n);
    const stored = await activation.confirmAndActivate(first);
    const replay = await activation.confirmAndActivate({ ...first });
    expect(replay).toEqual({ ...stored, replayed: true });
    await expectStatus(
      activation.confirmAndActivate({ ...first, externalConfirmationId: 'evt_altered' }),
      409,
    );
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });
  });

  it('a second confirmation of the same intent under another key is refused', async () => {
    const id = await intent(monthly, 1000n);
    await activation.confirmAndActivate(command(id, 1000n));
    await expectStatus(activation.confirmAndActivate(command(id, 1000n)), 409);
    expect(await counts(id)).toMatchObject({ confirmations: 1, periods: 1 });
  });

  it('wrong amount, wrong currency, zero total and an unconfirmable intent write nothing', async () => {
    const id = await intent(monthly, 1000n);
    await expectStatus(activation.confirmAndActivate(command(id, 999n)), 400);
    await expectStatus(activation.confirmAndActivate(command(id, 1000n, { currency: 'XXX' })), 400);
    await expectStatus(activation.confirmAndActivate(command(id, 0n)), 400);
    expect(await counts(id)).toEqual({
      intentStatus: 'PROCESSING',
      confirmations: 0,
      periods: 0,
      events: 0,
    });
    const created = await intent(monthly, 1000n, { status: 'CREATED' });
    await expectStatus(activation.confirmAndActivate(command(created, 1000n)), 409);
    expect(await counts(created)).toMatchObject({ intentStatus: 'CREATED', confirmations: 0 });
  });

  it('five identical concurrent commands produce one posting and one period', async () => {
    const id = await intent(monthly, 1000n);
    const same = command(id, 1000n);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => activation.confirmAndActivate({ ...same })),
    );
    expect(new Set(results.map((r: any) => r.paymentConfirmationId)).size).toBe(1);
    expect(results.filter((r: any) => !r.replayed)).toHaveLength(1);
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });
  });

  it('five distinct concurrent confirmations of one intent: exactly one succeeds', async () => {
    const id = await intent(monthly, 1000n);
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => activation.confirmAndActivate(command(id, 1000n))),
    );
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    for (const s of settled.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect(s.reason).toMatchObject({ status: 409 });
    }
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });
    const ledgerRows = await prisma.ledgerTransaction.count({
      where: {
        externalReference: { startsWith: 'PROVIDER_WEBHOOK:' },
        moneyConfirmation: { paymentIntentId: id },
      },
    });
    expect(ledgerRows).toBe(1);
  });

  it('a failure before the outbox commit rolls back the posting, period and status; a retry succeeds', async () => {
    const id = await intent(monthly, 1000n);
    const failing = command(id, 1000n);
    const spy = jest
      .spyOn(outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('injected outbox failure'));
    await expect(activation.confirmAndActivate(failing)).rejects.toThrow('injected outbox failure');
    spy.mockRestore();
    expect(await counts(id)).toEqual({
      intentStatus: 'PROCESSING',
      confirmations: 0,
      periods: 0,
      events: 0,
    });
    const ledgerKey =
      require('../../src/modules/money/domain/subscription-activation.service').ledgerKeyFor(
        failing.idempotencyKey,
      );
    expect(await prisma.ledgerTransaction.count({ where: { idempotencyKey: ledgerKey } })).toBe(0);
    const retried = await activation.confirmAndActivate(failing);
    expect(retried.replayed).toBe(false);
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });
  });

  it('a failed ledger audit write rolls back the whole unit', async () => {
    const id = await intent(monthly, 1000n);
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const spy = jest
      .spyOn(AuditService.prototype, 'record')
      .mockRejectedValueOnce(new Error('injected audit failure'));
    await expect(activation.confirmAndActivate(command(id, 1000n))).rejects.toThrow(
      'injected audit failure',
    );
    spy.mockRestore();
    expect(await counts(id)).toEqual({
      intentStatus: 'PROCESSING',
      confirmations: 0,
      periods: 0,
      events: 0,
    });
  });

  it('in a caller-owned transaction nothing survives an outer rollback, and all of it commits with the caller', async () => {
    const id = await intent(monthly, 1000n);
    const outer = command(id, 1000n);
    await expect(
      prisma.$transaction(async (tx: any) => {
        const inside = await activation.confirmAndActivate(outer, tx);
        expect(inside.status).toBe('ACTIVE');
        throw new Error('outer rollback');
      }),
    ).rejects.toThrow('outer rollback');
    expect(await counts(id)).toEqual({
      intentStatus: 'PROCESSING',
      confirmations: 0,
      periods: 0,
      events: 0,
    });
    await prisma.$transaction((tx: any) => activation.confirmAndActivate(outer, tx));
    expect(await counts(id)).toEqual({
      intentStatus: 'SUCCEEDED',
      confirmations: 1,
      periods: 1,
      events: 1,
    });
  });

  it('a renewal opens the next period at the previous end, never overlapping', async () => {
    const first = await activation.confirmAndActivate(command(await intent(annual, 1000n), 1000n));
    const second = await activation.confirmAndActivate(
      command(await intent(annual, 1000n), 1000n, {
        subscriptionId: first.subscriptionId,
        confirmedAt: new Date('2026-06-01T00:00:00Z'),
      }),
    );
    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(second.periodStartsAt).toBe(first.periodEndsAt);
    expect(
      await prisma.subscriptionPeriod.count({ where: { subscriptionId: first.subscriptionId } }),
    ).toBe(2);
  });

  it('a manual confirmation names its restricted receipt and reviewer; a webhook names neither', async () => {
    const id = await intent(monthly, 1000n);
    await expectStatus(
      activation.confirmAndActivate(command(id, 1000n, { source: 'MANUAL_REVIEW' })),
      400,
    );
    await expectStatus(
      activation.confirmAndActivate(command(id, 1000n, { receiptMediaAssetId: receipt })),
      400,
    );
    const manual = await activation.confirmAndActivate(
      command(id, 1000n, {
        source: 'MANUAL_REVIEW',
        receiptMediaAssetId: receipt,
        reviewerUserId: REVIEWER,
      }),
    );
    expect(manual.status).toBe('ACTIVE');
  });

  // ─── Authority and history ────────────────────────────────────────────

  it('introducing the models grants no permission, posts no booking revenue and backfills nothing', async () => {
    const moneyPermissions = await prisma.permission.findMany({
      where: {
        OR: [
          { key: { startsWith: 'money' } },
          { key: { startsWith: 'subscription' } },
          { key: { startsWith: 'payment' } },
          { key: { startsWith: 'refund' } },
        ],
      },
    });
    expect(moneyPermissions).toEqual([]);
    const ledgerGrants = await prisma.rolePermission.count({
      where: { permission: { key: { in: ['ledger:read', 'ledger:post'] } } },
    });
    expect(ledgerGrants).toBe(0);
    // No subscription row exists unless this suite created it.
    expect(
      await prisma.subscriptionPlanVersion.count({
        where: { NOT: { planKey: { startsWith: 'it-r19-' } } },
      }),
    ).toBe(0);
    // Re-runnable: every confirmation belongs to a fixture provider of some
    // R19 run, so none was backfilled onto a real provider.
    expect(
      await prisma.moneyPaymentConfirmation.count({
        where: { paymentIntent: { providerProfileId: { not: { startsWith: 'it-r19money' } } } },
      }),
    ).toBe(0);
    // A completed booking still produces no ledger row: nothing posts from bookings.
    expect(
      await prisma.ledgerTransaction.count({
        where: { bookingId: { not: null }, actorSystem: 'money.subscription-activation' },
      }),
    ).toBe(0);
  });

  it('the migration is expand-only: it alters no table it did not create', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../packages/database/prisma/migrations/20261014090000_r19_subscription_money_foundation/migration.sql',
      ),
      'utf8',
    );
    const created = new Set([...sql.matchAll(/CREATE TABLE "([A-Za-z]+)"/gu)].map((m) => m[1]));
    const altered = [...sql.matchAll(/ALTER TABLE "([A-Za-z]+)"/gu)].map((m) => m[1]);
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.filter((table) => !created.has(table))).toEqual([]);
    expect(sql).not.toMatch(/\bINSERT INTO\b|\bDROP\b|\bUPDATE "/u);
  });

  // ─── Raw SQL against the database rules ───────────────────────────────

  it('the database refuses confirmations that are not exactly one succeeded intent and one posting', async () => {
    const processing = await intent(monthly, 1000n);
    const done = await activation.confirmAndActivate(command(await intent(monthly, 1000n), 1000n));
    const insert = (tx: any, intentId: string, amount: bigint, ledgerId: string, extra = '') =>
      tx.$executeRawUnsafe(
        `INSERT INTO "MoneyPaymentConfirmation" ("id","paymentIntentId","source","externalConfirmationId","amountMinor","currency","confirmedAt","idempotencyKey","requestDigest","ledgerTransactionId"${extra ? ',"receiptMediaAssetId","reviewerUserId"' : ''})
         VALUES ($1,$2,'PROVIDER_WEBHOOK',$3,$4,'XTS',now(),$5,$6,$7${extra})`,
        `${P}c${(seq += 1)}`,
        intentId,
        `evt_${randomUUID()}`,
        amount,
        key('raw'),
        'b'.repeat(64),
        ledgerId,
      );
    await refusedByDb(
      (tx) => insert(tx, processing, 1000n, done.ledgerTransactionId),
      /Only a SUCCEEDED payment intent/u,
    );
    await refusedByDb(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "MoneyPaymentIntent" SET "status"='SUCCEEDED' WHERE "id"=$1`,
        processing,
      );
      await insert(tx, processing, 999n, done.ledgerTransactionId);
    }, /must equal the payment intent total|PROCESSING to SUCCEEDED/u);
    const confirmation = await prisma.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { id: done.paymentConfirmationId },
    });
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyPaymentConfirmation" SET "amountMinor"=1 WHERE "id"=$1`,
          confirmation.id,
        ),
      /append-only/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM "MoneyPaymentConfirmation" WHERE "id"=$1`,
          confirmation.id,
        ),
      /append-only/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "SubscriptionPeriod" SET "endsAt"=now() WHERE "id"=$1`,
          done.subscriptionPeriodId,
        ),
      /append-only/u,
    );
  });

  it('the database refuses repricing, illegal transitions and overlapping periods', async () => {
    const id = await intent(monthly, 1000n);
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyPaymentIntent" SET "totalMinor"=1, "subtotalMinor"=1 WHERE "id"=$1`,
          id,
        ),
      /priced once/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyPaymentIntent" SET "status"='CREATED' WHERE "id"=$1`,
          id,
        ),
      /cannot transition/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "SubscriptionPlanVersion" SET "priceMinor"=1 WHERE "id"=$1`,
          monthly,
        ),
      /immutable/u,
    );
    await refusedByDb(
      (tx) => tx.$executeRawUnsafe(`DELETE FROM "SubscriptionPlanVersion" WHERE "id"=$1`, monthly),
      /never deleted/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "MoneyPaymentIntent" ("id","providerProfileId","planVersionId","method","currency","subtotalMinor","discountMinor","totalMinor","idempotencyKey","requestDigest","expiresAt","updatedAt")
       VALUES ($1,$2,$3,'STRIPE','XTS',1000,100,1000,$4,$5,now(),now())`,
          `${P}bad`,
          PROVIDER,
          monthly,
          key('bad'),
          'c'.repeat(64),
        ),
      /total_is_subtotal_minus_discount/u,
    );
    // Currency must match the plan version (composite foreign key).
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "MoneyPaymentIntent" ("id","providerProfileId","planVersionId","method","currency","subtotalMinor","discountMinor","totalMinor","idempotencyKey","requestDigest","expiresAt","updatedAt")
       VALUES ($1,$2,$3,'STRIPE','XXX',1000,0,1000,$4,$5,now(),now())`,
          `${P}bad-ccy`,
          PROVIDER,
          monthly,
          key('ccy'),
          'c'.repeat(64),
        ),
      /foreign key/u,
    );
    const done = await activation.confirmAndActivate(command(await intent(monthly, 1000n), 1000n));
    const other = await activation.confirmAndActivate(command(await intent(monthly, 1000n), 1000n));
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "SubscriptionPeriod" ("id","subscriptionId","paymentConfirmationId","startsAt","endsAt") VALUES ($1,$2,$3,$4,$5)`,
          `${P}overlap`,
          done.subscriptionId,
          other.paymentConfirmationId,
          new Date(done.periodStartsAt),
          new Date(done.periodEndsAt),
        ),
      // BEFORE INSERT: the overlap rule answers before the period's uniqueness.
      /cannot overlap/u,
    );
  });

  // ─── Refunds: reservation cap, full reversal vs partial compensation ──

  it('refund reservations never exceed the confirmed amount, also under concurrency', async () => {
    const done = await activation.confirmAndActivate(command(await intent(monthly, 1000n), 1000n));
    const reserve = (amount: bigint) =>
      prisma.moneyRefund.create({
        data: {
          paymentConfirmationId: done.paymentConfirmationId,
          amountMinor: amount,
          currency: 'XTS',
          reasonCode: 'R19_TEST',
          idempotencyKey: key('refund'),
          requestDigest: 'd'.repeat(64),
        },
      });
    const settled = await Promise.allSettled(Array.from({ length: 4 }, () => reserve(400n)));
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(2);
    const open = await prisma.moneyRefund.aggregate({
      where: { paymentConfirmationId: done.paymentConfirmationId },
      _sum: { amountMinor: true },
    });
    expect(open._sum.amountMinor).toBe(800n);
    // Cancelling one frees its amount; the cap still holds.
    const [first] = await prisma.moneyRefund.findMany({
      where: { paymentConfirmationId: done.paymentConfirmationId },
      orderBy: { createdAt: 'asc' },
    });
    await prisma.moneyRefund.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await reserve(600n);
    await expect(reserve(1n)).rejects.toThrow(/cannot exceed the confirmed amount/u);
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyRefund" SET "status"='RESERVED' WHERE "id"=$1`,
          first.id,
        ),
      /cannot transition/u,
    );
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(`UPDATE "MoneyRefund" SET "amountMinor"=1 WHERE "id"=$1`, first.id),
      /keeps its amount/u,
    );
  });

  it('a partial refund is a linked compensating posting; the full reversal stays an exact R15 mirror', async () => {
    const done = await activation.confirmAndActivate(command(await intent(monthly, 1000n), 1000n));
    const refund = await prisma.moneyRefund.create({
      data: {
        paymentConfirmationId: done.paymentConfirmationId,
        amountMinor: 300n,
        currency: 'XTS',
        reasonCode: 'R19_PARTIAL',
        idempotencyKey: key('partial'),
        requestDigest: 'e'.repeat(64),
      },
    });
    await prisma.moneyRefund.update({ where: { id: refund.id }, data: { status: 'DISPATCHED' } });
    const compensation = await ledger.post(SYSTEM, {
      idempotencyKey: key('comp'),
      currency: 'XTS',
      description: 'R19 partial refund compensation',
      lines: [
        { accountId: credit, side: 'DEBIT', amountMinor: 300n },
        { accountId: debit, side: 'CREDIT', amountMinor: 300n },
      ],
    });
    // Only a SUCCEEDED refund may carry its compensation.
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyRefund" SET "compensatingLedgerTransactionId"=$1 WHERE "id"=$2`,
          compensation.transaction.id,
          refund.id,
        ),
      /compensation_only_when_succeeded/u,
    );
    await prisma.moneyRefund.update({
      where: { id: refund.id },
      data: { status: 'SUCCEEDED', compensatingLedgerTransactionId: compensation.transaction.id },
    });
    // A compensation in another currency is refused.
    const xxx = await ledger.post(SYSTEM, {
      idempotencyKey: key('xxx'),
      currency: 'XXX',
      description: 'other currency',
      lines: [
        { accountId: xxxDebit, side: 'DEBIT', amountMinor: 1n },
        { accountId: await account(`xxx-${seq}`, 'XXX'), side: 'CREDIT', amountMinor: 1n },
      ],
    });
    const second = await prisma.moneyRefund.create({
      data: {
        paymentConfirmationId: done.paymentConfirmationId,
        amountMinor: 100n,
        currency: 'XTS',
        reasonCode: 'R19_PARTIAL',
        idempotencyKey: key('partial2'),
        requestDigest: 'e'.repeat(64),
      },
    });
    await prisma.moneyRefund.update({ where: { id: second.id }, data: { status: 'DISPATCHED' } });
    await refusedByDb(
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "MoneyRefund" SET "status"='SUCCEEDED', "compensatingLedgerTransactionId"=$1 WHERE "id"=$2`,
          xxx.transaction.id,
          second.id,
        ),
      /refund currency|foreign key/u,
    );

    // R15's full reversal still applies to the original posting, unchanged.
    const original = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: done.ledgerTransactionId },
      include: { entries: true },
    });
    const reversal = await ledger.reverse(SYSTEM, {
      idempotencyKey: key('rev'),
      transactionId: done.ledgerTransactionId,
      description: 'R19 full refund reversal',
    });
    expect(reversal.transaction.kind).toBe('REVERSAL');
    const after = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: done.ledgerTransactionId },
      include: { entries: true },
    });
    expect(after).toEqual(original);
    // A partial amount can never be a REVERSAL: the mirror rule refuses it.
    await refusedByDb(async (tx) => {
      const [header] = (await tx.$queryRawUnsafe(
        `INSERT INTO "LedgerTransaction" ("id","kind","currency","description","idempotencyKey","requestDigest","reversesTransactionId","actorSystem") VALUES ($1,'REVERSAL','XTS','partial',$2,$3,$4,'r19.acceptance') RETURNING "id"`,
        `${P}partial-rev`,
        key('prev'),
        'f'.repeat(64),
        compensation.transaction.id,
      )) as Array<{ id: string }>;
      await tx.$executeRawUnsafe(
        `INSERT INTO "LedgerEntry" ("id","transactionId","lineNo","accountId","side","amountMinor","currency") VALUES ($1,$2,1,$3,'CREDIT',100,'XTS'),($4,$2,2,$5,'DEBIT',100,'XTS')`,
        `${P}pe1`,
        header.id,
        credit,
        `${P}pe2`,
        debit,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "LedgerTransaction" SET "status"='POSTED', "postedAt"=now() WHERE "id"=$1`,
        header.id,
      );
    }, /mirror|revers/u);
  });

  // ─── Coupons and usage keys ───────────────────────────────────────────

  it('coupon limits hold under concurrency and a usage key is counted once', async () => {
    const coupon = await prisma.moneyCoupon.create({
      data: {
        code: `R19${RUN.toUpperCase()}`,
        kind: 'PERCENTAGE',
        value: 1000n,
        maxRedemptions: 1,
        active: false,
      },
    });
    const intents = await Promise.all(
      [1, 2, 3].map(() => intent(monthly, 1000n, { couponId: coupon.id })),
    );
    const settled = await Promise.allSettled(
      intents.map((id) => activation.confirmAndActivate(command(id, 1000n))),
    );
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.moneyCouponRedemption.count({ where: { couponId: coupon.id } })).toBe(1);
    // The losing confirmations rolled back entirely: no posting, no period.
    for (const [index, s] of settled.entries()) {
      if (s.status === 'rejected') {
        expect(await counts(intents[index])).toEqual({
          intentStatus: 'PROCESSING',
          confirmations: 0,
          periods: 0,
          events: 0,
        });
      }
    }
    const done = settled.find((s) => s.status === 'fulfilled') as PromiseFulfilledResult<any>;
    const usage = {
      subscriptionId: done.value.subscriptionId,
      entitlementKey: 'leads.monthly',
      usageKey: `lead-${RUN}`,
    };
    await prisma.moneyEntitlementUsage.create({ data: usage });
    await expect(prisma.moneyEntitlementUsage.create({ data: usage })).rejects.toThrow(
      /Unique constraint/u,
    );
  });
});
