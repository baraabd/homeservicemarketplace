import { Logger } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MetricsService } from '../telemetry/metrics.service';
import type { OutboxHandler } from './outbox.handler';
import type { OutboxRepository } from './outbox.repository';
import { OutboxWorker } from './outbox.worker';

// Contract doubles only: these pin callback scheduling, not PostgreSQL atomicity.
// The companion r22-outbox-reliability integration cases verify durable rows.
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(handlers: OutboxHandler[], eventCount = 1) {
  const events = Array.from({ length: eventCount }, (_, i) => ({
    id: `event-${i}`,
    eventType: 'r22.callback',
    attempts: 0,
    maxAttempts: 8,
  })) as OutboxEvent[];
  const repo = {
    reclaimExpired: jest.fn(async () => 0),
    claimBatch: jest.fn(async () => events),
    heartbeat: jest.fn(async () => 0),
    claimHandlerRun: jest.fn(async () => true),
    completeLeased: jest.fn(async () => true),
    failLeased: jest.fn(async () => true),
    countByStatus: jest.fn(async () => ({})),
    oldestPendingAgeSeconds: jest.fn(async () => 0),
  };
  const committed: number[] = [];
  const transaction = jest.fn(async (callback: (tx: PrismaTx) => Promise<void>) => {
    await callback({} as PrismaTx);
    committed.push(committed.length + 1);
  });
  const noop = { inc: jest.fn(), set: jest.fn(), reset: jest.fn() };
  const outcomes = jest.fn();
  const metrics = {
    outboxEventsProcessedTotal: { inc: outcomes },
    outboxEventDurationSeconds: { startTimer: () => () => undefined },
    outboxQueueDepth: noop,
    outboxOldestPendingAgeSeconds: noop,
    outboxClaimedTotal: noop,
    outboxReclaimedTotal: noop,
  };
  const settings: Record<string, unknown> = {
    OUTBOX_BATCH_SIZE: 50,
    OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
    OUTBOX_DELIVERY_TX_TIMEOUT_MS: 1_000,
    OUTBOX_DELIVERY_DEADLINE_MS: 100,
    OUTBOX_RETRY_BASE_MS: 1_000,
    OUTBOX_RETRY_CAP_MS: 300_000,
  };
  const worker = new OutboxWorker(
    repo as unknown as OutboxRepository,
    { client: { $transaction: transaction } } as unknown as PrismaService,
    { get: (key: string) => settings[key] } as AppConfigService,
    metrics as unknown as MetricsService,
    handlers,
  );
  return { worker, repo, committed, transaction, outcomes };
}

function handler(name: string, afterCommit: () => Promise<void>): OutboxHandler {
  return { name, eventTypes: ['r22.callback'], handle: async () => ({ afterCommit }) };
}

describe('outbox post-commit callback isolation (contract doubles)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('bounds a hung callback and continues the claimed batch without retrying committed work', async () => {
    const gate = deferred();
    let calls = 0;
    const h = harness(
      [
        handler('r22.callback', async () => {
          expect(h.committed.length).toBeGreaterThan(0);
          if (calls++ === 0) await gate.promise;
        }),
      ],
      2,
    );
    let finished = false;
    const running = h.worker.runOnce().then(() => {
      finished = true;
    });
    try {
      await jest.advanceTimersByTimeAsync(150);
      expect(finished).toBe(true);
      expect(h.committed).toHaveLength(2);
      expect(h.repo.failLeased).not.toHaveBeenCalled();
      expect(h.outcomes.mock.calls.map(([labels]) => labels.outcome)).toEqual([
        'processed',
        'processed',
      ]);
    } finally {
      gate.resolve();
      await running;
    }
  });

  it('does not launch later callbacks after the timed-out callback eventually resolves', async () => {
    const gate = deferred();
    const later = jest.fn(async () => undefined);
    const h = harness([handler('r22.first', () => gate.promise), handler('r22.later', later)]);
    let finished = false;
    const running = h.worker.runOnce().then(() => {
      finished = true;
    });
    try {
      await jest.advanceTimersByTimeAsync(150);
      expect(finished).toBe(true);
      expect(later).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await running;
    }
    await jest.advanceTimersByTimeAsync(0);
    expect(later).not.toHaveBeenCalled();
    expect(h.repo.failLeased).not.toHaveBeenCalled();
  });

  it('observes a late rejection without requeuing the already committed event', async () => {
    const gate = deferred();
    const h = harness([handler('r22.reject', () => gate.promise)]);
    let finished = false;
    const running = h.worker.runOnce().then(() => {
      finished = true;
    });
    try {
      await jest.advanceTimersByTimeAsync(150);
      expect(finished).toBe(true);
    } finally {
      gate.reject(new Error('late transport rejection'));
      await running;
    }
    await jest.advanceTimersByTimeAsync(0);
    expect(h.repo.failLeased).not.toHaveBeenCalled();
    expect(h.committed).toHaveLength(1);
  });

  it('continues other callbacks after an immediate best-effort failure', async () => {
    const later = jest.fn(async () => undefined);
    const h = harness([
      handler('r22.failed', async () => {
        throw new Error('transport unavailable');
      }),
      handler('r22.healthy', later),
    ]);
    await h.worker.runOnce();
    expect(later).toHaveBeenCalledTimes(1);
    expect(h.repo.failLeased).not.toHaveBeenCalled();
  });

  it('never invokes a callback when the database commit rejects', async () => {
    const callback = jest.fn(async () => undefined);
    const h = harness([handler('r22.rollback', callback)]);
    h.transaction.mockImplementationOnce(async (work) => {
      await work({} as PrismaTx);
      throw new Error('commit rejected');
    });
    await h.worker.runOnce();
    expect(callback).not.toHaveBeenCalled();
    expect(h.repo.failLeased).toHaveBeenCalledTimes(1);
    expect(h.committed).toHaveLength(0);
  });

  it('shares one deadline across all callbacks for an event', async () => {
    const invoked: string[] = [];
    const slow = (name: string) =>
      handler(name, async () => {
        invoked.push(name);
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
      });
    const h = harness([slow('r22.one'), slow('r22.two'), slow('r22.three')]);
    let finished = false;
    const running = h.worker.runOnce().then(() => {
      finished = true;
    });
    try {
      await jest.advanceTimersByTimeAsync(110);
      expect(finished).toBe(true);
      expect(invoked).toEqual(['r22.one', 'r22.two']);
    } finally {
      await jest.advanceTimersByTimeAsync(300);
      await running;
    }
    expect(invoked).toEqual(['r22.one', 'r22.two']);
    expect(h.repo.failLeased).not.toHaveBeenCalled();
  });
});
