import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import type {
  MoneyDispatch,
  MoneyRefund,
  MoneyRefundRequest,
  PrismaTx,
} from '@homeservicemarketplace/database';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import type { AuditService } from '../../iam/audit/audit.service';
import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type {
  MoneyCommandService,
  RefundRecoveryAuthorization,
} from '../application/money-command.service';
import { RefundRecoveryService } from './refund-recovery.service';

const USER = 'admin-r32-recovery';
const REFUND = 'refund-r32-recovery';
const PAYMENT = 'confirmation-r32-recovery';
const KEY = 'r32_recovery_command_0001';
const instant = new Date('2026-10-01T00:00:00Z');

// Contract doubles for the R24 command/transaction boundary. Real row locking,
// command idempotency, rollback and adapter calls are covered by R32 PostgreSQL.
function harness() {
  const refund: MoneyRefund = {
    id: REFUND,
    paymentConfirmationId: PAYMENT,
    amountMinor: 250n,
    currency: 'XTS',
    status: 'RESERVED',
    reasonCode: 'CONTRACT_COMPONENT',
    idempotencyKey: 'private-reservation-key',
    requestDigest: 'a'.repeat(64),
    externalRefundId: null,
    compensatingLedgerTransactionId: null,
    createdAt: instant,
    updatedAt: instant,
  };
  const dispatch: MoneyDispatch = {
    id: 'dispatch-r32',
    kind: 'REFUND',
    commandId: 'command-r32',
    paymentAttemptId: null,
    refundId: REFUND,
    paymentIntentId: 'intent-r32',
    providerIdempotencyKey: 'private-provider-key',
    status: 'NOT_DISPATCHED',
    claimId: null,
    leaseUntil: null,
    externalOperationId: 'private-external-reference',
    observation: { accountReference: 'private-account', payload: 'private-error-text' },
    createdAt: instant,
    updatedAt: instant,
  };
  const request: MoneyRefundRequest = {
    id: 'request-r32',
    commandId: 'request-command-r32',
    providerProfileId: 'provider-r32',
    requestedByUserId: 'payer-r32',
    paymentConfirmationId: PAYMENT,
    amountMinor: 250n,
    currency: 'XTS',
    reasonCode: 'CONTRACT_COMPONENT',
    status: 'AUTHORIZED',
    policyVersion: 'synthetic-r32-policy',
    decisionCode: null,
    refundId: REFUND,
    createdAt: instant,
    updatedAt: instant,
  };
  const row = {
    ...refund,
    dispatch: dispatch as MoneyDispatch | null,
    request: request as MoneyRefundRequest | null,
  };
  const rights = new Set(['money:review:read', 'money:refund:review']);
  let activeAdmin = true;
  let insideTransaction = false;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findFirst: jest.fn(async () => (activeAdmin ? { id: USER } : null)) },
    moneyRefund: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; paymentConfirmationId: string } }) =>
          where.id === row.id && where.paymentConfirmationId === row.paymentConfirmationId
            ? row
            : null,
      ),
    },
  };
  const transactions = {
    run: jest.fn(async (work: (client: PrismaTx) => Promise<unknown>) => {
      insideTransaction = true;
      try {
        return await work(tx as unknown as PrismaTx);
      } finally {
        insideTransaction = false;
      }
    }),
  };
  const permissions = { resolveFreshForUser: jest.fn(async () => new Set(rights)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const saved = new Map<string, string>();
  const outbound: string[] = [];
  let beforeFence: (() => void) | undefined;
  let afterCommand: (() => void) | undefined;
  const execute = (operation: 'QUERY' | 'DISPATCH') =>
    jest.fn(
      async (
        user: string,
        commandKey: string,
        refundId: string,
        authorization: RefundRecoveryAuthorization,
      ) => {
        // Simulate the real port's always-fresh replay authorization and immutable request.
        if (!activeAdmin || !rights.has('money:refund:review'))
          throw new AppError('FORBIDDEN', 'private-error-text', 403);
        const identity = JSON.stringify({
          user,
          operation,
          refundId,
          request: authorization.request,
        });
        if (saved.has(commandKey)) {
          if (saved.get(commandKey) !== identity)
            throw new AppError('CONFLICT', 'private-error-text', 409);
        } else {
          beforeFence?.();
          await transactions.run((client) => authorization.assertCurrent(client));
          saved.set(commandKey, identity);
        }
        expect(insideTransaction).toBe(false);
        outbound.push(operation);
        afterCommand?.();
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          commandId: 'accepted-r32',
          resourceType: 'REFUND' as const,
          resourceId: refundId,
          status: 'ACCEPTED' as const,
        };
      },
    );
  const commands = { queryRefund: execute('QUERY'), dispatchRefund: execute('DISPATCH') };
  const service = new RefundRecoveryService(
    transactions as unknown as TransactionRunner,
    permissions as unknown as PermissionResolverService,
    audit as unknown as AuditService,
    commands as unknown as MoneyCommandService,
  );
  const body = async (extra: Record<string, unknown> = {}) => ({
    contractVersion: MONEY_CONTRACT_VERSION,
    paymentConfirmationId: PAYMENT,
    expectedStateRevision: (await service.inspect(USER, REFUND, PAYMENT)).stateRevision,
    operation: 'DISPATCH',
    ...extra,
  });
  return {
    service,
    body,
    tx,
    row,
    dispatch,
    request,
    audit,
    commands,
    rights,
    permissions,
    outbound,
    saved,
    revokeAdmin: () => {
      activeAdmin = false;
    },
    beforeFence: (action: () => void) => {
      beforeFence = action;
    },
    afterCommand: (action: () => void) => {
      afterCommand = action;
    },
  };
}

