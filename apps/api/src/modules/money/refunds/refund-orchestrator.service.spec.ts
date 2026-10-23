import { RefundOrchestratorService } from './refund-orchestrator.service';

function harness(enabled = false) {
  const findMany = jest.fn().mockResolvedValue([]);
  const deliverRefund = jest.fn().mockResolvedValue(undefined);
  const config = { get: jest.fn().mockReturnValue(enabled) };
  const service = new RefundOrchestratorService(
    { client: { moneyDispatch: { findMany } } } as never,
    { deliverRefund } as never,
    config as never,
  );
  return { service, findMany, deliverRefund, config };
}

describe('R32 durable refund recovery scanner', () => {
  afterEach(() => jest.useRealTimers());

  it('does not start background delivery while the outbox worker is disabled', async () => {
    jest.useFakeTimers();
    const h = harness();
    h.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(h.findMany).not.toHaveBeenCalled();
    await h.service.onModuleDestroy();
  });

  it.each([0, -1, 26, 1.2, NaN])(
    'rejects unbounded batch size %s before any read',
    async (size) => {
      const h = harness();
      await expect(h.service.recoverBatch(size)).rejects.toMatchObject({ status: 400 });
      expect(h.findMany).not.toHaveBeenCalled();
    },
  );

  it('bounds lookup and attempts only unresolved, available refund dispatches', async () => {
    const h = harness();
    h.findMany.mockResolvedValue([{ id: 'a', refundId: 'refund-a' }]);
    await expect(h.service.recoverBatch(3)).resolves.toEqual({
      inspected: 1,
      attempted: 1,
      blocked: 0,
    });
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'REFUND',
          status: { in: ['NOT_DISPATCHED', 'PENDING', 'UNKNOWN'] },
        }),
        take: 3,
        select: { id: true, refundId: true },
      }),
    );
    expect(h.deliverRefund).toHaveBeenCalledWith('refund-a', undefined);
  });

  it('continues past blocked oldest rows and resets a completed scan', async () => {
    const h = harness();
    h.findMany
      .mockResolvedValueOnce([{ id: 'a', refundId: 'refund-a' }])
      .mockResolvedValueOnce([{ id: 'b', refundId: 'refund-b' }])
      .mockResolvedValueOnce([]);
    h.deliverRefund.mockRejectedValueOnce(new Error('private provider diagnostic'));
    await expect(h.service.recoverBatch(1)).resolves.toMatchObject({ blocked: 1 });
    await expect(h.service.recoverBatch(1)).resolves.toMatchObject({ attempted: 1 });
    expect(h.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'a' });
    await h.service.recoverBatch(1);
    await h.service.recoverBatch(1);
    expect(h.findMany.mock.calls[3][0].where.id).toBeUndefined();
  });

  it('recovers a committed intent even when no outbox callback was invoked', async () => {
    const h = harness();
    h.findMany.mockResolvedValue([{ id: 'dispatch-a', refundId: 'refund-a' }]);
    await h.service.recoverBatch();
    expect(h.deliverRefund).toHaveBeenCalledTimes(1);
    expect(h.deliverRefund).toHaveBeenCalledWith('refund-a', undefined);
  });

  it('cannot continue delivery after shutdown', async () => {
    const h = harness();
    h.findMany.mockResolvedValue([{ id: 'a', refundId: 'refund-a' }]);
    await h.service.onModuleDestroy();
    await h.service.recoverBatch();
    expect(h.deliverRefund).not.toHaveBeenCalled();
  });
});
