import { PublicMediaLedgerService, RESERVATION_TTL_MS } from './public-media-ledger.service';

// Sprint 09B.29 Phase 4 — the reservation ledger, one case per property.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.3 (O-1…O-4)
//
// This service is the only thing standing between "the server minted a key"
// and "the client says this key is mine". The properties under test are
// therefore authorization properties, not bookkeeping ones:
//
//   RESERVE   a row exists before the upload URL does, and it is a reservation
//             (uploadCompletedAt NULL) rather than an attachment
//   CLAIM     conditional on owner + key + PUBLIC + unclaimed, so an arbitrary
//             key cannot be finalized, another provider's key cannot be
//             stolen, and two concurrent finalizations produce one winner
//   RETIRE    writes intent (`retainUntil`) and NEVER `deletedAt`, which only
//             the sweep may write, and only after storage confirms absence

type Row = {
  id: string;
  storageKey: string;
  ownerUserId: string;
  visibility: 'PUBLIC' | 'RESTRICTED';
  declaredMimeType: string;
  sizeBytes: number;
  uploadCompletedAt: Date | null;
  uploadExpiresAt: Date | null;
  retainUntil: Date | null;
  deletionReason: string | null;
  deletedAt: Date | null;
};

const NOW = new Date('2026-09-09T12:00:00.000Z');

function row(over: Partial<Row> = {}): Row {
  return {
    id: `id-${over.storageKey ?? Math.random().toString(36).slice(2, 8)}`,
    storageKey: 'avatars/refA/one.jpg',
    ownerUserId: 'user-a',
    visibility: 'PUBLIC',
    declaredMimeType: 'image/jpeg',
    sizeBytes: 1024,
    uploadCompletedAt: null,
    uploadExpiresAt: null,
    retainUntil: null,
    deletionReason: null,
    deletedAt: null,
    ...over,
  };
}

/**
 * A fake that EVALUATES the `where` the service passed, rather than deciding
 * for itself which rows match.
 *
 * The same discipline as the cleanup spec's fake, for the same reason: a fake
 * that enforced ownership on its own would pass every test in this file even
 * with `ownerUserId` deleted from the service, and the suite would be
 * certifying the fake. Every predicate below is read out of the argument.
 */
function harness(rows: Row[] = []) {
  const matches = (where: Record<string, unknown>, r: Row): boolean =>
    Object.entries(where).every(([field, expected]) => {
      const actual = (r as unknown as Record<string, unknown>)[field];
      if (expected === null) return actual === null;
      return actual === expected;
    });

  const mediaAsset = {
    upsert: jest.fn(
      async (args: {
        where: { storageKey: string };
        create: Partial<Row>;
        update: Partial<Row>;
      }) => {
        const found = rows.find((r) => r.storageKey === args.where.storageKey);
        if (found) {
          Object.assign(found, args.update);
          return found;
        }
        const created = row(args.create as Partial<Row>);
        rows.push(created);
        return created;
      },
    ),
    updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(args.where, r));
      for (const r of hit) Object.assign(r, args.data);
      return { count: hit.length };
    }),
    findUnique: jest.fn(async (args: { where: { storageKey: string } }) => {
      const found = rows.find((r) => r.storageKey === args.where.storageKey);
      return found ? { id: found.id } : null;
    }),
  };

  const service = new PublicMediaLedgerService({ client: { mediaAsset } } as never);
  return { service, mediaAsset, rows };
}

describe('PublicMediaLedgerService — reserve', () => {
  it('writes a RESERVATION, not an attachment', async () => {
    const h = harness();
    await h.service.reserve(
      {
        userId: 'user-a',
        storageKey: 'avatars/refA/new.jpg',
        contentType: 'image/png',
        sizeBytes: 900,
      },
      NOW,
    );

    const create = h.mediaAsset.upsert.mock.calls[0][0].create;
    // NULL is what makes it a reservation. If this were set at presign the
    // sweep could never distinguish an abandoned upload from a live avatar,
    // and O-1/O-4 would still be open.
    expect(create.uploadCompletedAt).toBeNull();
    expect(create).toMatchObject({
      visibility: 'PUBLIC',
      ownerUserId: 'user-a',
      storageKey: 'avatars/refA/new.jpg',
    });
  });

  it('records the owner from the SESSION, and an expiry that outlives the presign', async () => {
    const h = harness();
    await h.service.reserve(
      { userId: 'user-a', storageKey: 'k.jpg', contentType: 'image/jpeg', sizeBytes: 1 },
      NOW,
    );

    const create = h.mediaAsset.upsert.mock.calls[0][0].create;
    expect(create.ownerUserId).toBe('user-a');
    expect(create.uploadExpiresAt).toEqual(new Date(NOW.getTime() + RESERVATION_TTL_MS));
  });

  it('is idempotent for a repeated presign of the same key', async () => {
    // storageKey is unique, so a bare `create` here would throw on a retry and
    // turn a harmless duplicate into a failed upload.
    const h = harness([row({ storageKey: 'k.jpg', uploadExpiresAt: new Date(0) })]);
    await expect(
      h.service.reserve(
        { userId: 'user-a', storageKey: 'k.jpg', contentType: 'image/jpeg', sizeBytes: 1 },
        NOW,
      ),
    ).resolves.toBeUndefined();

    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].uploadExpiresAt).toEqual(new Date(NOW.getTime() + RESERVATION_TTL_MS));
    // A refreshed reservation must not become an attachment.
    expect(h.rows[0].uploadCompletedAt).toBeNull();
  });
});

