import { fixture } from '../../../../../test/support/r29-stripe.fixture';
import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { MoneyCommandService } from '../../application/money-command.service';
import { StripeSandboxConfiguration } from '../../adapters/stripe/stripe-sandbox.config';
import { StripeInboxJob } from './stripe-inbox.job';
describe('R29 durable inbox restart and replica behavior', () => {
  function setup() {
    const f = fixture();
    const findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const processExternalEvent = jest.fn().mockResolvedValue({});
    const prisma = { client: { moneyExternalEvent: { findMany } } } as unknown as PrismaService;
    const commands = { processExternalEvent } as unknown as MoneyCommandService;
    return {
      ...f,
      findMany,
      processExternalEvent,
      prisma,
      commands,
      job: new StripeInboxJob(prisma, commands, f.config),
    };
  }
  it('does nothing while disabled', async () => {
    const f = setup();
    expect(
      await new StripeInboxJob(f.prisma, f.commands, new StripeSandboxConfiguration()).runBatch(),
    ).toEqual({ processed: 0, pending: 0 });
    expect(f.findMany).not.toHaveBeenCalled();
  });
  it('processes only scoped received events and retains activation failures', async () => {
    const f = setup();
    f.processExternalEvent.mockRejectedValueOnce(new Error('activation unavailable'));
    expect(await f.job.runBatch()).toEqual({ processed: 1, pending: 1 });
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'RECEIVED',
          adapterId: 'hsm.stripe.v1',
          mode: 'SANDBOX',
          accountReference: 'acct_fixture',
        }),
        take: 25,
      }),
    );
  });
  it('resumes persisted events after worker restart', async () => {
    const f = setup();
    f.processExternalEvent.mockRejectedValueOnce(new Error('crash'));
    await f.job.runBatch();
    const restart = new StripeInboxJob(f.prisma, f.commands, f.config);
    expect(await restart.runBatch()).toEqual({ processed: 2, pending: 0 });
  });
  it('allows replicas to call the existing transaction arbiter without claiming a new ledger authority', async () => {
    const f = setup();
    const other = new StripeInboxJob(f.prisma, f.commands, f.config);
    await Promise.all([f.job.runBatch(), other.runBatch()]);
    expect(f.processExternalEvent).toHaveBeenCalledTimes(4);
  });
  it('does not overlap calls in one worker and releases the guard after DB failure', async () => {
    const f = setup();
    f.findMany.mockRejectedValueOnce(new Error('db'));
    await expect(f.job.runBatch()).rejects.toThrow();
    await Promise.all([f.job.runBatch(), f.job.runBatch()]);
    expect(f.findMany).toHaveBeenCalledTimes(2);
  });
  it('pages past poison rows instead of permanently starving later evidence', async () => {
    const f = setup();
    f.findMany.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({ id: `row${String(i).padStart(2, '0')}` })),
    );
    f.processExternalEvent.mockRejectedValue(new Error('blocked'));
    await f.job.runBatch();
    await f.job.runBatch();
    expect(f.findMany.mock.calls[1]![0].where.id).toEqual({ gt: 'row24' });
    await f.job.runBatch();
    expect(f.findMany.mock.calls[2]![0].where.id).toBeUndefined();
  });
});
