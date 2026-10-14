/* eslint-disable @typescript-eslint/no-require-imports -- Prisma and the AWS SDK load only inside the gate. */
export {};

import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../../support/db-isolation';
import {
  adapterConfig,
  bucketName,
  client,
  createBucket,
  destroyBucket,
  headRaw,
  putRaw,
  r20Enabled,
  versionsOf,
} from './r20-s3-fixture';

// R20 — the existing public-media cleanup worker against real S3-compatible
// storage and real Postgres: abandoned uploads are removed, finalized and
// in-window assets are not, an already-absent object is idempotent success,
// and a storage-side refusal is NEVER recorded as a deletion.
//
// The sweep is table-wide by design, so this suite holds mediaAssets
// EXCLUSIVELY and asserts only on its own rows.

const d = r20Enabled && process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('r20-orphan-fixture'),
]);

d('R20 public media cleanup — real S3-compatible storage + real Postgres', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let PublicMediaCleanupService: any;
  let S3StorageAdapter: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let admin: S3Client;
  let locks: HeldLock | undefined;
  const P = fixturePrefix('r20-orphan');
  const OWNER = `${P}owner`;
  const PUB = bucketName('orphan');
  const now = new Date('2026-10-14T12:00:00Z');
  const longAgo = new Date('2026-10-01T00:00:00Z');
  const later = new Date('2026-10-14T13:00:00Z');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sweeper(adapter: any = new S3StorageAdapter(adapterConfig({ public: PUB }))) {
    return new PublicMediaCleanupService({ client: prisma }, adapter);
  }

  async function asset(
    id: string,
    key: string,
    data: Record<string, unknown>,
    withObject = true,
  ): Promise<void> {
    if (withObject) await putRaw(admin, PUB, key, PNG, 'image/png');
    await prisma.mediaAsset.create({
      data: {
        id: `${P}${id}`,
        visibility: 'PUBLIC',
        storageKey: key,
        declaredMimeType: 'image/png',
        sizeBytes: PNG.length,
        ownerUserId: OWNER,
        ...data,
      },
    });
  }

  const row = (id: string) => prisma.mediaAsset.findUniqueOrThrow({ where: { id: `${P}${id}` } });

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'mediaAssets' as const, mode: 'exclusive' as const },
    ]);
    prisma = require('@homeservicemarketplace/database').prisma;
    ({
      PublicMediaCleanupService,
    } = require('../../../src/modules/media/public-media-cleanup.service'));
    ({ S3StorageAdapter } = require('../../../src/infrastructure/storage/s3-storage.adapter'));
    admin = client();
    await createBucket(admin, PUB, { versioning: true, marker: 'public' });
    await prisma.mediaAsset.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
    await prisma.user.create({
      data: { id: OWNER, email: `${OWNER}@r20.test`, firstName: 'R', lastName: 'O' },
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.mediaAsset.deleteMany({ where: { id: { startsWith: P } } });
        await prisma.user.deleteMany({ where: { id: OWNER } });
      }
    } finally {
      if (admin) {
        await destroyBucket(admin, PUB);
        admin.destroy();
      }
      await locks?.release();
    }
  });

  it('removes abandoned uploads, keeps finalized and in-window assets, and records only verified deletions', async () => {
    const k = (n: string) => `requests/r20ref/${n}-${randomUUID()}.png`;
    const keys = {
      abandoned: k('abandoned'),
      unclaimed: k('unclaimed'),
      inWindow: k('inwindow'),
      avatar: `avatars/r20ref/${randomUUID()}.png`,
      alreadyGone: k('gone'),
    };
    // Presigned, never completed, reservation long expired.
    await asset('abandoned', keys.abandoned, { uploadExpiresAt: longAgo });
    // A duplicate request upload: finalized, but its claim window closed unused.
    await asset('unclaimed', keys.unclaimed, {
      purpose: 'REQUEST_ATTACHMENT',
      uploadCompletedAt: longAgo,
      uploadExpiresAt: longAgo,
    });
    // Its sibling is still inside the claim window: must survive.
    await asset('inwindow', keys.inWindow, {
      purpose: 'REQUEST_ATTACHMENT',
      uploadCompletedAt: now,
      uploadExpiresAt: later,
    });
    // A finalized avatar in use: never a candidate.
    await asset('avatar', keys.avatar, { uploadCompletedAt: longAgo });
    // Row asks for deletion, object already absent (crash between delete and record).
    await asset('gone', keys.alreadyGone, { uploadExpiresAt: longAgo }, false);

    const result = await sweeper().sweep({ limit: 1000, reservationGraceMs: 60_000, now });
    expect(result.failed).toBe(0);

    for (const id of ['abandoned', 'unclaimed', 'gone']) {
      expect((await row(id)).deletedAt).not.toBeNull();
    }
    expect(await headRaw(admin, PUB, keys.abandoned)).toBeNull();
    expect(await headRaw(admin, PUB, keys.unclaimed)).toBeNull();

    for (const id of ['inwindow', 'avatar']) expect((await row(id)).deletedAt).toBeNull();
    expect(await headRaw(admin, PUB, keys.inWindow)).toBe(PNG.length);
    expect(await headRaw(admin, PUB, keys.avatar)).toBe(PNG.length);

    // Versioned public bucket: the delete is a marker; the noncurrent-version
    // lifecycle rule (plan) is what eventually removes the bytes. Recorded so
    // nobody mistakes a public-bucket delete for physical erasure.
    expect((await versionsOf(admin, PUB, keys.abandoned)).deleteMarkers).toBe(1);

    // A second pass finds nothing new to do.
    const again = await sweeper().sweep({ limit: 1000, reservationGraceMs: 60_000, now });
    expect(again.deleted).toBe(0);
  });

  it('a storage refusal is a failure, never a recorded deletion', async () => {
    const key = `requests/r20ref/denied-${randomUUID()}.png`;
    await asset('denied', key, { uploadExpiresAt: longAgo });
    const denied = new S3StorageAdapter(
      adapterConfig(
        { public: PUB },
        { accessKeyId: 'r20-not-a-user', secretAccessKey: 'r20-not-a-secret-value-000' },
      ),
    );
    const result = await sweeper(denied).sweep({ limit: 1000, reservationGraceMs: 60_000, now });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect((await row('denied')).deletedAt).toBeNull();
    expect(await headRaw(admin, PUB, key)).toBe(PNG.length);
  });
});
