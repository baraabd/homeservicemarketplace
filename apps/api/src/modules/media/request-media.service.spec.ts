import { RESERVATION_TTL_MS } from './public-media-ledger.service';
import { RequestMediaService } from './request-media.service';

// R06 — the request-attachment authority, one case per rule.
//
// The fake EVALUATES the `where` the service passes, like the ledger and
// cleanup specs do. A fake that decided ownership by itself would pass with
// `ownerUserId` deleted from the service. What a fake cannot prove — that
// Postgres makes the conditional UPDATE atomic under concurrency — is proved
// against a real database in test/integration/r06-request-media.integration.spec.ts.

type Row = {
  id: string;
  storageKey: string;
  ownerUserId: string;
  visibility: 'PUBLIC' | 'RESTRICTED';
  purpose: 'REQUEST_ATTACHMENT' | null;
  declaredMimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number;
  uploadCompletedAt: Date | null;
  uploadExpiresAt: Date | null;
  serviceRequestId: string | null;
  requestClaimedAt: Date | null;
  requestAttachmentPosition: number | null;
  retainUntil: Date | null;
  deletedAt: Date | null;
};

const NOW = new Date('2026-10-02T09:00:00.000Z');
const LATER = new Date(NOW.getTime() + 30 * 60_000);
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let seq = 0;
function row(over: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: `asset${String(seq).padStart(20, '0')}`,
    storageKey: `requests/ref/${seq}.jpg`,
    ownerUserId: 'seeker-a',
    visibility: 'PUBLIC',
    purpose: 'REQUEST_ATTACHMENT',
    declaredMimeType: 'image/jpeg',
    detectedMimeType: null,
    sizeBytes: 1024,
    uploadCompletedAt: null,
    uploadExpiresAt: LATER,
    serviceRequestId: null,
    requestClaimedAt: null,
    requestAttachmentPosition: null,
    retainUntil: null,
    deletedAt: null,
    ...over,
  };
}
const finalized = (over: Partial<Row> = {}) => row({ uploadCompletedAt: NOW, ...over });

function matches(where: Record<string, unknown>, r: Row): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual = (r as unknown as Record<string, unknown>)[field];
    if (expected === null) return actual === null;
    if (expected instanceof Date) return actual instanceof Date && +actual === +expected;
    if (typeof expected === 'object') {
      const cond = expected as { in?: unknown[]; not?: unknown; gt?: Date };
      if (cond.in) return cond.in.includes(actual);
      if ('not' in cond) return cond.not === null ? actual !== null : actual !== cond.not;
      if (cond.gt) return actual instanceof Date && actual > cond.gt;
      throw new Error(`Unsupported predicate on ${field}`);
    }
    return actual === expected;
  });
}

function harness(
  rows: Row[] = [],
  stored: Record<string, { sizeBytes: number; head: Uint8Array } | null> = {},
) {
  const mediaAsset = {
    create: jest.fn(async (args: { data: Partial<Row> }) => {
      const created = row(args.data);
      rows.push(created);
      return { id: created.id };
    }),
    findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(args.where, r)),
    ),
    updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(args.where, r));
      for (const r of hit) Object.assign(r, args.data);
      return { count: hit.length };
    }),
  };
  const storage = {
    presignUpload: jest.fn(async (input: { key: string }) => ({
      uploadUrl: `http://storage.test/upload/${input.key}?sig=x`,
      fileUrl: `http://storage.test/files/${input.key}`,
      expiresAt: LATER.toISOString(),
    })),
    readObjectHead: jest.fn(async (key: string) => stored[key] ?? null),
    publicUrlForKey: (key: string) => `http://storage.test/files/${key}`,
  };
  const config = { get: () => 'unit-test-secret-of-at-least-32-characters' };
  const service = new RequestMediaService(
    { client: { mediaAsset } } as never,
    config as never,
    storage as never,
  );
  // The transaction client exposes the same delegate.
  const tx = { mediaAsset } as never;
  return { service, mediaAsset, storage, rows, tx };
}

