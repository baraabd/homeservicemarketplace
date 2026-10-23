import type { AppConfigService } from '../../../config/app-config.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import type { MoneyCommandService } from '../application/money-command.service';
import type { ReceiptUploadService } from './receipt-upload.service';
import { ManualEventProcessingJob } from './manual-event-processing.job';

describe('R30 bounded approval recovery', () => {
  function fixture(attemptCount = 0, reconciliationRequired = false) {
    const state = {
      paymentIntentId: 'intent',
      state: 'CONFIRMING',
      attemptCount,
      reconciliationRequired,
      pendingDecisionId: 'pending',
      nextAttemptAt: null as Date | null,
      lastErrorCode: null as string | null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      pendingDecision: {
        id: 'pending',
        reviewerUserId: 'reviewer',
        receipt: { mediaAssetId: 'asset' },
      },
    };
    const store = {
      findUnique: jest.fn().mockImplementation(async () => ({ ...state })),
      updateMany: jest.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: Partial<typeof state>;
          data: {
            attemptCount: { increment: number };
            reconciliationRequired: boolean;
            nextAttemptAt: Date | null;
            lastErrorCode: string;
          };
        }) => {
          const matches = Object.entries(where).every(([key, expected]) => {
            const actual = state[key as keyof typeof state];
            return actual instanceof Date && expected instanceof Date
              ? actual.getTime() === expected.getTime()
              : actual === expected;
          });
          if (!matches) return { count: 0 };
          state.attemptCount += data.attemptCount.increment;
          state.reconciliationRequired = data.reconciliationRequired;
          state.nextAttemptAt = data.nextAttemptAt;
          state.lastErrorCode = data.lastErrorCode;
          state.updatedAt = new Date(state.updatedAt.getTime() + 1);
          return { count: 1 };
        },
      ),
    };
    const commands = {
      acceptReceipt: jest.fn().mockResolvedValue({ resourceId: 'event' }),
      processExternalEvent: jest.fn().mockRejectedValue(new Error('transient test failure')),
    };
    const job = new ManualEventProcessingJob(
      { client: { moneyManualReview: store } } as unknown as PrismaService,
      commands as unknown as MoneyCommandService,
      {} as ReceiptUploadService,
      {} as AppConfigService,
    );
    return { job, store, commands, state };
  }

  function heldFailure() {
    let fail!: (error: Error) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const pending = new Promise<never>((_, reject) => {
      fail = reject;
    });
    return {
      entered,
      fail,
      run: () => {
        enter();
        return pending;
      },
    };
  }

  it('stops automatic retries immediately on revoked authority without consuming the candidate', async () => {
    const f = fixture();
    f.commands.processExternalEvent.mockRejectedValue(
      new AppError('FORBIDDEN', 'Current authority required.', 403),
    );
    await expect(f.job.process('intent')).resolves.toBe(false);
    expect(f.store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconciliationRequired: true,
          lastErrorCode: 'FORBIDDEN',
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it('allows bounded transient recovery and moves the eighth failure to reconciliation', async () => {
    const first = fixture();
    await first.job.process('intent');
    expect(first.store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconciliationRequired: false,
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
    const last = fixture(7);
    await last.job.process('intent');
    expect(last.store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reconciliationRequired: true,
          nextAttemptAt: null,
        }),
      }),
    );
  });

  it('never calls money commands again for a permanently blocked candidate', async () => {
    const f = fixture(2, true);
    await expect(f.job.process('intent')).resolves.toBe(false);
    expect(f.commands.acceptReceipt).not.toHaveBeenCalled();
    expect(f.store.updateMany).not.toHaveBeenCalled();
  });

  it('fences simultaneous failures so the eighth recorded attempt always halts', async () => {
    const f = fixture(6);
    const first = heldFailure();
    const second = heldFailure();
    f.commands.processExternalEvent
      .mockImplementationOnce(first.run)
      .mockImplementationOnce(second.run);
    const processing = Promise.all([f.job.process('intent'), f.job.process('intent')]);
    await Promise.all([first.entered, second.entered]);
    first.fail(new Error('first transient failure'));
    second.fail(new Error('second transient failure'));
    await expect(processing).resolves.toEqual([false, false]);
    expect(f.state).toMatchObject({ attemptCount: 7, reconciliationRequired: false });
    expect(f.state.nextAttemptAt).toBeInstanceOf(Date);

    await f.job.process('intent');
    expect(f.state).toMatchObject({
      attemptCount: 8,
      reconciliationRequired: true,
      nextAttemptAt: null,
    });
  });

  it('never clears a permanent halt when an older transient failure completes later', async () => {
    const f = fixture();
    const permanent = heldFailure();
    const transient = heldFailure();
    f.commands.processExternalEvent
      .mockImplementationOnce(permanent.run)
      .mockImplementationOnce(transient.run);
    const first = f.job.process('intent');
    const second = f.job.process('intent');
    await Promise.all([permanent.entered, transient.entered]);
    permanent.fail(new AppError('FORBIDDEN', 'Current authority required.', 403));
    await first;
    transient.fail(new Error('late transient failure'));
    await second;
    expect(f.state).toMatchObject({
      attemptCount: 1,
      reconciliationRequired: true,
      lastErrorCode: 'FORBIDDEN',
      nextAttemptAt: null,
    });
  });

  it('ignores old in-flight failures after an explicit retry resets the operational state', async () => {
    const f = fixture();
    const permanent = heldFailure();
    const transient = heldFailure();
    f.commands.processExternalEvent
      .mockImplementationOnce(permanent.run)
      .mockImplementationOnce(transient.run);
    const first = f.job.process('intent');
    const second = f.job.process('intent');
    await Promise.all([permanent.entered, transient.entered]);
    permanent.fail(new AppError('FORBIDDEN', 'Current authority required.', 403));
    await first;

    // An authorized retry retains the immutable pending decision while
    // resetting operational fields. The old attempt observed the same count0.
    Object.assign(f.state, {
      attemptCount: 0,
      reconciliationRequired: false,
      lastErrorCode: null,
      nextAttemptAt: new Date('2026-01-01T01:00:00.000Z'),
      updatedAt: new Date(f.state.updatedAt.getTime() + 1),
    });
    const reset = { ...f.state };
    transient.fail(new Error('old retry cycle failure'));
    await second;
    expect(f.state).toEqual(reset);
  });

  it('enforces the attempt cap even when process is called outside the sweep', async () => {
    const f = fixture(8);
    await expect(f.job.process('intent')).resolves.toBe(false);
    expect(f.commands.acceptReceipt).not.toHaveBeenCalled();
    expect(f.store.updateMany).not.toHaveBeenCalled();
  });
});
