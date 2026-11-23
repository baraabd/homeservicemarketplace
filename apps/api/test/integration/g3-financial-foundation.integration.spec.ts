import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@homeservicemarketplace/database';

// Real PostgreSQL, disposable namespace; no rail funds or commercial approval.
// Existing CI RUN_DB_INTEGRATION gate is mandatory for G3 source acceptance.
const db = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
db('G3 durable financial foundation (real PostgreSQL)', () => {
  let prisma: PrismaClient;
  const prefix = `it-g3-${randomUUID()}`;
  const scope = {
    adapterId: 'hsm.stripe.v1',
    mode: 'SANDBOX' as const,
    accountReference: prefix,
    currency: 'XTS',
  };
  const windowData = { ...scope, startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-02') };
  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  it('deduplicates concurrent windows and observations across overlapping windows', async () => {
    const windows = await Promise.allSettled([
      prisma.moneyReconciliationWindow.create({ data: windowData }),
      prisma.moneyReconciliationWindow.create({ data: windowData }),
    ]);
    expect(windows.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const window = await prisma.moneyReconciliationWindow.findFirstOrThrow({
      where: { accountReference: prefix },
    });
    const overlap = await prisma.moneyReconciliationWindow.create({
      data: { ...windowData, endsAt: new Date('2026-01-03') },
    });
    const data = {
      ...scope,
      windowId: window.id,
      sourceEventId: 'evt-test',
      payloadDigest: 'a'.repeat(64),
      observedAt: window.startsAt,
    };
    const observations = await Promise.allSettled([
      prisma.moneyReconciliationObservation.create({ data }),
      prisma.moneyReconciliationObservation.create({ data: { ...data, windowId: overlap.id } }),
    ]);
    expect(observations.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.moneyReconciliationObservation.count({
        where: { accountReference: prefix, sourceEventId: 'evt-test' },
      }),
    ).toBe(1);
  });
  it('preserves cursor/revision/fence across a fresh database client', async () => {
    const w = await prisma.moneyReconciliationWindow.create({
      data: {
        ...windowData,
        accountReference: prefix + 'cursor',
        cursor: 'external-page-2',
        revision: 1,
        fence: 2,
      },
    });
    const fresh = new PrismaClient();
    try {
      expect(
        await fresh.moneyReconciliationWindow.findUnique({ where: { id: w.id } }),
      ).toMatchObject({ cursor: 'external-page-2', revision: 1, fence: 2 });
    } finally {
      await fresh.$disconnect();
    }
  });
  it('cannot report a completed run without independent source completeness and evidence', async () => {
    const window = await prisma.moneyReconciliationWindow.create({
      data: { ...windowData, accountReference: prefix + 'run' },
    });
    const data = {
      windowId: window.id,
      sourceKind: 'PROVIDER_STATEMENT',
      sourceReference: 'synthetic-statement',
      fence: 0,
    };
    await expect(
      prisma.moneyReconciliationRun.create({
        data: { ...data, state: 'COMPLETED', completedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.moneyReconciliationRun.create({ data: { ...data, sourceKind: 'APPLICATION_TABLES' } }),
    ).rejects.toThrow();
    const blocked = await prisma.moneyReconciliationRun.create({
      data: { ...data, state: 'BLOCKED', failureCode: 'PROVIDER_UNAVAILABLE' },
    });
    expect(blocked.sourceComplete).toBe(false);
    expect(blocked.evidenceDigest).toBeNull();
  });
  it('rejects mismatched observation scope and preserves original evidence', async () => {
    const window = await prisma.moneyReconciliationWindow.create({
      data: { ...windowData, accountReference: prefix + 'evidence' },
    });
    const data = {
      ...scope,
      accountReference: window.accountReference,
      windowId: window.id,
      sourceEventId: 'evt-evidence',
      payloadDigest: 'b'.repeat(64),
      observedAt: window.startsAt,
    };
    await expect(
      prisma.moneyReconciliationObservation.create({ data: { ...data, currency: 'XXX' } }),
    ).rejects.toThrow();
    const observation = await prisma.moneyReconciliationObservation.create({ data });
    await expect(
      prisma.moneyReconciliationObservation.update({
        where: { id: observation.id },
        data: { payloadDigest: 'c'.repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.moneyReconciliationObservation.delete({ where: { id: observation.id } }),
    ).rejects.toThrow();
  });
  it('retains exception evidence and immutable decisions across resolve and reopen', async () => {
    const window = await prisma.moneyReconciliationWindow.create({
      data: { ...windowData, accountReference: prefix + 'case' },
    });
    const exception = await prisma.moneyReconciliationException.create({
      data: { kind: 'MISSING_ACTIVATION', subjectType: 'SubscriptionPeriod', subjectId: prefix },
    });
    const operation = await prisma.moneyReconciliationCase.create({
      data: {
        exceptionId: exception.id,
        windowId: window.id,
        severity: 'CRITICAL',
        originalEvidenceDigest: 'd'.repeat(64),
        lastCheckedAt: new Date(),
      },
    });
    const users = await Promise.all(
      ['maker', 'checker'].map((label) =>
        prisma.user.create({
          data: {
            email: `${prefix}-${label}@example.invalid`,
            firstName: 'Synthetic',
            lastName: label,
          },
        }),
      ),
    );
    const decision = {
      exceptionId: exception.id,
      revision: 1,
      action: 'RESOLVE',
      makerUserId: users[0]!.id,
      checkerUserId: users[1]!.id,
      idempotencyKey: prefix + 'resolve',
      payloadHash: 'e'.repeat(64),
      reasonCode: 'SOURCE_VERIFIED',
    };
    await expect(
      prisma.moneyReconciliationDecision.create({
        data: { ...decision, checkerUserId: users[0]!.id },
      }),
    ).rejects.toThrow();
    const saved = await prisma.$transaction(async (tx) => {
      await tx.moneyReconciliationCase.update({
        where: { exceptionId: exception.id },
        data: { revision: 1 },
      });
      const saved = await tx.moneyReconciliationDecision.create({ data: decision });
      await tx.moneyReconciliationException.update({
        where: { id: exception.id },
        data: { resolvedAt: saved.createdAt, resolutionCode: decision.reasonCode },
      });
      return saved;
    });
    await expect(
      prisma.moneyReconciliationException.update({
        where: { id: exception.id },
        data: { resolvedAt: null, resolutionCode: null },
      }),
    ).rejects.toThrow();
    await prisma.$transaction(async (tx) => {
      await tx.moneyReconciliationCase.update({
        where: { exceptionId: exception.id },
        data: { revision: 2 },
      });
      await tx.moneyReconciliationDecision.create({
        data: { ...decision, revision: 2, action: 'REOPEN', idempotencyKey: prefix + 'reopen' },
      });
      await tx.moneyReconciliationException.update({
        where: { id: exception.id },
        data: { resolvedAt: null, resolutionCode: null },
      });
    });
    expect(
      (await prisma.moneyReconciliationException.findUniqueOrThrow({ where: { id: exception.id } }))
        .resolvedAt,
    ).toBeNull();
    await expect(
      prisma.moneyReconciliationDecision.update({
        where: { id: saved.id },
        data: { reasonCode: 'REWRITE_HISTORY' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.moneyReconciliationCase.update({
        where: { exceptionId: exception.id },
        data: { originalEvidenceDigest: 'f'.repeat(64) },
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.moneyReconciliationCase.findUniqueOrThrow({
          where: { exceptionId: exception.id },
        })
      ).originalEvidenceDigest,
    ).toBe(operation.originalEvidenceDigest);
    expect(
      await prisma.moneyReconciliationDecision.count({ where: { exceptionId: exception.id } }),
    ).toBe(2);
  });
  it('stores approved sandbox policies immutably without creating a default policy', async () => {
    const version = prefix + 'policy';
    const now = new Date();
    const data = {
      version,
      planVersionId: 'synthetic-plan',
      method: 'STRIPE' as const,
      mode: 'SANDBOX' as const,
      currency: 'XTS',
      approvalReference: 'synthetic-fixture-only',
      approvedAt: now,
      validFrom: now,
      validUntil: new Date(now.getTime() + 60000),
      rules: { synthetic: true },
      entitlementEffect: 'SUSPEND_SUBSCRIPTION' as const,
    };
    await expect(
      prisma.moneyApprovedRefundPolicy.create({ data: { ...data, mode: 'LIVE' } }),
    ).rejects.toThrow();
    await prisma.moneyApprovedRefundPolicy.create({ data });
    await expect(
      prisma.moneyApprovedRefundPolicy.update({
        where: { version },
        data: { rules: { rewritten: true } },
      }),
    ).rejects.toThrow();
    await expect(prisma.moneyApprovedRefundPolicy.delete({ where: { version } })).rejects.toThrow();
  });
});
