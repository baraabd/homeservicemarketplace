/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { mkdtempSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.3 — the abandoned-upload sweep, against real Postgres and real
// files on disk.
//
// This is a DELETE path for a bucket that holds passports, so most of these
// tests assert what it must REFUSE to destroy. The ordering test is the
// important one: MediaAsset.deletedAt is documented as "set only after the
// object is confirmed gone", and the whole compensation design rests on the
// sweep never producing a row that claims a deletion which did not happen.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Abandoned evidence cleanup (real Postgres, real files)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let service: any;
  let storage: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('evidence-cleanup');
  const CASE_ID = `${P}case`;
  const USER_ID = `${P}user`;
  const PP_ID = `${P}pp`;
  const POLICY = `2099.03-${P.replace(/-$/, '')}-v1`;
  const COUNTRY = 'XB'; // Owned by this suite; ZZ and XA belong to siblings.

  let storageRoot: string;
  let lifecycleLock: HeldLock;
  let GRACE: number;

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const minutesAhead = (m: number) => new Date(Date.now() + m * 60_000);

  /** A prepared asset plus its real bytes on disk. */
  async function makePreparation(
    id: string,
    over: Record<string, unknown> = {},
    writeObject = true,
  ): Promise<string> {
    const key = `verification/${CASE_ID}/${id}.pdf`;
    if (writeObject) {
      const abs = join(storageRoot, key);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, '%PDF-1.4 abandoned');
    }
    await prisma.mediaAsset.create({
      data: {
        id,
        visibility: 'RESTRICTED',
        storageKey: key,
        declaredMimeType: 'application/pdf',
        sizeBytes: 18,
        scanState: 'PENDING',
        ownerUserId: USER_ID,
        verificationCaseId: CASE_ID,
        // Expired well beyond the grace period unless a test says otherwise.
        uploadExpiresAt: minutesAgo(60),
        pendingDocumentKind: 'INDIVIDUAL_IDENTITY',
        ...over,
      },
    });
    return key;
  }

  const objectExists = (key: string): boolean => existsSync(join(storageRoot, key));

  async function cleanup(): Promise<void> {
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: USER_ID } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-cleanup-it-'));

    const {
      LocalDiskRestrictedStorageAdapter,
    } = require('../../src/infrastructure/storage/local-disk-restricted-storage.adapter');
    const {
      EvidenceCleanupService,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup.service');
    ({
      CLEANUP_GRACE_SECONDS: GRACE,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup-policy'));

    const config = {
      get: (k: string) => (k === 'RESTRICTED_STORAGE_DIR' ? storageRoot : undefined),
    };
    storage = new LocalDiskRestrictedStorageAdapter(config);
    service = new EvidenceCleanupService({ client: prisma }, storage);

    await cleanup();
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        country: COUNTRY,
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: USER_ID } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });

    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@cleanup.test`, firstName: 'C', lastName: 'U' },
    });
    await prisma.providerProfile.create({
      data: { id: PP_ID, userId: USER_ID, displayName: 'Cleanup', initials: 'CU', status: 'DRAFT' },
    });
    await prisma.verificationCase.create({
      data: { id: CASE_ID, providerProfileId: PP_ID, state: 'DRAFT', policyVersion: POLICY },
    });
  });

  afterAll(async () => {
    await cleanup();
    rmSync(storageRoot, { recursive: true, force: true });
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the happy path ──────────────────────────────────────────────────────

  it('deletes the bytes and marks the row', async () => {
    const key = await makePreparation(`${P}a1`);

    const res = await service.sweepExpiredPreparations();

    expect(res.deleted).toBe(1);
    expect(objectExists(key)).toBe(false);

    const row = await prisma.mediaAsset.findUnique({ where: { id: `${P}a1` } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletionReason).toBe('ABANDONED_UPLOAD');
  });

  it('is idempotent: a second sweep finds nothing', async () => {
    await makePreparation(`${P}a2`);
    await service.sweepExpiredPreparations();

    const second = await service.sweepExpiredPreparations();
    expect(second.examined).toBe(0);
    expect(second.deleted).toBe(0);
  });

  it('tolerates an object that is already missing', async () => {
    // The common real case: a prepare whose PUT never happened. There are no
    // bytes to delete, and that must be a success rather than a stuck row.
    await makePreparation(`${P}a3`, {}, false);

    const res = await service.sweepExpiredPreparations();
    expect(res.deleted).toBe(1);
    expect(res.failed).toBe(0);

    const row = await prisma.mediaAsset.findUnique({ where: { id: `${P}a3` } });
    expect(row.deletedAt).not.toBeNull();
  });

  // ── what it must refuse ─────────────────────────────────────────────────

  it('never touches a FINALIZED upload', async () => {
    const key = await makePreparation(`${P}b1`, {
      uploadCompletedAt: minutesAgo(30),
      uploadExpiresAt: minutesAgo(90),
    });

    const res = await service.sweepExpiredPreparations();

    expect(res.examined).toBe(0);
    expect(objectExists(key)).toBe(true);
    const row = await prisma.mediaAsset.findUnique({ where: { id: `${P}b1` } });
    expect(row.deletedAt).toBeNull();
  });

  it('never touches a preparation still inside its window', async () => {
    const key = await makePreparation(`${P}b2`, { uploadExpiresAt: minutesAhead(10) });

    await service.sweepExpiredPreparations();

    expect(objectExists(key)).toBe(true);
  });

  it('never touches a preparation still inside the grace period', async () => {
    // Expired, but only just. A finalize that passed its own expiry check
    // microseconds earlier may still be running.
    const key = await makePreparation(`${P}b3`, {
      uploadExpiresAt: new Date(Date.now() - (GRACE - 30) * 1000),
    });

    const res = await service.sweepExpiredPreparations();

    expect(res.examined).toBe(0);
    expect(objectExists(key)).toBe(true);
  });

  it('never touches an asset with no expiry recorded', async () => {
    const key = await makePreparation(`${P}b4`, { uploadExpiresAt: null });

    await service.sweepExpiredPreparations();

    expect(objectExists(key)).toBe(true);
  });

  it('never touches a PUBLIC asset', async () => {
    // A public request photo has no business in a restricted sweep, and the
    // visibility filter is what keeps the blast radius inside this feature.
    await prisma.mediaAsset.create({
      data: {
        id: `${P}b5`,
        visibility: 'PUBLIC',
        storageKey: `requests/${P}b5.jpg`,
        declaredMimeType: 'image/jpeg',
        sizeBytes: 10,
        ownerUserId: USER_ID,
        uploadExpiresAt: minutesAgo(600),
      },
    });

    await service.sweepExpiredPreparations();

    const row = await prisma.mediaAsset.findUnique({ where: { id: `${P}b5` } });
    expect(row.deletedAt).toBeNull();
  });

  it('never touches an asset belonging to another case', async () => {
    // Scoping proof: the sweep selects by state, not by case, so this asserts
    // it cannot reach across into a case it was not asked about — and that
    // "another case" is not a filter it silently ignores.
    const otherCase = `${P}other-case`;
    const otherPp = `${P}other-pp`;
    const otherUser = `${P}other-user`;
    await prisma.user.create({
      data: { id: otherUser, email: `${otherUser}@cleanup.test`, firstName: 'O', lastName: 'U' },
    });
    await prisma.providerProfile.create({
      data: {
        id: otherPp,
        userId: otherUser,
        displayName: 'Other',
        initials: 'OT',
        status: 'DRAFT',
      },
    });
    await prisma.verificationCase.create({
      data: { id: otherCase, providerProfileId: otherPp, state: 'DRAFT', policyVersion: POLICY },
    });
    // Finalized, so it must survive even though it is old.
    await prisma.mediaAsset.create({
      data: {
        id: `${P}other-asset`,
        visibility: 'RESTRICTED',
        storageKey: `verification/${otherCase}/keep.pdf`,
        declaredMimeType: 'application/pdf',
        sizeBytes: 10,
        scanState: 'CLEAN',
        ownerUserId: otherUser,
        verificationCaseId: otherCase,
        uploadExpiresAt: minutesAgo(600),
        uploadCompletedAt: minutesAgo(500),
      },
    });

    await makePreparation(`${P}c1`);
    const res = await service.sweepExpiredPreparations();

    expect(res.deleted).toBe(1);
    const kept = await prisma.mediaAsset.findUnique({ where: { id: `${P}other-asset` } });
    expect(kept.deletedAt).toBeNull();

    await prisma.mediaAsset.deleteMany({ where: { id: `${P}other-asset` } });
    await prisma.verificationCase.deleteMany({ where: { id: otherCase } });
    await prisma.providerProfile.deleteMany({ where: { id: otherPp } });
    await prisma.user.deleteMany({ where: { id: otherUser } });
  });

  // ── bounds and failure ──────────────────────────────────────────────────

  it('honours a bounded batch', async () => {
    // One preparation per DOCUMENT KIND, because
    // media_asset_one_open_preparation_per_slot_uniq allows exactly one open
    // preparation per (case, kind, category) — four rows in one slot is not a
    // state the product can reach, so a fixture that built one would be
    // testing an impossible database.
    const kinds = [
      'INDIVIDUAL_IDENTITY',
      'BUSINESS_REGISTRATION',
      'AUTHORIZED_REPRESENTATIVE_IDENTITY',
      'CATEGORY_LICENSE',
    ];
    for (const [i, kind] of kinds.entries()) {
      await makePreparation(`${P}d${i}`, { pendingDocumentKind: kind });
    }

    const res = await service.sweepExpiredPreparations({ limit: 2 });

    expect(res.deleted).toBe(2);
    const remaining = await prisma.mediaAsset.count({
      where: { ownerUserId: USER_ID, deletedAt: null },
    });
    expect(remaining).toBe(2);
  });

  it('leaves the row untouched when the storage delete FAILS', async () => {
    // The ordering guarantee, stated as a test. If the row were marked first,
    // this asset would now claim a deletion that never happened — and that row
    // is what a data-protection answer would later be built from.
    const failing = {
      deleteObject: jest.fn().mockRejectedValue(new Error('restricted-storage-unavailable')),
    };
    const {
      EvidenceCleanupService,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup.service');
    const svc = new EvidenceCleanupService({ client: prisma }, failing);

    const key = await makePreparation(`${P}e1`);
    const res = await svc.sweepExpiredPreparations();

    expect(res.failed).toBe(1);
    expect(res.deleted).toBe(0);

    const row = await prisma.mediaAsset.findUnique({ where: { id: `${P}e1` } });
    expect(row.deletedAt).toBeNull();
    expect(row.deletionReason).toBeNull();
    // The bytes are still there, which is the honest state: nothing was
    // deleted, so nothing claims to have been.
    expect(objectExists(key)).toBe(true);
  });

  it('retries a previously failed row on the next sweep', async () => {
    const failing = {
      deleteObject: jest.fn().mockRejectedValue(new Error('restricted-storage-unavailable')),
    };
    const {
      EvidenceCleanupService,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup.service');

    const key = await makePreparation(`${P}e2`);
    await new EvidenceCleanupService({ client: prisma }, failing).sweepExpiredPreparations();

    // Storage recovers.
    const res = await service.sweepExpiredPreparations();
    expect(res.deleted).toBe(1);
    expect(objectExists(key)).toBe(false);
  });

  it('two concurrent sweeps delete once and report once', async () => {
    await makePreparation(`${P}f1`);

    const [a, b] = await Promise.all([
      service.sweepExpiredPreparations(),
      service.sweepExpiredPreparations(),
    ]);

    // Exactly one claim across both runs; the other sees the row already
    // marked and counts it as raced rather than double-reporting a deletion.
    expect(a.deleted + b.deleted).toBe(1);

    const rows = await prisma.mediaAsset.findMany({
      where: { ownerUserId: USER_ID, deletedAt: { not: null } },
    });
    expect(rows).toHaveLength(1);
  });

  it('writes no key, filename or owner into its log line', async () => {
    // The sweep logs counts so an operator can see it is alive. It must not
    // become a record of whose identity document was destroyed.
    const {
      EvidenceCleanupService,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup.service');
    const svc = new EvidenceCleanupService({ client: prisma }, storage);

    const written: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).log = {
      log: (o: unknown) => written.push(o),
      warn: (o: unknown) => written.push(o),
    };

    const key = await makePreparation(`${P}g1`);
    await svc.sweepExpiredPreparations();

    const text = JSON.stringify(written);
    expect(text).not.toContain(key);
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain(CASE_ID);
    expect(text).toContain('evidence.cleanup.swept');
  });
});
