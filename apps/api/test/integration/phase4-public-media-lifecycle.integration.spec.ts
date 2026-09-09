/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma/adapter requires: with RUN_DB_INTEGRATION unset this spec is
 * skipped, and a top-level import would still open the client's pool on every
 * hermetic run. `any` on the Prisma and service handles for the same reason.
 */

export {};

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 09B.29 Phase 4 — the PUBLIC media lifecycle, against real Postgres and
// real files on disk.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.3, §4.4
//
// The unit specs prove the services' logic against a fake that evaluates the
// `where` they pass. What they cannot prove is that POSTGRES applies those
// conditions the same way — that `updateMany` with four predicates really is
// atomic, that a unique `storageKey` really does make a reservation idempotent,
// and that two concurrent claims really do resolve to one winner rather than
// two. Those are database properties, and this is where they are checked.
//
// It also proves the one ordering rule the whole retention design rests on:
// `deletedAt` is written ONLY after the object is confirmed gone. The evidence
// sweep has had this test since Sprint 9B.3; public media had nothing.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Phase 4 — public media reservation, claim and sweep (real Postgres, real files)', () => {
  let prisma: any;
  let ledger: any;
  let cleanup: any;
  let storage: any;

  const P = fixturePrefix('p4-public-media');
  const OWNER = `${P}owner`;
  const OTHER = `${P}other`;

  let storageRoot: string;
  let lifecycleLock: HeldLock;

  const GRACE_MS = 86_400_000;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  const key = (name: string) => `avatars/${P}ref/${name}.jpg`;
  const objectExists = (k: string) => existsSync(join(storageRoot, k));

  /** Write real bytes for a key, so a deletion has something to delete. */
  function putObject(k: string): void {
    const abs = join(storageRoot, k);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'not-really-a-jpeg');
  }

  async function wipe(): Promise<void> {
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { in: [OWNER, OTHER] } } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
  }

  const sweep = () => cleanup.sweep({ limit: 50, reservationGraceMs: GRACE_MS });

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-public-media-it-'));

    const {
      LocalDiskStorageAdapter,
    } = require('../../src/infrastructure/storage/local-disk-storage.adapter');
    const {
      PublicMediaLedgerService,
    } = require('../../src/modules/media/public-media-ledger.service');
    const {
      PublicMediaCleanupService,
    } = require('../../src/modules/media/public-media-cleanup.service');

    const config = {
      get: (k: string) =>
        k === 'LOCAL_STORAGE_DIR'
          ? storageRoot
          : k === 'PUBLIC_API_URL'
            ? 'http://localhost:4000'
            : k === 'MEDIA_SIGNING_SECRET'
              ? ''
              : undefined,
      get isProduction() {
        return false;
      },
    };
    storage = new LocalDiskStorageAdapter(config);
    ledger = new PublicMediaLedgerService({ client: prisma });
    cleanup = new PublicMediaCleanupService({ client: prisma }, storage);

    await wipe();
    for (const id of [OWNER, OTHER]) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@public-media.invalid`,
          passwordHash: 'x',
          firstName: 'Pub',
          lastName: 'Media',
        },
      });
    }
  });

  afterAll(async () => {
    await wipe();
    await lifecycleLock?.release();
    if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { in: [OWNER, OTHER] } } });
  });

  // ── reserve ───────────────────────────────────────────────────────────────

  describe('reserve', () => {
    it('creates a row BEFORE any object exists, and it is not an attachment', async () => {
      const k = key('reserved');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
      });

      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row).not.toBeNull();
      expect(row.ownerUserId).toBe(OWNER);
      expect(row.visibility).toBe('PUBLIC');
      // The whole point of O-1/O-4: the row exists even though nothing has
      // been uploaded, so an upload that never happens is still discoverable.
      expect(row.uploadCompletedAt).toBeNull();
      expect(row.uploadExpiresAt).not.toBeNull();
      expect(objectExists(k)).toBe(false);
    });

    it('survives two CONCURRENT reserves of one key', async () => {
      // The case the fake cannot establish, and the one CI found in this
      // sprint's own fixture: an upsert is a read then a write, so two of them
      // can both find nothing and both insert, and Postgres raises P2002 on
      // the loser. The row it wanted exists either way, so a duplicate must
      // resolve rather than fail a presign that had nothing wrong with it.
      const k = key('raced-reserve');
      const input = { userId: OWNER, storageKey: k, contentType: 'image/jpeg', sizeBytes: 1 };

      await expect(
        Promise.all([ledger.reserve(input), ledger.reserve(input), ledger.reserve(input)]),
      ).resolves.toBeDefined();

      const rows = await prisma.mediaAsset.findMany({ where: { storageKey: k } });
      expect(rows).toHaveLength(1);
      expect(rows[0].ownerUserId).toBe(OWNER);
      expect(rows[0].uploadCompletedAt).toBeNull();
    });

    it('is idempotent on the unique storageKey', async () => {
      const k = key('twice');
      const input = { userId: OWNER, storageKey: k, contentType: 'image/jpeg', sizeBytes: 1 };

      await ledger.reserve(input);
      // A bare `create` would throw here on the unique constraint, turning a
      // harmless retried presign into a failed upload.
      await expect(ledger.reserve(input)).resolves.toBeUndefined();

      const rows = await prisma.mediaAsset.findMany({ where: { storageKey: k } });
      expect(rows).toHaveLength(1);
      expect(rows[0].uploadCompletedAt).toBeNull();
    });
  });

  // ── claim ─────────────────────────────────────────────────────────────────

  describe('claim', () => {
    it('claims the reservation this user was issued', async () => {
      const k = key('mine');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1,
      });

      const claimed = await ledger.claim({ userId: OWNER, storageKey: k });
      expect(claimed).not.toBeNull();

      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.uploadCompletedAt).not.toBeNull();
    });

    it('REFUSES a key that was never reserved', async () => {
      // The client must never be able to finalize an arbitrary storage key.
      const claimed = await ledger.claim({
        userId: OWNER,
        storageKey: 'avatars/somebody-else/guessed.jpg',
      });
      expect(claimed).toBeNull();
    });

    it("REFUSES another provider's reservation, and leaves it untouched", async () => {
      const k = key('theirs');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1,
      });

      const stolen = await ledger.claim({ userId: OTHER, storageKey: k });
      expect(stolen).toBeNull();

      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.ownerUserId).toBe(OWNER);
      // A failed theft must not even consume the victim's reservation.
      expect(row.uploadCompletedAt).toBeNull();
    });

    it('two concurrent claims produce exactly ONE winner in Postgres', async () => {
      const k = key('contended');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1,
      });

      const results = await Promise.all([
        ledger.claim({ userId: OWNER, storageKey: k }),
        ledger.claim({ userId: OWNER, storageKey: k }),
        ledger.claim({ userId: OWNER, storageKey: k }),
      ]);

      // The property the fake cannot establish: the conditional UPDATE is
      // atomic under real concurrency, so one object becomes one attachment.
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const rows = await prisma.mediaAsset.findMany({ where: { storageKey: k } });
      expect(rows).toHaveLength(1);
    });
  });

  // ── retire ────────────────────────────────────────────────────────────────

  describe('retire', () => {
    it('records intent and NEVER writes deletedAt', async () => {
      const k = key('retired');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1,
      });
      await ledger.claim({ userId: OWNER, storageKey: k });

      await ledger.retire({ userId: OWNER, storageKey: k, reason: 'PROVIDER_REMOVED_AVATAR' });

      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.retainUntil).not.toBeNull();
      expect(row.deletionReason).toBe('PROVIDER_REMOVED_AVATAR');
      // The O-5 defect, asserted against the real column: the row must not
      // claim the object is gone while it is still readable.
      expect(row.deletedAt).toBeNull();
    });

    it("cannot retire another provider's media", async () => {
      const k = key('not-yours');
      await ledger.reserve({
        userId: OWNER,
        storageKey: k,
        contentType: 'image/jpeg',
        sizeBytes: 1,
      });
      await ledger.claim({ userId: OWNER, storageKey: k });

      await ledger.retire({ userId: OTHER, storageKey: k, reason: 'X' });

      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.retainUntil).toBeNull();
      expect(row.deletionReason).toBeNull();
    });
  });

  // ── sweep ─────────────────────────────────────────────────────────────────

  describe('sweep', () => {
    /** A row plus its bytes, in whatever lifecycle state a test needs. */
    async function asset(
      name: string,
      over: Record<string, unknown>,
      writeObject = true,
    ): Promise<string> {
      const k = key(name);
      if (writeObject) putObject(k);
      await prisma.mediaAsset.create({
        data: {
          visibility: 'PUBLIC',
          storageKey: k,
          declaredMimeType: 'image/jpeg',
          sizeBytes: 17,
          ownerUserId: OWNER,
          uploadCompletedAt: minutesAgo(60),
          ...over,
        },
      });
      return k;
    }

    it('deletes the OBJECT first and records deletedAt only afterwards', async () => {
      const k = await asset('ordered', { retainUntil: minutesAgo(1) });
      expect(objectExists(k)).toBe(true);

      const result = await sweep();
      expect(result.deleted).toBeGreaterThanOrEqual(1);

      // Both halves, in the real world: the bytes are gone from disk AND the
      // row says so. Either one alone is the bug.
      expect(objectExists(k)).toBe(false);
      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.deletedAt).not.toBeNull();
    });

    it('never touches an ACTIVE asset', async () => {
      const k = await asset('active', {});

      const result = await sweep();
      expect(result.examined).toBe(0);
      expect(objectExists(k)).toBe(true);
      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: k } });
      expect(row.deletedAt).toBeNull();
    });

    it('never touches RESTRICTED evidence, whatever its retention says', async () => {
      // A mis-linked row must not let a PUBLIC sweep reach identity documents.
      const k = await asset('evidence', {
        visibility: 'RESTRICTED',
        retainUntil: minutesAgo(1),
        scanState: 'PENDING',
      });

      const result = await sweep();
      expect(result.examined).toBe(0);
      expect(objectExists(k)).toBe(true);
    });

    it('leaves a recent unfinished reservation alone, because it may still be uploading', async () => {
      const k = await asset('in-flight', {
        uploadCompletedAt: null,
        uploadExpiresAt: minutesAgo(5),
      });

      const result = await sweep();
      expect(result.examined).toBe(0);
      expect(objectExists(k)).toBe(true);
    });

    it('eventually deletes a reservation nobody ever came back for', async () => {
      const k = await asset('abandoned', {
        uploadCompletedAt: null,
        uploadExpiresAt: daysAgo(3),
      });

      const result = await sweep();
      expect(result.deleted).toBe(1);
      expect(objectExists(k)).toBe(false);
    });

    it('deleting an object that is already absent is success, not failure', async () => {
      // Exactly the state a crash between the two steps leaves behind, so the
      // retry must not get stuck on it.
      await asset('vanished', { retainUntil: minutesAgo(1) }, false);

      const result = await sweep();
      expect(result).toMatchObject({ deleted: 1, failed: 0 });
    });

    it('is idempotent across repeated passes', async () => {
      await asset('once', { retainUntil: minutesAgo(1) });

      const first = await sweep();
      const second = await sweep();

      expect(first.deleted).toBe(1);
      expect(second).toMatchObject({ examined: 0, deleted: 0 });
    });

    it('two concurrent sweeps produce ONE deletion record', async () => {
      await asset('raced', { retainUntil: minutesAgo(1) });

      const [a, b] = await Promise.all([sweep(), sweep()]);

      // Selection is not a claim, and the object delete is idempotent — so the
      // safety property is that only one CONDITIONAL row write can win.
      expect(a.deleted + b.deleted).toBe(1);
      expect(a.raced + b.raced).toBe(1);
    });

    it('sweeps only what it was asked to, across owners', async () => {
      await asset('owner-retired', { retainUntil: minutesAgo(1) });
      const theirs = `avatars/${P}other-ref/live.jpg`;
      putObject(theirs);
      await prisma.mediaAsset.create({
        data: {
          visibility: 'PUBLIC',
          storageKey: theirs,
          declaredMimeType: 'image/jpeg',
          sizeBytes: 17,
          ownerUserId: OTHER,
          uploadCompletedAt: minutesAgo(60),
        },
      });

      await sweep();

      // The other provider's live image is untouched. The sweep is scoped by
      // STATE, never by listing a prefix — which is why an unrelated owner in
      // the same namespace is safe.
      expect(objectExists(theirs)).toBe(true);
      const row = await prisma.mediaAsset.findUnique({ where: { storageKey: theirs } });
      expect(row.deletedAt).toBeNull();
    });
  });
});
