import { TransactionRunner } from './transaction.runner';
import type { PrismaService } from './prisma.service';

describe('TransactionRunner', () => {
  it('delegates to PrismaClient.$transaction with the function and options', async () => {
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      fn({ tag: 'tx' }),
    );
    const prisma = { client: { $transaction } } as unknown as PrismaService;
    const runner = new TransactionRunner(prisma);

    // tx is typed as Prisma.TransactionClient; route through unknown to
    // assert against our test-only `{ tag }` shape without TS narrowing.
    const result = await runner.run(async (tx) => `ok:${(tx as unknown as { tag: string }).tag}`, {
      timeout: 1234,
    });

    expect(result).toBe('ok:tx');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ timeout: 1234 });
  });

  it('propagates errors thrown inside the transaction callback', async () => {
    // Two-arg signature so `$transaction.mock.calls[0][1]` is well-typed
    // (Prisma's $transaction takes options as its second argument).
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      fn({}),
    );
    const prisma = { client: { $transaction } } as unknown as PrismaService;
    const runner = new TransactionRunner(prisma);

    await expect(
      runner.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('propagates a rejected $transaction (simulated rollback) as-is', async () => {
    const $transaction = jest.fn().mockRejectedValue(new Error('rollback'));
    const prisma = { client: { $transaction } } as unknown as PrismaService;
    const runner = new TransactionRunner(prisma);

    await expect(runner.run(async () => 'unreached')).rejects.toThrow('rollback');
  });

  it('forwards every option (isolationLevel, maxWait, timeout) to $transaction', async () => {
    // Two-arg signature so `$transaction.mock.calls[0][1]` is well-typed
    // (Prisma's $transaction takes options as its second argument).
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      fn({}),
    );
    const prisma = { client: { $transaction } } as unknown as PrismaService;
    const runner = new TransactionRunner(prisma);

    await runner.run(async () => undefined, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    });

    expect($transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    });
  });

  it('passes undefined options through rather than substituting defaults', async () => {
    // Two-arg signature so `$transaction.mock.calls[0][1]` is well-typed
    // (Prisma's $transaction takes options as its second argument).
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      fn({}),
    );
    const prisma = { client: { $transaction } } as unknown as PrismaService;
    const runner = new TransactionRunner(prisma);

    await runner.run(async () => undefined);

    expect($transaction.mock.calls[0][1]).toBeUndefined();
  });
});
