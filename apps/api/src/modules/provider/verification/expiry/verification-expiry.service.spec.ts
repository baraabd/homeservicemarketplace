import { VerificationExpiryService } from './verification-expiry.service';

// Sprint 9B.7 — the SYSTEM expiry sweep.
//
// The clock is injected, so every boundary is asserted exactly rather than
// approximately. Nothing here sleeps, and nothing mocks Date globally — a test
// that moves the global clock changes the behaviour of every other module
// sharing its worker.

const NOW = new Date('2026-06-01T12:00:00.000Z');

function harness(
  options: {
    due?: Array<{ caseId: string | null }>;
    /** caseId -> what expireCase does for it. */
    outcomes?: Record<string, { changed: boolean } | Error>;
  } = {},
) {
  // The parameter is declared so the assertions below can read back the query
  // that was issued. Without it Jest types `mock.calls[0]` as a zero-length
  // tuple and every `calls[0][0]` is a compile error.
  type FindManyArgs = {
    where: Record<string, unknown>;
    orderBy: unknown;
    take: number;
  };
  const findMany = jest.fn(async (_args: FindManyArgs) => options.due ?? []);
  const prisma = { client: { providerWorkAccessGrant: { findMany } } };

  const expireCase = jest.fn(async (caseId: string) => {
    const out = options.outcomes?.[caseId] ?? { changed: true };
    if (out instanceof Error) throw out;
    return { caseId, state: 'EXPIRED', changed: out.changed, availableActions: [] };
  });

  const service = new VerificationExpiryService(prisma as never, { expireCase } as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).log = { log: jest.fn(), warn: jest.fn() };
  return { service, findMany, expireCase };
}

describe('selection', () => {
  it('asks only for ACTIVE, unrevoked grants whose window has closed', async () => {
    const h = harness();
    await h.service.runOnce({ now: NOW });

    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          revokedAt: null,
          expiresAt: { not: null, lte: NOW },
        }),
      }),
    );
  });

  it('only considers grants whose case is still VERIFIED', async () => {
    // A case already REJECTED or EXPIRED has no lifecycle left to close, and
    // re-deciding it would write a second decision for one event.
    const h = harness();
    await h.service.runOnce({ now: NOW });

    const where = h.findMany.mock.calls[0][0].where;
    expect(where.case).toEqual({ is: { state: 'VERIFIED' } });
  });

  it('drains oldest-expiry-first', async () => {
    // The provider who has been wrongly shown as verified longest is corrected
    // first, and a backlog drains in the order it accumulated.
    const h = harness();
    await h.service.runOnce({ now: NOW });

    expect(h.findMany.mock.calls[0][0].orderBy).toEqual([{ expiresAt: 'asc' }, { id: 'asc' }]);
  });

  it('uses the injected clock, not the wall clock', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const h = harness();
    await h.service.runOnce({ now: past });

    expect(h.findMany.mock.calls[0][0].where.expiresAt).toEqual({ not: null, lte: past });
  });
});

describe('batching is bounded', () => {
  it('defaults to 100 cases per pass', async () => {
    const h = harness();
    await h.service.runOnce({ now: NOW });
    expect(h.findMany.mock.calls[0][0].take).toBe(100);
  });

  it('honours a smaller explicit limit', async () => {
    const h = harness();
    await h.service.runOnce({ now: NOW, limit: 5 });
    expect(h.findMany.mock.calls[0][0].take).toBe(5);
  });

  it('caps an absurd limit rather than trusting it', async () => {
    // An unbounded pass would hold a connection for minutes on the first boot
    // after a long outage.
    const h = harness();
    await h.service.runOnce({ now: NOW, limit: 10_000 });
    expect(h.findMany.mock.calls[0][0].take).toBe(500);
  });

  it('floors a zero limit at one rather than sweeping nothing forever', async () => {
    const h = harness();
    await h.service.runOnce({ now: NOW, limit: 0 });
    expect(h.findMany.mock.calls[0][0].take).toBe(1);
  });
});

