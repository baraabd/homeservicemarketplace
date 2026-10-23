import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  type MoneyPaymentIntent,
  type PrismaTx,
} from '@homeservicemarketplace/database';
import type { FinancialRecordKind } from '@homeservicemarketplace/contracts';

import { AuditEventRepository } from '../../src/infrastructure/persistence/iam/audit-event.repository';
import { RoleRepository } from '../../src/infrastructure/persistence/iam/role.repository';
import { LedgerRepository } from '../../src/infrastructure/persistence/ledger/ledger.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { AuditService } from '../../src/modules/iam/audit/audit.service';
import { PermissionResolverService } from '../../src/modules/iam/authorization/services/permission-resolver.service';
import { MoneyQueryService } from '../../src/modules/money/application/money-query.service';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import { FinancialExportService } from '../../src/modules/money/reporting/financial-export.service';
import {
  FinancialReportService,
  UnavailableFinancialReconciliationStatus,
} from '../../src/modules/money/reporting/financial-report.service';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';

// Real services and the complete migrated PostgreSQL schema, including the
// immutable money/ledger triggers. Synthetic XTS/XXX fixtures are confined to
// one separately created database. This does not exercise or certify a rail.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const LARGE = 9007199254740993n;
const MAX_MINOR = 9223372036854775807n;
const SYSTEM = { kind: 'SYSTEM', system: 'r33-report-fixture' } as const;
const DIGEST = 'a'.repeat(64);
const PRIVATE = 'r33-private-synthetic-marker';
const id = () => `r33-${randomUUID()}`;

interface Actor {
  userId: string;
  providerProfileId: string;
  baseRoleId: string;
  capabilityRoleId: string;
  permissionId: string;
  email: string;
}
interface Collection {
  intent: MoneyPaymentIntent;
  confirmationId: string;
  postingId: string;
  attemptId: string;
  subscriptionId: string;
  debitId: string;
  creditId: string;
}

