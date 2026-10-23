import { RefundOutboxConsumer } from './refund-outbox.consumer';
import { REFUND_DISPATCH_EVENT } from '../refunds/refund-orchestrator.service';

function harness() {
  const deliver = jest.fn().mockResolvedValue(undefined);
  const tx = {
    moneyDispatch: {
      findUnique: jest.fn().mockResolvedValue({ kind: 'REFUND', status: 'NOT_DISPATCHED' }),
    },
    moneyCommand: {
      findUnique: jest.fn().mockResolvedValue({
        actorUserId: 'admin-a',
        action: 'RESERVE_REFUND',
        response: { value: { id: 'refund-a' } },
      }),
    },
  };
  const event = {
    eventType: REFUND_DISPATCH_EVENT,
    aggregateType: 'MoneyRefund',
    aggregateId: 'refund-a',
    payload: { refundId: 'refund-a', commandId: 'command-a' },
  };
  return { consumer: new RefundOutboxConsumer({ deliver } as never), deliver, tx, event };
}

describe('R32 identifiers-only outbox consumer', () => {
  it('reads durable authority in tx and performs no provider I/O before commit', async () => {
    const h = harness();
    const result = await h.consumer.handle(h.event as never, h.tx as never);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.tx.moneyDispatch.findUnique).toHaveBeenCalledWith({ where: { refundId: 'refund-a' } });
    await result.afterCommit?.();
    expect(h.deliver).toHaveBeenCalledWith('refund-a', 'command-a');
  });

  it.each([
    null,
    [],
    {},
    { refundId: 'refund-a', commandId: 'command-a', amountMinor: '100' },
    { refundId: 'refund-a', commandId: 'other/command' },
  ])('rejects malformed or authority-bearing payload %j', async (payload) => {
    const h = harness();
    await expect(
      h.consumer.handle({ ...h.event, payload } as never, h.tx as never),
    ).rejects.toThrow('Invalid refund delivery intent');
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('rejects wrong aggregate scope before delivery', async () => {
    const h = harness();
    await expect(
      h.consumer.handle({ ...h.event, aggregateId: 'another-refund' } as never, h.tx as never),
    ).rejects.toThrow('Invalid refund delivery intent');
  });

  it('refuses an unrelated command even if the payload names a real refund', async () => {
    const h = harness();
    h.tx.moneyCommand.findUnique.mockResolvedValue({
      actorUserId: 'admin-a',
      action: 'RESERVE_REFUND',
      response: { value: { id: 'other-refund' } },
    });
    await expect(h.consumer.handle(h.event as never, h.tx as never)).rejects.toThrow(
      'authority is inconsistent',
    );
  });

  it('skips a terminal dispatch without sending another operation', async () => {
    const h = harness();
    h.tx.moneyDispatch.findUnique.mockResolvedValue({ kind: 'REFUND', status: 'SUCCEEDED' });
    const result = await h.consumer.handle(h.event as never, h.tx as never);
    expect(result.afterCommit).toBeUndefined();
    expect(result.stats).toEqual({ terminal: 1 });
    expect(h.deliver).not.toHaveBeenCalled();
  });
});