describe('RequestMediaService — reserve', () => {
  it('writes the reservation before asking storage for a URL', async () => {
    const h = harness();
    const order: string[] = [];
    h.mediaAsset.create.mockImplementationOnce(async (args: { data: Partial<Row> }) => {
      order.push('row');
      const created = row(args.data);
      h.rows.push(created);
      return { id: created.id };
    });
    h.storage.presignUpload.mockImplementationOnce(async (input: { key: string }) => {
      order.push('url');
      return { uploadUrl: 'u', fileUrl: `f/${input.key}`, expiresAt: LATER.toISOString() };
    });

    const out = await h.service.reserve(
      'seeker-a',
      { contentType: 'image/png', sizeBytes: 2048 },
      NOW,
    );

    expect(order).toEqual(['row', 'url']);
    expect(out.assetId).toBe(h.rows[0].id);
    expect(h.rows[0]).toMatchObject({
      ownerUserId: 'seeker-a',
      purpose: 'REQUEST_ATTACHMENT',
      visibility: 'PUBLIC',
      declaredMimeType: 'image/png',
      sizeBytes: 2048,
      uploadCompletedAt: null,
      serviceRequestId: null,
    });
    expect(h.rows[0].uploadExpiresAt).toEqual(new Date(NOW.getTime() + RESERVATION_TTL_MS));
  });

  it('mints the key itself, under an opaque owner ref', async () => {
    const h = harness();
    await h.service.reserve('seeker-a', { contentType: 'video/mp4', sizeBytes: 10 }, NOW);
    expect(h.rows[0].storageKey).toMatch(/^requests\/[0-9a-f]{24}\/[0-9a-f-]{36}\.mp4$/);
    expect(h.rows[0].storageKey).not.toContain('seeker-a');
  });

  it('refuses the presign when the reservation cannot be written', async () => {
    const h = harness();
    h.mediaAsset.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      h.service.reserve('seeker-a', { contentType: 'image/png', sizeBytes: 1 }, NOW),
    ).rejects.toThrow('db down');
    expect(h.storage.presignUpload).not.toHaveBeenCalled();
  });

  it('reports storage failure as a dependency error, with no internals', async () => {
    const h = harness();
    h.storage.presignUpload.mockRejectedValueOnce(new Error('bucket policy: arn:aws:...'));
    await expect(
      h.service.reserve('seeker-a', { contentType: 'image/png', sizeBytes: 1 }, NOW),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
  });
});