describe('R32 authorized, scoped refund recovery', () => {
  it('returns only bounded state and an opaque revision, never private transport or command material', async () => {
    const h = harness();
    const inspection = await h.service.inspect(USER, REFUND, PAYMENT);
    expect(inspection).toMatchObject({
      state: 'RESERVED',
      amount: { amountMinor: '250', currency: 'XTS' },
      reservationHeld: true,
      expiryPolicy: 'POLICY_BLOCKED',
      automaticReservationRelease: false,
    });
    expect(inspection.stateRevision).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(inspection)).not.toMatch(
      /private-|requestDigest|providerIdempotencyKey|externalOperationId|accountReference/u,
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        metadata: expect.objectContaining({
          moneyAction: 'REFUND_RECOVERY_INSPECT',
          refundId: REFUND,
        }),
      }),
      h.tx,
    );
  });

  it.each(['money:review:read', 'admin'])(
    'refuses stale inspection authority %s before reading the refund',
    async (missing) => {
      const h = harness();
      if (missing === 'admin') h.revokeAdmin();
      else h.rights.delete(missing);
      await expect(h.service.inspect(USER, REFUND, PAYMENT)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
      expect(h.tx.moneyRefund.findFirst).not.toHaveBeenCalled();
    },
  );

  it('rechecks active status, deletion and live admin membership inside its transaction', async () => {
    const h = harness();
    await h.service.inspect(USER, REFUND, PAYMENT);
    expect(h.permissions.resolveFreshForUser).toHaveBeenCalledWith(USER, h.tx);
    expect(h.tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: USER,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: 'admin', deletedAt: null } } },
      },
      select: { id: true },
    });
  });

  it('requires the exact confirmed-payment scope and does not reveal another scope', async () => {
    const h = harness();
    await expect(h.service.inspect(USER, REFUND, 'other-confirmation')).rejects.toMatchObject({
      status: 404,
    });
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it.each(['../refund', '', 'x'.repeat(65), 'refund\nheader'])(
    'rejects unsafe scope %j without DB reads',
    async (scope) => {
      const h = harness();
      await expect(h.service.inspect(USER, scope, PAYMENT)).rejects.toMatchObject({ status: 400 });
      expect(h.tx.moneyRefund.findFirst).not.toHaveBeenCalled();
    },
  );

  it('defaults replay to audited dry-run and never calls either transport command', async () => {
    const h = harness();
    const result = await h.service.replay(USER, KEY, REFUND, await h.body());
    expect(result).toMatchObject({ outcome: 'DRY_RUN', dryRun: true });
    expect(h.commands.queryRefund).not.toHaveBeenCalled();
    expect(h.commands.dispatchRefund).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ moneyAction: 'REFUND_RECOVERY_DRY_RUN' }),
      }),
      h.tx,
    );
  });

  it.each([
    { dryRun: false },
    { dryRun: 'false' },
    { operation: 'CANCEL' },
    { operation: 'RELEASE_RESERVATION' },
    { externalOperationId: 'forged' },
    { actorUserId: 'forged' },
    { expectedStateRevision: 'short' },
    { approvalReference: 'line\nbreak' },
    { approvalReference: 'a'.repeat(129) },
  ])('rejects unsafe replay inputs %# without invoking a command', async (extra) => {
    const h = harness();
    await expect(h.service.replay(USER, KEY, REFUND, await h.body(extra))).rejects.toMatchObject({
      status: 400,
    });
    expect(h.outbound).toEqual([]);
  });

  it('requires a valid caller idempotency key even for dry-run', async () => {
    const h = harness();
    await expect(h.service.replay(USER, 'short', REFUND, await h.body())).rejects.toMatchObject({
      status: 400,
    });
    expect(h.outbound).toEqual([]);
  });

  it('binds approval, scope and revision in the immutable command and audits before external work', async () => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    await h.service.replay(USER, KEY, REFUND, input);
    expect(h.commands.dispatchRefund).toHaveBeenCalledWith(
      USER,
      KEY,
      REFUND,
      expect.objectContaining({
        request: {
          paymentConfirmationId: PAYMENT,
          expectedStateRevision: input.expectedStateRevision,
          approvalReference: 'ops-case-32',
        },
        assertCurrent: expect.any(Function),
      }),
    );
    expect(h.tx.$queryRaw).toHaveBeenCalled();
    const approval = h.audit.record.mock.calls.find(
      ([event]) => event.metadata.moneyAction === 'REFUND_RECOVERY_APPROVED_DISPATCH',
    )![0];
    expect(approval.requestId).toMatch(/^r32_approval_[a-f0-9]{64}$/u);
    expect(JSON.stringify(approval)).not.toContain('ops-case-32');
    expect(h.outbound).toEqual(['DISPATCH']);
  });

  it('rejects a state change between inspection and the locked command fence', async () => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    h.beforeFence(() => {
      h.dispatch.updatedAt = new Date(instant.getTime() + 1);
    });
    await expect(h.service.replay(USER, KEY, REFUND, input)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'MONEY_REFUND_RECOVERY_STALE_REVISION' },
    });
    expect(h.outbound).toEqual([]);
    expect(h.saved.size).toBe(0);
  });

  it('refuses capability revocation at execution and also on an idempotent retry', async () => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    await h.service.replay(USER, KEY, REFUND, input);
    h.rights.delete('money:refund:review');
    await expect(h.service.replay(USER, KEY, REFUND, input)).rejects.toMatchObject({ status: 403 });
    expect(h.outbound).toEqual(['DISPATCH']);
  });

  it('does not obstruct an unchanged idempotent command after the state has advanced', async () => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    h.afterCommand(() => {
      h.dispatch.status = 'UNKNOWN';
      h.dispatch.updatedAt = new Date(instant.getTime() + 1);
    });
    await h.service.replay(USER, KEY, REFUND, input);
    await expect(h.service.replay(USER, KEY, REFUND, input)).resolves.toMatchObject({
      outcome: 'AMBIGUOUS',
    });
    expect(h.saved.size).toBe(1);
    expect(
      h.audit.record.mock.calls.filter(
        ([event]) => event.metadata.moneyAction === 'REFUND_RECOVERY_APPROVED_DISPATCH',
      ),
    ).toHaveLength(1);
    await expect(
      h.service.replay(USER, KEY, REFUND, { ...input, approvalReference: 'different-case' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(['UNKNOWN', 'PENDING'] as const)(
    'an uncertain %s attempt only permits querying, without releasing its amount',
    async (status) => {
      const h = harness();
      h.dispatch.status = status;
      const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
      await expect(h.service.replay(USER, KEY, REFUND, input)).rejects.toMatchObject({
        details: { reason: 'MONEY_REFUND_QUERY_REQUIRED' },
      });
      await expect(
        h.service.replay(USER, KEY, REFUND, { ...input, operation: 'QUERY' }),
      ).resolves.toMatchObject({
        inspection: { reservationHeld: true, automaticReservationRelease: false },
      });
      expect(h.outbound).toEqual(['QUERY']);
      expect(h.dispatch.providerIdempotencyKey).toBe('private-provider-key');
    },
  );

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'recognizes persisted external %s proof while local completion is pending',
    async (status) => {
      const h = harness();
      h.dispatch.status = 'UNKNOWN';
      h.dispatch.observation = {
        status,
        externalOperationId: h.dispatch.externalOperationId,
        refundId: REFUND,
        paymentConfirmationId: PAYMENT,
        adapterId: 'contract-adapter',
        mode: 'SANDBOX',
        accountReference: 'private-account',
        amount: { amountMinor: '250', currency: 'XTS' },
      };
      const value = await h.service.inspect(USER, REFUND, PAYMENT);
      expect(value).toMatchObject({
        state: 'AMBIGUOUS',
        diagnosticCode: 'LOCAL_COMPLETION_REQUIRED',
        allowedOperations: ['QUERY'],
      });
      expect(JSON.stringify(value)).not.toMatch(/private-|externalOperationId|accountReference/u);
    },
  );

  it.each([
    { paymentConfirmationId: 'other-confirmation' },
    { refundId: 'other-refund' },
    { externalOperationId: null },
    { externalOperationId: 'other-external-reference' },
    { amount: { amountMinor: '251', currency: 'XTS' } },
    { amount: { amountMinor: '250', currency: 'USD' } },
    { status: 'PENDING' },
    { unexpectedRawField: 'private-error' },
  ])(
    'does not present unvalidated or misbound observation %# as terminal evidence',
    async (extra) => {
      const h = harness();
      h.dispatch.status = 'UNKNOWN';
      h.dispatch.observation = {
        status: 'SUCCEEDED',
        externalOperationId: h.dispatch.externalOperationId,
        refundId: REFUND,
        paymentConfirmationId: PAYMENT,
        adapterId: 'contract-adapter',
        mode: 'SANDBOX',
        accountReference: 'private-account',
        amount: { amountMinor: '250', currency: 'XTS' },
        ...extra,
      };
      expect(await h.service.inspect(USER, REFUND, PAYMENT)).toMatchObject({
        state: 'AMBIGUOUS',
        diagnosticCode: 'QUERY_REQUIRED',
        reservationHeld: true,
      });
    },
  );

  it('includes observation changes in the revision even if the timestamp was not advanced', async () => {
    const h = harness();
    const before = await h.service.inspect(USER, REFUND, PAYMENT);
    h.dispatch.observation = { status: 'UNKNOWN', externalOperationId: null };
    const after = await h.service.inspect(USER, REFUND, PAYMENT);
    expect(before.stateRevision).not.toBe(after.stateRevision);
  });

  it('reports an inconsistent terminal dispatch without claiming local completion', async () => {
    const h = harness();
    h.dispatch.status = 'SUCCEEDED';
    expect(await h.service.inspect(USER, REFUND, PAYMENT)).toMatchObject({
      state: 'AMBIGUOUS',
      diagnosticCode: 'CONFIRMATION_INCONSISTENT',
    });
  });

  it('reports confirmed success only after local compensation has also committed', async () => {
    const h = harness();
    h.row.status = 'SUCCEEDED';
    expect(await h.service.inspect(USER, REFUND, PAYMENT)).toMatchObject({
      state: 'AMBIGUOUS',
      diagnosticCode: 'CONFIRMATION_INCONSISTENT',
    });
    h.row.compensatingLedgerTransactionId = 'linked-compensation';
    expect(await h.service.inspect(USER, REFUND, PAYMENT)).toMatchObject({
      state: 'CONFIRMED_SUCCEEDED',
      allowedOperations: [],
      reservationHeld: false,
    });
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const)(
    'terminal %s refunds cannot authorize a new replay',
    async (status) => {
      const h = harness();
      h.row.status = status;
      await expect(
        h.service.replay(
          USER,
          KEY,
          REFUND,
          await h.body({ dryRun: false, approvalReference: 'ops-case-32' }),
        ),
      ).rejects.toMatchObject({ details: { reason: 'MONEY_REFUND_ALREADY_TERMINAL' } });
      expect(h.outbound).toEqual([]);
    },
  );

  it('does not infer reservation expiry from a very old request or an expired lease', async () => {
    const h = harness();
    h.row.createdAt = new Date('2001-01-01T00:00:00Z');
    h.dispatch.status = 'UNKNOWN';
    h.dispatch.leaseUntil = new Date('2001-01-01T00:00:00Z');
    expect(await h.service.inspect(USER, REFUND, PAYMENT)).toMatchObject({
      expiryPolicy: 'POLICY_BLOCKED',
      reservationHeld: true,
      automaticReservationRelease: false,
      allowedOperations: ['QUERY'],
    });
  });

  it('audit failure aborts approval before any external work and redacts the failure', async () => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    h.audit.record.mockRejectedValue(new Error('private-account private-error-text'));
    await expect(h.service.replay(USER, KEY, REFUND, input)).rejects.toMatchObject({
      status: 503,
      message: 'Refund recovery is temporarily unavailable.',
    });
    expect(h.outbound).toEqual([]);
    expect(h.saved.size).toBe(0);
  });

  it.each([
    ['MONEY_REFUND_POLICY_UNAVAILABLE', 'POLICY_BLOCKED'],
    ['MONEY_REFUND_ADAPTER_UNAVAILABLE', 'EXTERNAL_BLOCKED'],
  ])('returns a typed %s blocker without raw adapter errors', async (reason, outcome) => {
    const h = harness();
    const input = await h.body({ dryRun: false, approvalReference: 'ops-case-32' });
    h.commands.dispatchRefund.mockRejectedValue(
      new AppError('DEPENDENCY_UNAVAILABLE', 'private-error-text', 503, {
        reason,
        raw: 'private-account',
      }),
    );
    const result = await h.service.replay(USER, KEY, REFUND, input);
    expect(result).toMatchObject({
      outcome,
      diagnosticCode: reason,
      inspection: { reservationHeld: true },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-|raw/u);
  });
});