describe('expiring the due cases', () => {
  it('expires each due case exactly once', async () => {
    const h = harness({ due: [{ caseId: 'c1' }, { caseId: 'c2' }] });
    const out = await h.service.runOnce({ now: NOW });

    expect(h.expireCase).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ scanned: 2, expired: 2, alreadyDone: 0, failed: 0 });
  });

  it('passes the injected instant through to the command', async () => {
    // The decision instant recorded on the case must be the sweep's instant,
    // not a second clock read inside the command.
    const h = harness({ due: [{ caseId: 'c1' }] });
    await h.service.runOnce({ now: NOW });
    expect(h.expireCase).toHaveBeenCalledWith('c1', NOW);
  });

  it('de-duplicates two grants pointing at the same case', async () => {
    // Expiring one case twice would attempt two decisions for one event.
    const h = harness({ due: [{ caseId: 'c1' }, { caseId: 'c1' }] });
    const out = await h.service.runOnce({ now: NOW });

    expect(h.expireCase).toHaveBeenCalledTimes(1);
    expect(out.scanned).toBe(1);
  });

  it('ignores a grant with no case behind it', async () => {
    // MANUAL_OVERRIDE and LEGACY_BACKFILL rows carry no caseId. They are
    // already denied at read time; there is no case to transition and no
    // decision to record, and inventing one would fabricate a judgement.
    const h = harness({ due: [{ caseId: null }, { caseId: 'c1' }] });
    const out = await h.service.runOnce({ now: NOW });

    expect(h.expireCase).toHaveBeenCalledTimes(1);
    expect(h.expireCase).toHaveBeenCalledWith('c1', NOW);
    expect(out.scanned).toBe(1);
  });

  it('does nothing at all when nothing is due', async () => {
    const h = harness({ due: [] });
    const out = await h.service.runOnce({ now: NOW });

    expect(h.expireCase).not.toHaveBeenCalled();
    expect(out).toMatchObject({ scanned: 0, expired: 0, failed: 0 });
  });
});

describe('two workers sweeping at once', () => {
  it('counts a case another worker already took as alreadyDone, not a failure', async () => {
    // Selection is not a claim: both workers may see the same row. The
    // conditional update inside expireCase lets exactly one write, and the
    // loser replays with changed:false. Treating that as an error would make a
    // correctly-handled race look like an incident.
    const h = harness({
      due: [{ caseId: 'c1' }, { caseId: 'c2' }],
      outcomes: { c1: { changed: false } },
    });
    const out = await h.service.runOnce({ now: NOW });

    expect(out).toMatchObject({ scanned: 2, expired: 1, alreadyDone: 1, failed: 0 });
  });

  it('reports every case as alreadyDone when it lost every race', async () => {
    const h = harness({
      due: [{ caseId: 'c1' }, { caseId: 'c2' }],
      outcomes: { c1: { changed: false }, c2: { changed: false } },
    });
    const out = await h.service.runOnce({ now: NOW });

    expect(out).toMatchObject({ expired: 0, alreadyDone: 2, failed: 0 });
  });
});

describe('one bad case does not strand the batch', () => {
  it('continues past a failure and still expires the rest', async () => {
    // A sweep that aborted on the first error would never reach the cases
    // behind it, and the same case would block the queue on every pass.
    const h = harness({
      due: [{ caseId: 'c1' }, { caseId: 'c2' }, { caseId: 'c3' }],
      outcomes: { c2: new Error('boom') },
    });
    const out = await h.service.runOnce({ now: NOW });

    expect(h.expireCase).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ scanned: 3, expired: 2, failed: 1 });
  });

  it('leaves a failed case due, so the next pass retries it', async () => {
    // Nothing marks it done: the grant is still ACTIVE and still lapsed, so
    // the next selection picks it up again.
    const h = harness({ due: [{ caseId: 'c1' }], outcomes: { c1: new Error('boom') } });
    const out = await h.service.runOnce({ now: NOW });

    expect(out.expired).toBe(0);
    expect(out.failed).toBe(1);
  });
});
