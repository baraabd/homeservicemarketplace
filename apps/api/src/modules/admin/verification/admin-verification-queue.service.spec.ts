import { AdminVerificationQueueService } from './admin-verification-queue.service';

// Sprint 9B.6 — the reviewer's work list.
//
// A queue, not a table dump. What it is tested for is the behaviour that makes
// it usable and safe rather than the SQL:
//
//   - OLDEST FIRST, because a queue ordered newest-first starves the people who
//     have waited longest, and that is the whole failure mode of a review
//     backlog
//   - the DEFAULT is the live cases; a reviewer opening the queue wants work,
//     not a museum of everything that ever happened
//   - actions are per-row and server-computed, with self-review already removed
//   - filters narrow, search never widens
//   - the page size is clamped, and the cursor cannot be used to read sideways

const REVIEWER = 'user-reviewer';

interface Row {
  id: string;
  providerProfileId: string;
  state: string;
  policyVersion: string;
  country: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  assignedToUserId: string | null;
  providerProfile: { displayName: string | null; userId: string | null };
  _count: { documents: number };
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'case-1',
    providerProfileId: 'pp-1',
    state: 'SUBMITTED',
    policyVersion: 'p1',
    country: 'SY',
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    assignedToUserId: null,
    providerProfile: { displayName: 'Ahmad Plumbing', userId: 'user-provider' },
    _count: { documents: 2 },
    ...over,
  };
}

function harness(rows: Row[] = [row()]) {
  const queries: Array<Record<string, unknown>> = [];
  const client = {
    verificationCase: {
      findMany: jest.fn(async (args: Record<string, unknown>) => {
        queries.push(args);
        return rows;
      }),
    },
  };
  const service = new AdminVerificationQueueService({ client } as never);
  return { service, queries, client };
}

const lastQuery = (h: ReturnType<typeof harness>) =>
  h.queries[h.queries.length - 1] as {
    where: Record<string, unknown>;
    orderBy: unknown;
    take: number;
    cursor?: unknown;
    skip?: number;
  };

describe('what the queue shows by default', () => {
  it('lists the LIVE cases, not everything that ever happened', async () => {
    const h = harness();
    await h.service.list({}, REVIEWER);

    const where = lastQuery(h).where as { state?: { in?: string[] } };
    expect(where.state?.in?.sort()).toEqual(['ACTION_REQUIRED', 'IN_REVIEW', 'SUBMITTED']);
  });

  it('orders oldest first, so nobody starves at the back of the queue', async () => {
    const h = harness();
    await h.service.list({}, REVIEWER);
    expect(lastQuery(h).orderBy).toEqual([{ submittedAt: 'asc' }, { id: 'asc' }]);
  });

  it('returns the fields a reviewer triages on', async () => {
    const h = harness();
    const out = await h.service.list({}, REVIEWER);

    expect(out.items[0]).toMatchObject({
      id: 'case-1',
      providerProfileId: 'pp-1',
      providerDisplayName: 'Ahmad Plumbing',
      state: 'SUBMITTED',
      policyVersion: 'p1',
      documentCount: 2,
    });
  });

  it('computes the actions per row, from the canonical resolver', async () => {
    const h = harness();
    const out = await h.service.list({}, REVIEWER);

    expect(out.items[0].availableActions).toEqual(
      expect.arrayContaining(['assign', 'requestAction', 'reject']),
    );
    expect(out.items[0].availableActions).not.toContain('approve');
  });

  it('offers nothing on a row the reviewer is the subject of', async () => {
    // Self-review is removed HERE too, not only at the mutation. A queue that
    // shows buttons it will refuse teaches people to click and hope.
    const h = harness([row({ providerProfile: { displayName: 'Me', userId: REVIEWER } })]);
    const out = await h.service.list({}, REVIEWER);

    expect(out.items[0].availableActions).toEqual([]);
    expect(out.items[0].blockedReason).toBe('SELF_REVIEW');
  });
});

describe('filters narrow, and only narrow', () => {
  it('filters to one state when asked', async () => {
    const h = harness();
    await h.service.list({ state: 'IN_REVIEW' }, REVIEWER);
    expect((lastQuery(h).where as { state?: unknown }).state).toEqual('IN_REVIEW');
  });

  it('refuses a state outside the enum rather than ignoring it', async () => {
    // Silently ignoring an unknown filter shows the reviewer a list that does
    // not match what they asked for, which is worse than an error.
    const h = harness();
    await expect(h.service.list({ state: 'NONSENSE' as never }, REVIEWER)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('filters by policy version', async () => {
    const h = harness();
    await h.service.list({ policyVersion: '2026.01-sy-v3' }, REVIEWER);
    expect((lastQuery(h).where as { policyVersion?: unknown }).policyVersion).toBe('2026.01-sy-v3');
  });

  it('searches the provider name case-insensitively', async () => {
    const h = harness();
    await h.service.list({ search: 'ahmad' }, REVIEWER);

    const where = lastQuery(h).where as { providerProfile?: { displayName?: unknown } };
    expect(where.providerProfile?.displayName).toMatchObject({
      contains: 'ahmad',
      mode: 'insensitive',
    });
  });

  it('keeps the state filter while searching, so search cannot widen the queue', async () => {
    const h = harness();
    await h.service.list({ search: 'ahmad' }, REVIEWER);
    const where = lastQuery(h).where as { state?: { in?: string[] } };
    expect(where.state?.in).toBeDefined();
  });

  it('ignores a blank search rather than matching everything', async () => {
    const h = harness();
    await h.service.list({ search: '   ' }, REVIEWER);
    expect((lastQuery(h).where as { providerProfile?: unknown }).providerProfile).toBeUndefined();
  });
});

describe('paging', () => {
  it('clamps the page size', async () => {
    const h = harness();
    await h.service.list({ limit: 10_000 }, REVIEWER);
    // take is limit+1, the extra row being how "is there a next page" is known
    // without a second count query.
    expect(lastQuery(h).take).toBeLessThanOrEqual(101);
  });

  it('refuses a nonsensical page size instead of guessing', async () => {
    const h = harness();
    await expect(h.service.list({ limit: 0 }, REVIEWER)).rejects.toMatchObject({ status: 400 });
    await expect(h.service.list({ limit: -5 }, REVIEWER)).rejects.toMatchObject({ status: 400 });
  });

  it('reports no next page when the results fit', async () => {
    const h = harness([row({ id: 'a' }), row({ id: 'b' })]);
    const out = await h.service.list({ limit: 5 }, REVIEWER);
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
  });

  it('trims the lookahead row and hands back a cursor', async () => {
    const h = harness([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const out = await h.service.list({ limit: 2 }, REVIEWER);

    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });

  it('continues from a cursor without re-reading the row it points at', async () => {
    const h = harness();
    await h.service.list({ cursor: 'case-1' }, REVIEWER);
    const q = lastQuery(h);
    expect(q.cursor).toEqual({ id: 'case-1' });
    expect(q.skip).toBe(1);
  });
});

describe('what it does not do', () => {
  it('never selects evidence keys, filenames or hashes', async () => {
    // The queue is a list. Anything that identifies a DOCUMENT belongs behind
    // the audited read route, not in a page a reviewer leaves open all day.
    const h = harness();
    await h.service.list({}, REVIEWER);
    const text = JSON.stringify(h.queries[0]);
    expect(text).not.toMatch(/storageKey|sha256|originalFilename/);
  });

  it('returns an empty page rather than failing when nothing is waiting', async () => {
    const h = harness([]);
    const out = await h.service.list({}, REVIEWER);
    expect(out).toEqual({ items: [], nextCursor: null });
  });
});
