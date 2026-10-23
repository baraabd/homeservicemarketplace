import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { AuditService } from '../../iam/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import type { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import type { ManualReviewService } from './manual-review.service';
import {
  ManualRefundReviewService,
  type ManualRefundEvidenceInput,
} from './manual-refund-review.service';

describe('R30 manual refund evidence requires the persisted dispatcher authority', () => {
  function fixture() {
    const operation = {
      refundId: 'refund',
      state: 'UNKNOWN',
      dispatchUserId: 'dispatcher' as string | null,
      confirmationUserId: null as string | null,
      externalOperationId: 'operator-transfer' as string | null,
      reference: null as string | null,
      amountMinor: 200n,
      currency: 'XTS',
      refund: { paymentConfirmation: { paymentIntentId: 'intent' } },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      moneyManualRefundOperation: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...operation })),
        findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...operation })),
        update: jest
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(operation, data);
            return { ...operation };
          }),
      },
      moneyManualRefundEvent: { create: jest.fn().mockResolvedValue({ id: 'event' }) },
    };
    const prismaTx = tx as unknown as PrismaTx;
    const revoked = new Set<string>();
    const authorize = jest.fn(async (actorId: string, _permission: string, _tx: PrismaTx) => {
      if (revoked.has(actorId)) throw new AppError('FORBIDDEN', 'Current authority required.', 403);
    });
    const review = {
      authorize,
      context: jest.fn().mockResolvedValue({ ownerUserId: 'owner', binding: {} }),
      // The real command wrapper's current-caller checks and idempotency are
      // covered separately and through real HTTP in the integration suite.
      runMutation: jest.fn(async (...args: Parameters<ManualReviewService['runMutation']>) => {
        const [userId, , , , permission, check, execute] = args;
        await authorize(userId, permission, prismaTx);
        await check(prismaTx);
        return execute(prismaTx);
      }),
    };
    const config = { instruction: jest.fn().mockResolvedValue({}) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ManualRefundReviewService(
      review as unknown as ManualReviewService,
      config as unknown as ManualRailConfiguration,
      audit as unknown as AuditService,
    );
    const input: ManualRefundEvidenceInput = {
      type: 'CONFIRM_SUCCEEDED',
      externalOperationId: 'operator-transfer',
      reference: 'received-sandbox-transfer',
      amount: toMoneyWire({ amountMinor: 200n, currency: 'XTS' }),
      evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
    };
    return { operation, tx, revoked, authorize, audit, service, input };
  }

  it.each(['DISPATCH', 'CONFIRM_SUCCEEDED', 'CONFIRM_FAILED'] as const)(
    'rejects %s after dispatcher revocation without changing the operation or appending evidence',
    async (type) => {
      const f = fixture();
      const original = structuredClone(f.operation);
      f.revoked.add('dispatcher');
      await expect(
        f.service.record('reviewer', 'command', 'refund', { ...f.input, type }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.authorize).toHaveBeenCalledWith('dispatcher', 'money:refund:review', f.tx);
      expect(f.tx.moneyManualRefundOperation.update).not.toHaveBeenCalled();
      expect(f.tx.moneyManualRefundEvent.create).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
      expect(f.operation).toEqual(original);
    },
  );

  it.each([
    ['CONFIRM_SUCCEEDED', 'SUCCEEDED'],
    ['CONFIRM_FAILED', 'FAILED'],
  ] as const)('preserves the independent %s terminal outcome', async (type, state) => {
    const f = fixture();
    await expect(
      f.service.record('reviewer', 'command', 'refund', { ...f.input, type }),
    ).resolves.toEqual({ refundId: 'refund', state });
    expect(f.authorize).toHaveBeenCalledWith('dispatcher', 'money:refund:review', f.tx);
    expect(f.operation).toMatchObject({
      state,
      dispatchUserId: 'dispatcher',
      confirmationUserId: 'reviewer',
      reference: f.input.reference,
    });
    expect(f.tx.moneyManualRefundEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.moneyManualRefundEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type, recordedByUserId: 'reviewer' }),
      }),
    );
  });

  it('uses the current caller as authority when the locked operation has no dispatcher yet', async () => {
    const f = fixture();
    f.operation.state = 'PENDING';
    f.operation.dispatchUserId = null;
    f.operation.externalOperationId = null;
    f.input.type = 'DISPATCH';
    delete f.input.reference;
    await expect(f.service.record('dispatcher', 'command', 'refund', f.input)).resolves.toEqual({
      refundId: 'refund',
      state: 'UNKNOWN',
    });
    expect(f.authorize).toHaveBeenCalledWith('dispatcher', 'money:refund:review', f.tx);
    expect(f.operation).toMatchObject({
      state: 'UNKNOWN',
      dispatchUserId: 'dispatcher',
      externalOperationId: 'operator-transfer',
      confirmationUserId: null,
    });
    expect(f.tx.moneyManualRefundEvent.create).toHaveBeenCalledTimes(1);
  });
});