describe('PublicMediaLedgerService — claim', () => {
  it('claims the reservation the server issued to this user', async () => {
    const h = harness([row({ storageKey: 'avatars/refA/one.jpg', ownerUserId: 'user-a' })]);
    const claimed = await h.service.claim(
      { userId: 'user-a', storageKey: 'avatars/refA/one.jpg' },
      NOW,
    );

    expect(claimed).toEqual({ id: h.rows[0].id });
    expect(h.rows[0].uploadCompletedAt).toEqual(NOW);
  });

  it('REFUSES a key that was never reserved', async () => {
    // The client must never be able to finalize an arbitrary storage key. With
    // no row there is nothing to claim, so key-guessing has no surface at all.
    const h = harness([]);
    const claimed = await h.service.claim(
      { userId: 'user-a', storageKey: 'evidence/someone-else/passport.jpg' },
      NOW,
    );

    expect(claimed).toBeNull();
    expect(h.mediaAsset.findUnique).not.toHaveBeenCalled();
  });

  it('REFUSES a reservation belonging to a different provider, even with the exact key', async () => {
    // The case a key-prefix check alone would miss. Ownership is a column, not
    // a substring of the path.
    const h = harness([row({ storageKey: 'avatars/refA/one.jpg', ownerUserId: 'user-a' })]);
    const claimed = await h.service.claim(
      { userId: 'user-b', storageKey: 'avatars/refA/one.jpg' },
      NOW,
    );

    expect(claimed).toBeNull();
    // And provider A's reservation is untouched, so a failed theft cannot even
    // consume the victim's upload.
    expect(h.rows[0].uploadCompletedAt).toBeNull();
    expect(h.rows[0].ownerUserId).toBe('user-a');
  });

  it('REFUSES a RESTRICTED row, so a public finalize cannot reach evidence', async () => {
    const h = harness([
      row({
        storageKey: 'evidence/user-a/id.jpg',
        ownerUserId: 'user-a',
        visibility: 'RESTRICTED',
      }),
    ]);
    const claimed = await h.service.claim(
      { userId: 'user-a', storageKey: 'evidence/user-a/id.jpg' },
      NOW,
    );

    expect(claimed).toBeNull();
    expect(h.rows[0].uploadCompletedAt).toBeNull();
  });

  it('REFUSES a row already recorded as deleted', async () => {
    const h = harness([row({ storageKey: 'k.jpg', deletedAt: NOW })]);
    const claimed = await h.service.claim({ userId: 'user-a', storageKey: 'k.jpg' }, NOW);

    expect(claimed).toBeNull();
  });

  it('two concurrent finalizations produce ONE winner', async () => {
    const h = harness([row({ storageKey: 'k.jpg', ownerUserId: 'user-a' })]);

    const [a, b] = await Promise.all([
      h.service.claim({ userId: 'user-a', storageKey: 'k.jpg' }, NOW),
      h.service.claim({ userId: 'user-a', storageKey: 'k.jpg' }, NOW),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    // One attachment of one object, rather than two rows claiming it.
    expect(h.rows).toHaveLength(1);
  });

  it('a re-claim after a successful one is refused', async () => {
    const h = harness([row({ storageKey: 'k.jpg', ownerUserId: 'user-a' })]);

    await h.service.claim({ userId: 'user-a', storageKey: 'k.jpg' }, NOW);
    const second = await h.service.claim({ userId: 'user-a', storageKey: 'k.jpg' }, NOW);

    expect(second).toBeNull();
  });
});

describe('PublicMediaLedgerService — retire', () => {
  it('records INTENT and never claims the object is gone', async () => {
    const h = harness([
      row({ storageKey: 'k.jpg', ownerUserId: 'user-a', uploadCompletedAt: NOW }),
    ]);
    await h.service.retire(
      { userId: 'user-a', storageKey: 'k.jpg', reason: 'PROVIDER_REMOVED_AVATAR' },
      NOW,
    );

    expect(h.rows[0].retainUntil).toEqual(NOW);
    expect(h.rows[0].deletionReason).toBe('PROVIDER_REMOVED_AVATAR');
    // The load-bearing assertion. `deletedAt` means "confirmed gone from
    // storage"; only the sweep may write it, and only after storage said so.
    // Writing it here is exactly the O-5 defect this replaced.
    expect(h.rows[0].deletedAt).toBeNull();
    const data = h.mediaAsset.updateMany.mock.calls[0][0].data;
    expect('deletedAt' in data).toBe(false);
  });

  it('cannot retire media owned by a different provider', async () => {
    const h = harness([
      row({ storageKey: 'k.jpg', ownerUserId: 'user-a', uploadCompletedAt: NOW }),
    ]);
    await h.service.retire({ userId: 'user-b', storageKey: 'k.jpg', reason: 'X' }, NOW);

    expect(h.rows[0].retainUntil).toBeNull();
    expect(h.rows[0].deletionReason).toBeNull();
  });

  it('cannot retire a RESTRICTED row', async () => {
    const h = harness([
      row({
        storageKey: 'e.jpg',
        ownerUserId: 'user-a',
        visibility: 'RESTRICTED',
        uploadCompletedAt: NOW,
      }),
    ]);
    await h.service.retire({ userId: 'user-a', storageKey: 'e.jpg', reason: 'X' }, NOW);

    expect(h.rows[0].retainUntil).toBeNull();
  });

  it('is a no-op for a key that does not exist', async () => {
    const h = harness([]);
    await expect(
      h.service.retire({ userId: 'user-a', storageKey: 'nope.jpg', reason: 'X' }, NOW),
    ).resolves.toBeUndefined();
  });
});
