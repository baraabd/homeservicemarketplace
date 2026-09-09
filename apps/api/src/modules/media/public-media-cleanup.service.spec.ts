import { PublicMediaCleanupService } from './public-media-cleanup.service';

// Sprint 09B.29 Phase 4 — the public-media sweep, one case per property.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.3
//
// The properties that matter here are not "does it delete things". They are
// the ones that decide whether a retention record can be trusted:
//
//   ORDER        the object goes first; `deletedAt` is written only after
//                storage confirmed absence
//   HONESTY      a storage failure leaves NO deletion record, and leaves the
//                row eligible for the next pass
//   SCOPE        RESTRICTED evidence is never a candidate, and nothing outside
//                the eligibility window is touched
//   CONCURRENCY  two workers on one asset produce one record, not two
//   PATIENCE     a reservation that might still be uploading is left alone

type Asset = {
  id: string;
  storageKey: string;
  visibility: 'PUBLIC' | 'RESTRICTED';
  deletedAt: Date | null;
  retainUntil: Date | null;
  uploadCompletedAt: Date | null;
  uploadExpiresAt: Date | null;
  createdAt: Date;
};

const NOW = new Date('2026-09-09T12:00:00.000Z');
const GRACE_MS = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: `a-${Math.random().toString(36).slice(2, 8)}`,
    storageKey: 'avatars/ref/one.jpg',
    visibility: 'PUBLIC',
    deletedAt: null,
    retainUntil: null,
    uploadCompletedAt: new Date('2026-09-01T00:00:00.000Z'),
    uploadExpiresAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  };
}

/**
 * A fake that applies the SAME predicate the service asks Prisma for, rather
 * than returning a canned list.
 *
 * A canned list would make every eligibility test vacuous: the service could
 * ask for anything at all and the test would still pass. Evaluating the real
 * `where` is what lets "an active asset is never swept" mean something.
 */
function harness(rows: Asset[], storage?: { deleteObject?: jest.Mock }) {
  const deleteObject = storage?.deleteObject ?? jest.fn().mockResolvedValue(undefined);
  const claimed: string[] = [];

  // EVERY condition is read out of the `where` the service actually passed.
  //
  // Nothing here may hard-code a filter the service is responsible for
  // specifying. An earlier version of this fake enforced `deletedAt === null`
  // and the PUBLIC scope on its own, which made those assertions vacuous:
  // mutation testing removed both from the service and all thirteen tests
  // still passed. The fake was doing the work the code was being credited for.
  const eligible = (where: Record<string, unknown>, take?: number) => {
    const or = where.OR as Array<Record<string, { lte?: Date }>> | undefined;
    const now = or?.[0]?.retainUntil?.lte;
    const abandonedCutoff = or?.[1]?.uploadExpiresAt?.lte;
    const wantsVisibility = 'visibility' in where ? where.visibility : undefined;
    const wantsUndeleted = 'deletedAt' in where && where.deletedAt === null;

    return rows
      .filter((r) => {
        if (wantsVisibility !== undefined && r.visibility !== wantsVisibility) return false;
        if (wantsUndeleted && r.deletedAt !== null) return false;
        if (!or) return true;
        const retired = now !== undefined && r.retainUntil !== null && r.retainUntil <= now;
        const abandoned =
          abandonedCutoff !== undefined &&
          r.uploadCompletedAt === null &&
          r.uploadExpiresAt !== null &&
          r.uploadExpiresAt <= abandonedCutoff;
        return retired || abandoned;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, take ?? rows.length);
  };

  const prisma = {
    client: {
      mediaAsset: {
        findMany: jest.fn(async (args: { where: Record<string, unknown>; take?: number }) =>
          eligible(args.where, args.take).map((r) => ({ id: r.id, storageKey: r.storageKey })),
        ),
        updateMany: jest.fn(
          async (args: { where: { id: string; deletedAt?: null }; data: { deletedAt: Date } }) => {
            const row = rows.find((r) => r.id === args.where.id);
            if (!row) return { count: 0 };
            // The conditional claim is honoured ONLY if the service asked for
            // it. If the service stops sending `deletedAt: null`, this fake
            // stops enforcing it and the concurrency test fails — which is the
            // point. A fake that always enforces the condition proves the
            // fake, not the code.
            const conditional = 'deletedAt' in args.where && args.where.deletedAt === null;
            if (conditional && row.deletedAt !== null) return { count: 0 };
            row.deletedAt = args.data.deletedAt;
            claimed.push(row.id);
            return { count: 1 };
          },
        ),
      },
    },
  };

  const service = new PublicMediaCleanupService(prisma as never, { deleteObject } as never);
  return { service, prisma, deleteObject, claimed, rows };
}

const sweep = (h: ReturnType<typeof harness>, limit = 50) =>
  h.service.sweep({ limit, reservationGraceMs: GRACE_MS, now: NOW });

describe('PublicMediaCleanupService — what is eligible', () => {
  it('retires an asset the provider asked to remove', async () => {
    const h = harness([asset({ id: 'removed', retainUntil: ago(1000) })]);
    const result = await sweep(h);

    expect(h.deleteObject).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ examined: 1, deleted: 1, raced: 0, failed: 0 });
  });

  it('NEVER sweeps an active asset', async () => {
    // Attached, not retired. This is every avatar and portfolio image in use.
    const h = harness([asset({ id: 'active' })]);
    const result = await sweep(h);

    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(result.examined).toBe(0);
  });

  it('leaves a recent unfinished reservation alone, because it may still be uploading', async () => {
    const h = harness([
      asset({
        id: 'in-flight',
        uploadCompletedAt: null,
        // Expired as a presign, but well inside the grace period.
        uploadExpiresAt: ago(60_000),
      }),
    ]);
    const result = await sweep(h);

    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(result.examined).toBe(0);
  });

  it('eventually deletes a reservation nobody ever came back for', async () => {
    const h = harness([
      asset({
        id: 'abandoned',
        uploadCompletedAt: null,
        uploadExpiresAt: ago(GRACE_MS + 60_000),
      }),
    ]);
    const result = await sweep(h);

    expect(h.deleteObject).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(1);
  });

  it('never considers RESTRICTED evidence, whatever its retention says', async () => {
    // The mirror of the scope the evidence sweep applies in the other
    // direction. A mis-linked row must not let a public sweep reach identity
    // documents.
    const h = harness([
      asset({ id: 'evidence', visibility: 'RESTRICTED', retainUntil: ago(1000) }),
    ]);
    const result = await sweep(h);

    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(result.examined).toBe(0);
  });

  it('never re-examines something already recorded as gone', async () => {
    const h = harness([asset({ id: 'done', retainUntil: ago(1000), deletedAt: ago(500) })]);
    const result = await sweep(h);

    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(result.examined).toBe(0);
  });

  it('bounds the batch', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      asset({ id: `r-${i}`, retainUntil: ago(1000) }),
    );
    const h = harness(many);
    const result = await sweep(h, 3);

    expect(result.examined).toBe(3);
    expect(h.deleteObject).toHaveBeenCalledTimes(3);
  });
});