describe('RequestMediaService — finalize', () => {
  it('verifies the stored object and records what it found', async () => {
    const r = row();
    const h = harness([r], { [r.storageKey]: { sizeBytes: 1024, head: JPEG_HEAD } });

    const out = await h.service.finalize('seeker-a', [r.id], NOW);

    expect(out).toEqual([{ assetId: r.id, fileUrl: `http://storage.test/files/${r.storageKey}` }]);
    expect(r.uploadCompletedAt).toEqual(NOW);
    expect(r.detectedMimeType).toBe('image/jpeg');
  });

  it('is idempotent and does not re-read storage for a finalized asset', async () => {
    const r = finalized();
    const h = harness([r]);
    const out = await h.service.finalize('seeker-a', [r.id], NOW);
    expect(out).toHaveLength(1);
    expect(h.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it.each([
    ['another user’s asset', () => row({ ownerUserId: 'seeker-b' })],
    ['an avatar or portfolio reservation', () => row({ purpose: null })],
    ['restricted evidence', () => row({ visibility: 'RESTRICTED' })],
    ['an asset already attached to a request', () => finalized({ requestClaimedAt: NOW })],
    ['a retired asset', () => row({ retainUntil: NOW })],
    ['a deleted asset', () => row({ deletedAt: NOW })],
  ])('answers %s exactly like an unknown id', async (_label, make) => {
    const target = make();
    const h = harness([target]);
    const unknown = await h.service
      .finalize('seeker-a', ['doesnotexist000000000000'], NOW)
      .catch((err) => err);
    const refused = await h.service.finalize('seeker-a', [target.id], NOW).catch((err) => err);

    expect(refused).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(refused.details).toEqual({ reason: 'ATTACHMENT_UNAVAILABLE' });
    // Same code, status, message and details: nothing to tell them apart.
    expect({ ...refused, message: refused.message }).toEqual({
      ...unknown,
      message: unknown.message,
    });
    expect(h.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it('refuses an expired reservation', async () => {
    const r = row({ uploadExpiresAt: new Date(NOW.getTime() - 1) });
    const h = harness([r], { [r.storageKey]: { sizeBytes: 1024, head: JPEG_HEAD } });
    await expect(h.service.finalize('seeker-a', [r.id], NOW)).rejects.toMatchObject({
      details: { reason: 'ATTACHMENT_EXPIRED' },
    });
    expect(r.uploadCompletedAt).toBeNull();
  });

  it('refuses when nothing was uploaded', async () => {
    const r = row();
    const h = harness([r]);
    await expect(h.service.finalize('seeker-a', [r.id], NOW)).rejects.toMatchObject({
      status: 400,
      details: { reason: 'FILE_MISSING' },
    });
    expect(r.uploadCompletedAt).toBeNull();
  });

  it('refuses a partial or oversized object', async () => {
    const r = row({ sizeBytes: 1024 });
    for (const sizeBytes of [512, 4096]) {
      const h = harness([r], { [r.storageKey]: { sizeBytes, head: JPEG_HEAD } });
      await expect(h.service.finalize('seeker-a', [r.id], NOW)).rejects.toMatchObject({
        details: { reason: 'SIZE_MISMATCH' },
      });
    }
    expect(r.uploadCompletedAt).toBeNull();
  });

  it('refuses bytes that are not the reserved type', async () => {
    const r = row({ declaredMimeType: 'image/jpeg' });
    const h = harness([r], { [r.storageKey]: { sizeBytes: 1024, head: PNG_HEAD } });
    await expect(h.service.finalize('seeker-a', [r.id], NOW)).rejects.toMatchObject({
      details: { reason: 'CONTENT_MISMATCH' },
    });
    expect(r.uploadCompletedAt).toBeNull();
  });

  it('refuses a repeated id rather than verifying it twice', async () => {
    const r = row();
    const h = harness([r]);
    await expect(h.service.finalize('seeker-a', [r.id, r.id], NOW)).rejects.toMatchObject({
      details: { reason: 'DUPLICATE_ATTACHMENT' },
    });
  });
});

describe('RequestMediaService — claim', () => {
  it('resolves nothing, and reads nothing, for a request without media', async () => {
    const h = harness();
    await expect(h.service.resolveClaimable(h.tx, 'seeker-a', [], NOW)).resolves.toEqual([]);
    expect(h.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it('returns server-derived URLs in the order the seeker chose', async () => {
    const first = finalized();
    const second = finalized();
    const h = harness([first, second]);
    const out = await h.service.resolveClaimable(h.tx, 'seeker-a', [second.id, first.id], NOW);
    expect(out.map((a) => a.id)).toEqual([second.id, first.id]);
    expect(out[0].fileUrl).toBe(`http://storage.test/files/${second.storageKey}`);
  });

  it.each([
    ['unfinished', () => row()],
    ['foreign', () => finalized({ ownerUserId: 'seeker-b' })],
    ['expired', () => finalized({ uploadExpiresAt: new Date(NOW.getTime() - 1) })],
    ['already attached', () => finalized({ serviceRequestId: 'req-0', requestClaimedAt: NOW })],
    ['used by a since-deleted request', () => finalized({ requestClaimedAt: NOW })],
    ['fenced by the cleanup sweep', () => finalized({ retainUntil: NOW })],
    ['an avatar or portfolio asset', () => finalized({ purpose: null })],
  ])('refuses an asset that is %s', async (_label, make) => {
    const target = make();
    const h = harness([target]);
    await expect(
      h.service.resolveClaimable(h.tx, 'seeker-a', [target.id], NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'ATTACHMENT_UNAVAILABLE' } });
    await expect(
      h.service.claim(h.tx, { userId: 'seeker-a', requestId: 'req-1', assetIds: [target.id] }, NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(target.serviceRequestId).not.toBe('req-1');
  });

  it('attaches each asset with its position', async () => {
    const first = finalized();
    const second = finalized();
    const h = harness([first, second]);
    await h.service.claim(
      h.tx,
      { userId: 'seeker-a', requestId: 'req-1', assetIds: [second.id, first.id] },
      NOW,
    );
    expect(second).toMatchObject({
      serviceRequestId: 'req-1',
      requestClaimedAt: NOW,
      requestAttachmentPosition: 0,
    });
    expect(first.requestAttachmentPosition).toBe(1);
  });

  it('a second request cannot claim an asset the first one took', async () => {
    const asset = finalized();
    const h = harness([asset]);
    await h.service.claim(
      h.tx,
      { userId: 'seeker-a', requestId: 'req-1', assetIds: [asset.id] },
      NOW,
    );
    await expect(
      h.service.claim(h.tx, { userId: 'seeker-a', requestId: 'req-2', assetIds: [asset.id] }, NOW),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(asset.serviceRequestId).toBe('req-1');
  });
});
