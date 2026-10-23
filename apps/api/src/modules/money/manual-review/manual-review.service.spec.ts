import type { PrismaTx } from '@homeservicemarketplace/database';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../iam/audit/audit.service';
import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import { moneyCommandDigest } from '../application/money-command.service';
import { ManualReviewService } from './manual-review.service';

describe('R30 fresh authorization precedes command replay', () => {
  function fixture() {
    const request = { paymentIntentId: 'intent', expectedVersion: 3 };
    const authority = { session: 'R30', mode: 'SANDBOX' };
    const prior = {
      actorUserId: 'reviewer',
      actorSystem: null,
      action: 'R30_DECIDE',
      requestDigest: moneyCommandDigest({ userId: 'reviewer' }, 'R30_DECIDE', request, authority),
      response: { request, value: { decisionId: 'decision' }, authority },
    };
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'reviewer' }) },
      moneyCommand: { findUnique: jest.fn().mockResolvedValue(prior), create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const permissions = {
      resolveFreshForUser: jest.fn().mockResolvedValue(new Set(['money:receipt:review'])),
    };
    const transactions = {
      run: (work: (client: PrismaTx) => Promise<unknown>) => work(tx as unknown as PrismaTx),
    };
    const service = new ManualReviewService(
      transactions as unknown as TransactionRunner,
      permissions as unknown as PermissionResolverService,
      {} as ManualRailConfiguration,
      { record: jest.fn() } as unknown as AuditService,
      {} as NotificationsService,
    );
    const execute = jest.fn();
    const check = jest.fn().mockResolvedValue({});
    const call = (input = request) =>
      service.runMutation(
        'reviewer',
        'r30_decision_replay_key',
        'R30_DECIDE',
        input,
        'money:receipt:review',
        check,
        execute,
      );
    return { call, permissions, tx, check, execute };
  }

  it('returns the same immutable value without executing again', async () => {
    const f = fixture();
    await expect(f.call()).resolves.toEqual({ decisionId: 'decision' });
    expect(f.check).toHaveBeenCalledTimes(1);
    expect(f.permissions.resolveFreshForUser).toHaveBeenCalledTimes(1);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('rejects a revoked permission before exposing a formerly valid response', async () => {
    const f = fixture();
    f.permissions.resolveFreshForUser.mockResolvedValue(new Set());
    await expect(f.call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.tx.moneyCommand.findUnique).not.toHaveBeenCalled();
  });

  it('rejects removal of the current admin base role even if a custom permission persists', async () => {
    const f = fixture();
    f.tx.user.findFirst.mockResolvedValue(null);
    await expect(f.call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.tx.moneyCommand.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a reused key with changed request data', async () => {
    const f = fixture();
    await expect(
      f.call({ paymentIntentId: 'different', expectedVersion: 3 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(f.execute).not.toHaveBeenCalled();
  });
});