describe('PublicMediaCleanupService — order, honesty and retry', () => {
  it('writes deletedAt only AFTER storage confirmed the object is gone', async () => {
    const order: string[] = [];
    const deleteObject = jest.fn(async () => {
      order.push('storage-delete');
    });
    const h = harness([asset({ id: 'ordered', retainUntil: ago(1000) })], { deleteObject });
    h.prisma.client.mediaAsset.updateMany.mockImplementation(
      async (args: { where: { id: string; deletedAt?: null }; data: { deletedAt: Date } }) => {
        order.push('db-mark');
        const row = h.rows.find((r) => r.id === args.where.id)!;
        row.deletedAt = args.data.deletedAt;
        return { count: 1 };
      },
    );

    await sweep(h);

    // The other order trades a harmless repeated delete for a row that lies.
    expect(order).toEqual(['storage-delete', 'db-mark']);
  });

  it('a storage failure records NOTHING and leaves the row eligible', async () => {
    const deleteObject = jest.fn().mockRejectedValue(new Error('AccessDenied'));
    const h = harness([asset({ id: 'denied', retainUntil: ago(1000) })], { deleteObject });

    const first = await sweep(h);
    expect(first).toMatchObject({ examined: 1, deleted: 0, failed: 1 });
    // The critical assertion: no deletion record for bytes that are still
    // there. A bucket policy forbidding deletion must not become a database
    // claim that the photo is gone.
    expect(h.rows[0].deletedAt).toBeNull();
    expect(h.prisma.client.mediaAsset.updateMany).not.toHaveBeenCalled();

    // And the retry mechanism is simply the next pass — no dead-letter state.
    deleteObject.mockResolvedValue(undefined);
    const second = await sweep(h);
    expect(second).toMatchObject({ examined: 1, deleted: 1, failed: 0 });
    expect(h.rows[0].deletedAt).not.toBeNull();
  });

  it('deleting an already-absent object is success, not a failure', async () => {
    // The port promises this, and the delete-then-record order depends on it:
    // a crash between the two steps leaves exactly this state.
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const h = harness([asset({ id: 'absent', retainUntil: ago(1000) })], { deleteObject });

    const result = await sweep(h);
    expect(result).toMatchObject({ deleted: 1, failed: 0 });
  });

  it('is idempotent across repeated passes', async () => {
    const h = harness([asset({ id: 'twice', retainUntil: ago(1000) })]);

    const first = await sweep(h);
    const second = await sweep(h);
    const third = await sweep(h);

    expect(first.deleted).toBe(1);
    // Already recorded, so no longer a candidate — one delete in total, and no
    // second record.
    expect(second).toMatchObject({ examined: 0, deleted: 0 });
    expect(third).toMatchObject({ examined: 0, deleted: 0 });
    expect(h.deleteObject).toHaveBeenCalledTimes(1);
    expect(h.claimed).toEqual(['twice']);
  });

  it('two workers on one asset produce ONE record, and the loser says so', async () => {
    const h = harness([asset({ id: 'contended', retainUntil: ago(1000) })]);

    // Both select it — selection is not a claim — and both delete the object,
    // which is safe because the delete is idempotent. Only the conditional
    // write can succeed once.
    const [a, b] = await Promise.all([sweep(h), sweep(h)]);

    const deleted = a.deleted + b.deleted;
    const raced = a.raced + b.raced;
    expect(deleted).toBe(1);
    expect(raced).toBe(1);
    expect(h.claimed).toEqual(['contended']);
  });

  it('one failing asset does not stop the rest of the batch', async () => {
    const deleteObject = jest
      .fn()
      .mockRejectedValueOnce(new Error('transport'))
      .mockResolvedValue(undefined);
    const h = harness(
      [
        asset({ id: 'first', retainUntil: ago(2000), createdAt: ago(2000) }),
        asset({ id: 'second', retainUntil: ago(1000), createdAt: ago(1000) }),
      ],
      { deleteObject },
    );

    const result = await sweep(h);
    expect(result).toMatchObject({ examined: 2, deleted: 1, failed: 1 });
    expect(h.claimed).toEqual(['second']);
  });
});