dbDescribe('R33 financial reporting — real PostgreSQL', () => {
  let isolated: IsolatedDatabase;
  let prisma: PrismaClient;
  let reports: FinancialReportService;
  let exports: FinancialExportService;
  let ledger: LedgerService;
  let sql: string[] = [];
  let admin: Actor;
  let owner: Actor;
  let other: Actor;
  let ownCollection: Collection;
  let otherCollection: Collection;
  let ownRefundId: string;
  let otherRefundId: string;
  let ownRequestId: string;
  let otherRequestId: string;
  let unpaidSubscriptionId: string;
  let unknownIntentId: string;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase('r33_reporting');
    const [database] = await isolated.prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database.name}`;
    url.searchParams.set('schema', 'public');
    url.searchParams.set('connection_limit', '5');
    const logged = new PrismaClient({
      datasources: { db: { url: url.toString() } },
      log: [{ emit: 'event', level: 'query' }],
    });
    // Keep query text only, never parameter values or a datasource credential.
    logged.$on('query', (event) => sql.push(event.query));
    prisma = logged;
    const databaseService = { client: prisma } as PrismaService;
    const transactions = new TransactionRunner(databaseService);
    const permissions = new PermissionResolverService(
      new RoleRepository(databaseService),
      {} as never,
      {} as never,
    );
    const queries = new MoneyQueryService(databaseService, permissions, transactions);
    reports = new FinancialReportService(
      permissions,
      transactions,
      queries,
      new UnavailableFinancialReconciliationStatus(),
    );
    exports = new FinancialExportService(reports);
    ledger = new LedgerService(
      new LedgerRepository(databaseService),
      transactions,
      new AuditService(new AuditEventRepository(databaseService)),
      permissions,
    );
    admin = await actor('admin');
    owner = await actor('provider');
    other = await actor('provider');
    ownCollection = await collection(owner, 'XTS', LARGE);
    otherCollection = await collection(other, 'XXX', 700n);
    ownRefundId = await refund(ownCollection, 100n, true);
    otherRefundId = await refund(otherCollection, 100n, false);
    ownRequestId = await refundRequest(owner, ownCollection, 99n);
    otherRequestId = await refundRequest(other, otherCollection, 120n);
    unpaidSubscriptionId = (
      await prisma.providerSubscription.create({
        data: {
          providerProfileId: owner.providerProfileId,
          planVersionId: ownCollection.intent.planVersionId,
        },
      })
    ).id;
    await pending(owner, 'XTS', 400n, false);
    unknownIntentId = (await pending(owner, 'XTS', 300n, true)).id;
    await pending(other, 'XXX', 50n, false);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await isolated?.dispose();
  });

  async function actor(role: 'admin' | 'provider', grant = true): Promise<Actor> {
    const base = await prisma.role.upsert({
      where: { name: role },
      create: { name: role },
      update: {},
    });
    const capability = await prisma.role.create({ data: { name: id() } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: role === 'admin' ? 'money:review:read' : 'money:read:self' },
    });
    if (grant)
      await prisma.rolePermission.create({
        data: { roleId: capability.id, permissionId: permission.id },
      });
    const email = `${id()}@synthetic.invalid`;
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'R33',
        lastName: 'Synthetic',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        userRoles: { create: [{ roleId: base.id }, { roleId: capability.id }] },
      },
    });
    const profile =
      role === 'provider'
        ? await prisma.providerProfile.create({
            data: { userId: user.id, displayName: 'R33 synthetic provider', initials: 'R3' },
          })
        : null;
    return {
      userId: user.id,
      providerProfileId: profile?.id ?? '',
      baseRoleId: base.id,
      capabilityRoleId: capability.id,
      permissionId: permission.id,
      email,
    };
  }

  async function intent(
    actor: Actor,
    currency: string,
    amountMinor: bigint,
    createdAt?: Date,
    resourceId = id(),
  ) {
    const plan = await prisma.subscriptionPlanVersion.create({
      data: {
        planKey: id(),
        version: 1,
        billingInterval: 'MONTHLY',
        priceMinor: amountMinor,
        currency,
        entitlements: [],
        publishedAt: new Date(),
      },
    });
    return prisma.moneyPaymentIntent.create({
      data: {
        id: resourceId,
        providerProfileId: actor.providerProfileId,
        planVersionId: plan.id,
        method: 'STRIPE',
        currency,
        subtotalMinor: amountMinor,
        discountMinor: 0n,
        totalMinor: amountMinor,
        idempotencyKey: id(),
        requestDigest: DIGEST,
        expiresAt: new Date(Date.now() + 3_600_000),
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  async function accounts(currency: string) {
    const debit = await ledger.openAccount(SYSTEM, { key: id(), ownerType: 'PLATFORM', currency });
    const credit = await ledger.openAccount(SYSTEM, { key: id(), ownerType: 'PLATFORM', currency });
    return { debitId: debit.account.id, creditId: credit.account.id };
  }

  async function collection(
    actor: Actor,
    currency: string,
    amountMinor: bigint,
  ): Promise<Collection> {
    const payment = await intent(actor, currency, amountMinor);
    const pair = await accounts(currency);
    const posting = await ledger.post(SYSTEM, {
      idempotencyKey: id(),
      currency,
      description: PRIVATE,
      externalReference: PRIVATE,
      lines: [
        { accountId: pair.debitId, side: 'DEBIT', amountMinor },
        { accountId: pair.creditId, side: 'CREDIT', amountMinor },
      ],
    });
    const result = await prisma.$transaction(async (tx) => {
      await tx.moneyPaymentIntent.update({
        where: { id: payment.id },
        data: { status: 'PROCESSING' },
      });
      await tx.moneyPaymentIntent.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED' },
      });
      const attempt = await tx.moneyPaymentAttempt.create({
        data: { paymentIntentId: payment.id, attemptNo: 1 },
      });
      await tx.moneyPaymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'SUCCEEDED', externalAttemptId: `${PRIVATE}-${id()}` },
      });
      const confirmation = await confirm(tx, payment, posting.transaction.id);
      const subscription = await tx.providerSubscription.create({
        data: { providerProfileId: actor.providerProfileId, planVersionId: payment.planVersionId },
      });
      await tx.subscriptionPeriod.create({
        data: {
          subscriptionId: subscription.id,
          paymentConfirmationId: confirmation.id,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      });
      await tx.providerSubscription.update({
        where: { id: subscription.id },
        data: { status: 'ACTIVE' },
      });
      return {
        confirmationId: confirmation.id,
        attemptId: attempt.id,
        subscriptionId: subscription.id,
      };
    });
    return { intent: payment, postingId: posting.transaction.id, ...result, ...pair };
  }

  function confirm(
    tx: PrismaTx,
    payment: MoneyPaymentIntent,
    postingId: string,
    amountMinor = payment.totalMinor,
  ) {
    return tx.moneyPaymentConfirmation.create({
      data: {
        paymentIntentId: payment.id,
        source: 'PROVIDER_WEBHOOK',
        externalConfirmationId: `${PRIVATE}-${id()}`,
        amountMinor,
        currency: payment.currency,
        confirmedAt: new Date(),
        ledgerTransactionId: postingId,
        idempotencyKey: id(),
        requestDigest: DIGEST,
      },
    });
  }

  async function command(actor: Actor) {
    return prisma.moneyCommand.create({
      data: {
        actorUserId: actor.userId,
        idempotencyKey: id(),
        action: 'r33.fixture',
        contractVersion: 'hsm.money.v1',
        requestDigest: DIGEST,
        response: { privateFixture: PRIVATE },
      },
    });
  }

  async function pending(actor: Actor, currency: string, amountMinor: bigint, unknown: boolean) {
    const payment = await intent(actor, currency, amountMinor);
    await prisma.moneyPaymentIntent.update({
      where: { id: payment.id },
      data: { status: 'PROCESSING' },
    });
    const first = await prisma.moneyPaymentAttempt.create({
      data: { paymentIntentId: payment.id, attemptNo: 1 },
    });
    await prisma.moneyPaymentAttempt.update({
      where: { id: first.id },
      data: { status: 'FAILED' },
    });
    const latest = await prisma.moneyPaymentAttempt.create({
      data: { paymentIntentId: payment.id, attemptNo: 2 },
    });
    if (unknown) {
      const pair = await accounts(currency);
      await prisma.moneyIntentBinding.create({
        data: {
          paymentIntentId: payment.id,
          currency,
          debitAccountId: pair.debitId,
          creditAccountId: pair.creditId,
          adapterId: 'r33-synthetic',
          mode: 'SANDBOX',
          accountReference: PRIVATE,
          configVersion: 'r33-test-v1',
        },
      });
      const accepted = await command(actor);
      const dispatch = await prisma.moneyDispatch.create({
        data: {
          kind: 'COLLECTION',
          commandId: accepted.id,
          paymentIntentId: payment.id,
          paymentAttemptId: latest.id,
          providerIdempotencyKey: id(),
        },
      });
      await prisma.moneyDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'PENDING' },
      });
      await prisma.moneyDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'UNKNOWN', observation: { privateFixture: PRIVATE } },
      });
    }
    return payment;
  }

  async function refund(payment: Collection, amountMinor: bigint, succeeded: boolean) {
    const value = await prisma.moneyRefund.create({
      data: {
        paymentConfirmationId: payment.confirmationId,
        amountMinor,
        currency: payment.intent.currency,
        reasonCode: 'PRIVATE_OPERATOR_REASON',
        idempotencyKey: id(),
        requestDigest: DIGEST,
      },
    });
    if (succeeded) {
      const compensation = await ledger.post(SYSTEM, {
        idempotencyKey: id(),
        currency: payment.intent.currency,
        description: PRIVATE,
        externalReference: `money.refund:${value.id}`,
        lines: [
          { accountId: payment.creditId, side: 'DEBIT', amountMinor },
          { accountId: payment.debitId, side: 'CREDIT', amountMinor },
        ],
      });
      await prisma.moneyRefund.update({ where: { id: value.id }, data: { status: 'DISPATCHED' } });
      await prisma.moneyRefund.update({
        where: { id: value.id },
        data: { status: 'SUCCEEDED', compensatingLedgerTransactionId: compensation.transaction.id },
      });
    }
    return value.id;
  }

  async function refundRequest(actor: Actor, payment: Collection, amountMinor: bigint) {
    const accepted = await command(actor);
    return (
      await prisma.moneyRefundRequest.create({
        data: {
          commandId: accepted.id,
          providerProfileId: actor.providerProfileId,
          requestedByUserId: actor.userId,
          paymentConfirmationId: payment.confirmationId,
          amountMinor,
          currency: payment.intent.currency,
          reasonCode: 'PROVIDER_REQUEST',
        },
      })
    ).id;
  }

  it.each(['PAYMENT', 'ATTEMPT', 'REFUND_REQUEST', 'REFUND', 'SUBSCRIPTION'] as const)(
    'scopes every %s list/detail to the current provider, with equal foreign/missing 404s',
    async (kind) => {
      const foreign: Record<Exclude<FinancialRecordKind, 'SETTLEMENT'>, string> = {
        PAYMENT: otherCollection.intent.id,
        ATTEMPT: otherCollection.attemptId,
        REFUND_REQUEST: otherRequestId,
        REFUND: otherRefundId,
        SUBSCRIPTION: otherCollection.subscriptionId,
      };
      const page = await reports.records(owner.userId, 'PROVIDER', { kind, limit: 50 });
      expect(page.items.length).toBeGreaterThan(0);
      expect(
        page.items.every((record) => record.providerProfileId === owner.providerProfileId),
      ).toBe(true);
      await expect(
        reports.detail(owner.userId, 'PROVIDER', kind, foreign[kind]),
      ).rejects.toMatchObject({ status: 404, message: 'Financial resource not found.' });
      await expect(reports.detail(owner.userId, 'PROVIDER', kind, id())).rejects.toMatchObject({
        status: 404,
        message: 'Financial resource not found.',
      });
    },
  );

  it('preserves exact posted amounts and separates attempts, requested/reserved refunds, and unpaid subscriptions', async () => {
    const payment = await reports.detail(
      owner.userId,
      'PROVIDER',
      'PAYMENT',
      ownCollection.intent.id,
    );
    expect(payment.record).toMatchObject({
      amount: { amountMinor: LARGE.toString(), currency: 'XTS' },
      amountMeaning: 'CONFIRMED_COLLECTION',
      confirmationState: 'CONFIRMED',
      ledgerTransactionId: ownCollection.postingId,
    });
    const attempt = await reports.detail(
      owner.userId,
      'PROVIDER',
      'ATTEMPT',
      ownCollection.attemptId,
    );
    expect(attempt.record).toMatchObject({
      status: 'SUCCEEDED',
      amountMeaning: 'ATTEMPT_TOTAL',
      confirmationState: 'NOT_APPLICABLE',
      ledgerTransactionId: null,
    });
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'REFUND_REQUEST', ownRequestId)).record,
    ).toMatchObject({
      status: 'PENDING_POLICY',
      amountMeaning: 'REFUND_REQUESTED',
      publicReasonCode: 'PROVIDER_REQUEST',
      confirmationState: 'NOT_APPLICABLE',
    });
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'REFUND', ownRefundId)).record,
    ).toMatchObject({
      status: 'SUCCEEDED',
      amountMeaning: 'CONFIRMED_REFUND',
      confirmationState: 'CONFIRMED',
      publicReasonCode: null,
    });
    expect(
      (await reports.detail(other.userId, 'PROVIDER', 'REFUND', otherRefundId)).record,
    ).toMatchObject({
      status: 'RESERVED',
      amountMeaning: 'REFUND_RESERVED',
      confirmationState: 'UNCONFIRMED',
      ledgerTransactionId: null,
    });
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'SUBSCRIPTION', unpaidSubscriptionId)).record,
    ).toMatchObject({ amount: null, amountMeaning: 'UNAVAILABLE', period: null });
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'SUBSCRIPTION', ownCollection.subscriptionId))
        .record,
    ).toMatchObject({
      amount: { amountMinor: LARGE.toString(), currency: 'XTS' },
      amountMeaning: 'CONFIRMED_SUBSCRIPTION_PERIOD',
      confirmationState: 'CONFIRMED',
    });
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'PAYMENT', unknownIntentId)).record,
    ).toMatchObject({
      status: 'PROCESSING',
      dispatchStatus: 'UNKNOWN',
      confirmationState: 'UNCONFIRMED',
      ledgerTransactionId: null,
    });
    expect(JSON.stringify(payment)).not.toContain(PRIVATE);
    expect(JSON.stringify(payment)).not.toContain(DIGEST);
    expect(JSON.stringify(payment)).not.toContain(owner.email);
  });

  it('bounds latest subscription period selection in SQL before loading its proof', async () => {
    sql = [];
    const subscriptions = await reports.records(owner.userId, 'PROVIDER', {
      kind: 'SUBSCRIPTION',
      limit: 50,
    });
    expect(subscriptions.items).toHaveLength(2);
    expect(subscriptions.items.find((row) => row.id === unpaidSubscriptionId)?.amount).toBeNull();
    const periodSql = readStatements().filter((query) => query.includes('"SubscriptionPeriod"'));
    expect(periodSql).toHaveLength(2);
    expect(periodSql[0]).toMatch(/JOIN LATERAL[\s\S]+LIMIT 1/u);
    expect(periodSql[1]).toMatch(/LIMIT/u);
    expect(readStatements().length).toBeLessThanOrEqual(14);
  });

  it('uses authoritative ledger totals per currency and counts each pending obligation once despite retries', async () => {
    sql = [];
    const summary = await reports.summary(admin.userId);
    expect(summary.ledger.totals).toEqual([
      {
        currency: 'XTS',
        captured: { currency: 'XTS', amountMinor: LARGE.toString() },
        refunded: { currency: 'XTS', amountMinor: '100' },
      },
      {
        currency: 'XXX',
        captured: { currency: 'XXX', amountMinor: '700' },
        refunded: { currency: 'XXX', amountMinor: '0' },
      },
    ]);
    expect(summary.pendingTotals).toEqual([
      {
        currency: 'XTS',
        pending: { currency: 'XTS', amountMinor: '400' },
        unknown: { currency: 'XTS', amountMinor: '300' },
        refundsRequested: { currency: 'XTS', amountMinor: '99' },
      },
      {
        currency: 'XXX',
        pending: { currency: 'XXX', amountMinor: '50' },
        unknown: { currency: 'XXX', amountMinor: '0' },
        refundsRequested: { currency: 'XXX', amountMinor: '120' },
      },
    ]);
    expect(summary.ledger.source).toBe('LEDGER');
    expect(Number.isFinite(Date.parse(summary.ledger.asOf))).toBe(true);
    expect(Number.isFinite(Date.parse(summary.pendingAsOf))).toBe(true);
    // Two bounded authority snapshots, four aggregate queries, no per-row SQL.
    expect(readStatements().length).toBeLessThanOrEqual(16);
    expect(sql.filter((query) => /ISOLATION LEVEL REPEATABLE READ/u.test(query))).toHaveLength(2);
    expect(summary.reconciliation).toMatchObject({
      state: 'UNAVAILABLE',
      lastSuccessAt: null,
      runId: null,
    });
    expect(
      Object.values(summary.capabilities).every(
        (capability) => !capability.available && capability.href === null,
      ),
    ).toBe(true);
    const filtered = await reports.summary(admin.userId, 'XXX');
    expect(filtered.ledger.totals.map((value) => value.currency)).toEqual(['XXX']);
    expect(filtered.pendingTotals.map((value) => value.currency)).toEqual(['XXX']);
  });

  it('requires current capability and base role; permission revocation applies to the next read and export', async () => {
    const ungranted = await actor('admin', false);
    await expect(reports.summary(ungranted.userId)).rejects.toMatchObject({ status: 403 });
    await expect(reports.records(owner.userId, 'ADMIN')).rejects.toMatchObject({ status: 403 });
    const revoked = await actor('admin');
    await reports.records(revoked.userId, 'ADMIN');
    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: revoked.capabilityRoleId,
          permissionId: revoked.permissionId,
        },
      },
    });
    await expect(reports.records(revoked.userId, 'ADMIN')).rejects.toMatchObject({ status: 403 });
    await expect(
      reports.detail(revoked.userId, 'ADMIN', 'PAYMENT', ownCollection.intent.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(reports.summary(revoked.userId)).rejects.toMatchObject({ status: 403 });
    await expect(exports.export(revoked.userId)).rejects.toMatchObject({ status: 403 });
    const revokedProvider = await actor('provider');
    await reports.records(revokedProvider.userId, 'PROVIDER');
    await prisma.userRole.delete({
      where: {
        userId_roleId: { userId: revokedProvider.userId, roleId: revokedProvider.baseRoleId },
      },
    });
    await expect(reports.records(revokedProvider.userId, 'PROVIDER')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('keeps statement counts constant at 1 and 50 rows and keyset pages stable during a newer insert', async () => {
    const paged = await actor('provider');
    const at = new Date('2020-01-01T00:00:00.000Z');
    const first = await intent(paged, 'XTS', 1n, at);
    const ids = [first.id, ...Array.from({ length: 52 }, () => id())];
    await prisma.moneyPaymentIntent.createMany({
      data: ids.slice(1).map((recordId) => ({ ...first, id: recordId, idempotencyKey: id() })),
    });
    await prisma.moneyPaymentAttempt.createMany({
      data: ids.map((paymentIntentId) => ({ paymentIntentId, attemptNo: 1 })),
    });
    sql = [];
    await reports.records(paged.userId, 'PROVIDER', { limit: 1, currency: 'XTS' });
    const smallCount = readStatements().length;
    sql = [];
    const page = await reports.records(paged.userId, 'PROVIDER', { limit: 50, currency: 'XTS' });
    expect(readStatements().length).toBe(smallCount);
    expect(readStatements().length).toBeLessThanOrEqual(12);
    const attemptSql = readStatements().find((query) => query.includes('"MoneyPaymentAttempt"'));
    expect(attemptSql).toMatch(/\b(LIMIT|ROW_NUMBER)\b/iu);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
    const newer = await intent(paged, 'XTS', 1n, new Date('2020-01-02T00:00:00.000Z'));
    const rest = await reports.records(paged.userId, 'PROVIDER', {
      limit: 50,
      currency: 'XTS',
      cursor: page.nextCursor!,
    });
    expect(rest.items).toHaveLength(3);
    expect(rest.nextCursor).toBeNull();
    const seen = [...page.items, ...rest.items].map((record) => record.id);
    expect(new Set(seen).size).toBe(53);
    expect(seen.sort()).toEqual(ids.sort());
    expect(seen).not.toContain(newer.id);
    await expect(
      reports.records(other.userId, 'PROVIDER', { currency: 'XTS', cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reports.records(paged.userId, 'PROVIDER', { currency: 'XXX', cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reports.records(paged.userId, 'PROVIDER', {
        kind: 'ATTEMPT',
        currency: 'XTS',
        cursor: page.nextCursor!,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(reports.records(paged.userId, 'PROVIDER', { limit: 51 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('never observes a half-confirmed payment while the real financial transaction is in flight', async () => {
    const payment = await pending(owner, 'XTS', 77n, false);
    const pair = await accounts('XTS');
    const posting = await ledger.post(SYSTEM, {
      idempotencyKey: id(),
      currency: 'XTS',
      description: PRIVATE,
      lines: [
        { accountId: pair.debitId, side: 'DEBIT', amountMinor: 77n },
        { accountId: pair.creditId, side: 'CREDIT', amountMinor: 77n },
      ],
    });
    let midway!: () => void;
    let resume!: () => void;
    const halfway = new Promise<void>((resolve) => {
      midway = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const write = isolated.prisma.$transaction(async (tx) => {
      await tx.moneyPaymentIntent.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED' },
      });
      midway();
      await release;
      await confirm(tx, payment, posting.transaction.id);
    });
    try {
      await halfway;
      const inFlight = await reports.detail(owner.userId, 'PROVIDER', 'PAYMENT', payment.id);
      expect(inFlight.record).toMatchObject({
        status: 'PROCESSING',
        confirmationState: 'UNCONFIRMED',
        ledgerTransactionId: null,
      });
    } finally {
      resume();
      await write;
    }
    const afterCommit = await Promise.all(
      Array.from({ length: 4 }, () =>
        reports.detail(owner.userId, 'PROVIDER', 'PAYMENT', payment.id),
      ),
    );
    expect(
      afterCommit.every(
        (value) =>
          value.record.status === 'SUCCEEDED' &&
          value.record.confirmationState === 'CONFIRMED' &&
          value.record.ledgerTransactionId === posting.transaction.id,
      ),
    ).toBe(true);
  });

  it('keeps the database money proof guards active and rejects a mismatched confirmation', async () => {
    const payment = await intent(owner, 'XTS', 25n);
    await prisma.moneyPaymentIntent.update({
      where: { id: payment.id },
      data: { status: 'PROCESSING' },
    });
    await prisma.moneyPaymentIntent.update({
      where: { id: payment.id },
      data: { status: 'SUCCEEDED' },
    });
    await expect(
      prisma.$transaction((tx) => confirm(tx, payment, ownCollection.postingId, 24n)),
    ).rejects.toThrow(/Confirmed amount must equal the payment intent total/u);
    expect(
      (await reports.detail(owner.userId, 'PROVIDER', 'PAYMENT', payment.id)).record,
    ).toMatchObject({
      status: 'SUCCEEDED',
      confirmationState: 'INCONSISTENT',
      amountMeaning: 'INTENT_TOTAL',
      ledgerTransactionId: null,
    });
  });

  it('reports unavailable reconciliation independently of persisted exceptions and hides private decisions', async () => {
    expect(await reports.reconciliation(admin.userId)).toMatchObject({
      items: [],
      status: { state: 'UNAVAILABLE', lastSuccessAt: null, runId: null },
    });
    const exception = await prisma.moneyReconciliationException.create({
      data: {
        kind: 'AMOUNT_MISMATCH',
        subjectType: 'PaymentConfirmation',
        subjectId: ownCollection.confirmationId,
        detectedAt: new Date('2026-01-01T00:00:00.000Z'),
        resolvedAt: new Date(),
        resolutionCode: 'PRIVATE_OPERATOR_REASON',
      },
    });
    expect((await reports.reconciliation(admin.userId)).items.map((value) => value.id)).toEqual([
      exception.id,
    ]);
    const detail = await reports.exception(admin.userId, exception.id);
    expect(detail.allowedActions).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_OPERATOR_REASON');
    await expect(reports.exception(owner.userId, exception.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(await reports.records(admin.userId, 'ADMIN', { kind: 'SETTLEMENT' })).toMatchObject({
      items: [],
      availability: { state: 'UNAVAILABLE', reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
    });
    await expect(exports.export(admin.userId, { kind: 'SETTLEMENT' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('exports only one bounded page, preserves large integer text, neutralizes persisted formula IDs and redacts private data', async () => {
    const formulaId = '=HYPERLINK("https://synthetic.invalid","x")';
    await intent(owner, 'XTS', 5n, undefined, formulaId);
    const result = await exports.export(admin.userId, { kind: 'PAYMENT', limit: 50 });
    const csv = result.bytes.toString('utf8');
    expect(result.count).toBe(50);
    expect(result.hasMore).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(52);
    expect(csv).toContain(`"'${LARGE}"`);
    expect(csv).toContain('"\'=HYPERLINK(""https://synthetic.invalid"",""x"")"');
    for (const secret of [
      PRIVATE,
      DIGEST,
      owner.email,
      owner.providerProfileId,
      ownCollection.confirmationId,
      ownCollection.postingId,
    ])
      expect(csv).not.toContain(secret);
    const refundCsv = (await exports.export(admin.userId, { kind: 'REFUND' })).bytes.toString(
      'utf8',
    );
    expect(refundCsv).not.toContain('PRIVATE_OPERATOR_REASON');
  });

  it('fails closed if an exact per-currency pending aggregate exceeds the MoneyWire bound', async () => {
    await pending(other, 'XXX', MAX_MINOR, false);
    await expect(reports.summary(admin.userId, 'XXX')).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    // A separately requested currency remains accurate, never FX-converted.
    expect((await reports.summary(admin.userId, 'XTS')).ledger.totals[0].captured.amountMinor).toBe(
      (LARGE + 77n).toString(),
    );
  });

  function readStatements() {
    return sql.filter((query) => /^\s*SELECT\b/iu.test(query));
  }
});
