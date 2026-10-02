/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma/adapter requires: with RUN_DB_INTEGRATION unset this spec is
 * skipped, and a top-level import would still open the client's pool on every
 * hermetic run. `any` on the Prisma and service handles for the same reason.
 */

export {};

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// R06 — request media authority, against real Postgres and real files on disk.
//
// The unit specs prove each rule against a fake that evaluates the `where` the
// service passes. What they cannot prove is that POSTGRES applies those rules:
// that the conditional claim is atomic when two requests race for one asset,
// that a rolled-back request really leaves the asset unclaimed, that the CHECK
// constraints refuse a malformed link whatever the application does, and that
// the sweep and the claim cannot both win. Those are database properties, and
// this is where they are checked.
//
// Uploads go through the REAL signed-upload acceptor of the local storage
// adapter, so "what was stored" is what the adapter actually wrote.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

d(
  'R06 — request media reservation, verification, atomic claim and sweep (real Postgres, real files)',
  () => {
    let prisma: any;
    let storage: any;
    let media: any;
    let requests: any;
    let failingRequests: any;
    let cleanup: any;
    let feed: any;
    let seekerBookings: any;
    let providerBookings: any;

    const P = fixturePrefix('r06-request-media');
    const SEEKER = `${P}seeker`;
    const OTHER = `${P}other`;
    const PROVIDER_USER = `${P}provider-user`;
    const PROVIDER = `${P}provider`;
    const CATEGORY = `${P}category`;
    const USERS = [SEEKER, OTHER];

    let storageRoot: string;
    let locks: HeldLock | undefined;
    const GRACE_MS = 86_400_000;
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    // Real file signatures, padded to the reserved size.
    const bytes = (head: number[], size: number): Buffer => {
      const out = Buffer.alloc(size, 0x20);
      Buffer.from(head).copy(out);
      return out;
    };
    const JPEG = [0xff, 0xd8, 0xff, 0xe0];
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const HTML = [...Buffer.from('<!doctype html><script>')];
    const SIZE = 64;

    const objectExists = (key: string) => existsSync(join(storageRoot, key));
    const asset = (id: string) => prisma.mediaAsset.findUnique({ where: { id } });
    const requestsOf = (userId: string) =>
      prisma.serviceRequest.findMany({
        where: { seekerUserId: userId },
        orderBy: { createdAt: 'asc' },
      });

    /** PUT through the adapter's signed-upload acceptor, as the browser would. */
    async function put(uploadUrl: string, body: Buffer, contentType: string): Promise<void> {
      const url = new URL(uploadUrl);
      const marker = '/v1/media/uploads/';
      const key = decodeURIComponent(
        url.pathname.slice(url.pathname.indexOf(marker) + marker.length),
      );
      await storage.acceptUpload({
        key,
        sig: url.searchParams.get('sig'),
        exp: Number(url.searchParams.get('exp')),
        contentType: url.searchParams.get('ct'),
        sizeBytes: Number(url.searchParams.get('sz')),
        body,
        actualContentType: contentType,
      });
    }

    const reserve = (userId: string, contentType = 'image/jpeg', sizeBytes = SIZE) =>
      media.reserve(userId, { contentType, sizeBytes });

    /** Reserve, upload and finalize one genuine JPEG. */
    async function readyAsset(
      userId: string,
    ): Promise<{ id: string; key: string; fileUrl: string }> {
      const reserved = await reserve(userId);
      await put(reserved.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      const [finalized] = await media.finalize(userId, [reserved.assetId]);
      const row = await asset(reserved.assetId);
      return { id: reserved.assetId, key: row.storageKey, fileUrl: finalized.fileUrl };
    }

    const body = (mediaAssetIds?: string[]) => ({
      customServiceText: 'R06 attachment proof',
      description: null,
      scheduleType: 'ASAP',
      scheduledAt: null,
      manualAddress: { line1: '1 Test Street', city: 'Aleppo', country: 'SY' },
      ...(mediaAssetIds ? { mediaAssetIds } : {}),
    });

    async function wipe(): Promise<void> {
      const owned = await prisma.serviceRequest.findMany({
        where: { seekerUserId: { in: USERS } },
        select: { id: true },
      });
      const ids = owned.map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        await prisma.outboxHandlerRun
          .deleteMany({
            where: { event: { aggregateId: { in: ids }, aggregateType: 'ServiceRequest' } },
          })
          .catch(() => undefined);
        await prisma.outboxEvent.deleteMany({
          where: { aggregateId: { in: ids }, aggregateType: 'ServiceRequest' },
        });
      }
      await prisma.booking.deleteMany({ where: { seekerUserId: { in: USERS } } });
      await prisma.bid.deleteMany({ where: { providerId: PROVIDER } });
      await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { in: USERS } } });
      await prisma.serviceRequest.deleteMany({ where: { seekerUserId: { in: USERS } } });
      await prisma.providerProfile.deleteMany({ where: { id: PROVIDER } });
      await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
      await prisma.user.deleteMany({ where: { id: { in: [...USERS, PROVIDER_USER] } } });
    }

    const sweep = () => cleanup.sweep({ limit: 200, reservationGraceMs: GRACE_MS });

    beforeAll(async () => {
      // One set, taken atomically and sorted into the canonical order by the
      // helper. This suite writes ServiceRequests and outbox rows (SHARED) and
      // RUNS a global media sweep (EXCLUSIVE).
      locks = await acquireAdvisoryLocks([
        { resource: 'outbox' as const, mode: 'shared' as const },
        { resource: 'serviceRequests' as const, mode: 'shared' as const },
        { resource: 'mediaAssets' as const, mode: 'exclusive' as const },
      ]);

      const db =
        require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
      prisma = db.prisma;
      const prismaSvc = { client: prisma };

      storageRoot = mkdtempSync(join(tmpdir(), 'hsm-r06-request-media-it-'));
      const config = {
        get: (k: string) =>
          k === 'LOCAL_STORAGE_DIR'
            ? storageRoot
            : k === 'PUBLIC_API_URL'
              ? 'http://localhost:4000'
              : k === 'MEDIA_SIGNING_SECRET'
                ? ''
                : k === 'JWT_ACCESS_SECRET'
                  ? 'r06-integration-secret-of-at-least-32-chars'
                  : undefined,
        get isProduction() {
          return false;
        },
      };

      const {
        LocalDiskStorageAdapter,
      } = require('../../src/infrastructure/storage/local-disk-storage.adapter');
      const { RequestMediaService } = require('../../src/modules/media/request-media.service');
      const {
        PublicMediaCleanupService,
      } = require('../../src/modules/media/public-media-cleanup.service');
      const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
      const {
        AddressRepository,
      } = require('../../src/infrastructure/persistence/addresses/address.repository');
      const {
        ServiceCategoryRepository,
      } = require('../../src/infrastructure/persistence/services/service-category.repository');
      const {
        ServiceRequestRepository,
      } = require('../../src/infrastructure/persistence/requests/service-request.repository');
      const {
        ServiceRequestEventRepository,
      } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
      const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
      const { RequestsService } = require('../../src/modules/requests/requests.service');
      const {
        ProviderProfileRepository,
      } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
      const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
      const {
        BookingRepository,
      } = require('../../src/infrastructure/persistence/bookings/booking.repository');
      const {
        BookingEventRepository,
      } = require('../../src/infrastructure/persistence/bookings/booking-event.repository');
      const {
        AvailableRequestsService,
      } = require('../../src/modules/provider/available-requests/available-requests.service');
      const { BookingsService } = require('../../src/modules/bookings/bookings.service');
      const {
        ProviderBookingsService,
      } = require('../../src/modules/provider/bookings/provider-bookings.service');

      storage = new LocalDiskStorageAdapter(config);
      media = new RequestMediaService(prismaSvc, config, storage);
      cleanup = new PublicMediaCleanupService(prismaSvc, storage);
      // The real read services a provider and a booking participant go through.
      feed = new AvailableRequestsService(
        new ProviderProfileRepository(prismaSvc),
        new ServiceRequestRepository(prismaSvc),
        new BidRepository(prismaSvc),
        new ServiceCategoryRepository(prismaSvc),
      );
      seekerBookings = new BookingsService(
        new BookingRepository(prismaSvc),
        new BookingEventRepository(prismaSvc),
        {},
        new TransactionRunner(prismaSvc),
        {},
      );
      providerBookings = new ProviderBookingsService(
        new ProviderProfileRepository(prismaSvc),
        new BookingRepository(prismaSvc),
        new BookingEventRepository(prismaSvc),
        { createForUser: async () => undefined },
        new TransactionRunner(prismaSvc),
        { publishFor: () => undefined },
      );

      const build = (outbox: unknown) =>
        new RequestsService(
          new ServiceRequestRepository(prismaSvc),
          new ServiceRequestEventRepository(prismaSvc),
          new AddressRepository(prismaSvc),
          new ServiceCategoryRepository(prismaSvc),
          new TransactionRunner(prismaSvc),
          outbox,
          media,
        );
      requests = build(new OutboxRepository(prismaSvc));
      // The last write of the creation transaction fails: everything before it,
      // including the claim, must roll back.
      failingRequests = build({
        enqueue: async () => {
          throw new Error('simulated failure after the claim');
        },
      });

      await wipe();
      for (const id of [...USERS, PROVIDER_USER]) {
        await prisma.user.create({
          data: {
            id,
            email: `${id}@r06-request-media.invalid`,
            passwordHash: 'x',
            firstName: 'R06',
            lastName: 'Media',
          },
        });
      }
    });

    afterAll(async () => {
      // Clean up BEFORE releasing: the next suite must not see these rows.
      if (prisma) await wipe();
      await locks?.release();
      if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
    });

    // ── reservation ─────────────────────────────────────────────────────────

    it('records the reservation before any bytes exist', async () => {
      const reserved = await reserve(SEEKER, 'image/png', 128);
      const row = await asset(reserved.assetId);

      expect(row).toMatchObject({
        ownerUserId: SEEKER,
        purpose: 'REQUEST_ATTACHMENT',
        visibility: 'PUBLIC',
        declaredMimeType: 'image/png',
        sizeBytes: 128,
        uploadCompletedAt: null,
        serviceRequestId: null,
        requestClaimedAt: null,
      });
      expect(row.uploadExpiresAt.getTime()).toBeGreaterThan(Date.now());
      // The key is server-minted and does not publish the user id.
      expect(row.storageKey).toMatch(/^requests\/[0-9a-f]{24}\/[0-9a-f-]{36}\.png$/);
      expect(row.storageKey).not.toContain(SEEKER);
      expect(objectExists(row.storageKey)).toBe(false);
    });

    // ── the valid path ──────────────────────────────────────────────────────

    it('attaches verified uploads to a new request, atomically and in order', async () => {
      const first = await readyAsset(SEEKER);
      const second = await readyAsset(SEEKER);

      const created = await requests.create(SEEKER, body([second.id, first.id]));

      // The wire projection every existing reader uses, derived by the server.
      expect(created.mediaUrls).toEqual([second.fileUrl, first.fileUrl]);

      const stored = await prisma.serviceRequest.findUnique({ where: { id: created.id } });
      expect(stored.mediaUrls).toEqual([second.fileUrl, first.fileUrl]);

      const rows = await prisma.mediaAsset.findMany({
        where: { serviceRequestId: created.id },
        orderBy: { requestAttachmentPosition: 'asc' },
      });
      expect(rows.map((r: any) => r.id)).toEqual([second.id, first.id]);
      for (const row of rows) {
        expect(row.requestClaimedAt).not.toBeNull();
        expect(row.detectedMimeType).toBe('image/jpeg');
        expect(row.ownerUserId).toBe(SEEKER);
      }
      // What a provider or a booking participant fetches is the stored object.
      expect(objectExists(first.key)).toBe(true);
      expect(objectExists(second.key)).toBe(true);
    });

    it('creates a request without media and claims nothing', async () => {
      const before = await prisma.mediaAsset.count({
        where: { ownerUserId: SEEKER, serviceRequestId: { not: null } },
      });
      const created = await requests.create(SEEKER, body());
      expect(created.mediaUrls).toEqual([]);
      const after = await prisma.mediaAsset.count({
        where: { ownerUserId: SEEKER, serviceRequestId: { not: null } },
      });
      expect(after).toBe(before);
    });

    // ── existing readers ─────────────────────────────────────────────────────

    it('shows claimed media to the seeker, a matching provider and on the booking', async () => {
      await prisma.serviceCategory.create({
        data: {
          id: CATEGORY,
          slug: `${P}category`,
          labelEn: 'R06 category',
          labelAr: 'فئة اختبار',
          icon: 'wrench',
          isActive: true,
          isLeaf: true,
        },
      });
      await prisma.providerProfile.create({
        data: {
          id: PROVIDER,
          userId: PROVIDER_USER,
          displayName: 'R06 Provider',
          initials: 'RP',
          serviceAreaCity: 'Aleppo',
          serviceAreaCityKey: 'aleppo',
          serviceCategories: { create: [{ serviceCategoryId: CATEGORY }] },
        },
      });

      const one = await readyAsset(SEEKER);
      const two = await readyAsset(SEEKER);
      const created = await requests.create(SEEKER, {
        ...body([one.id, two.id]),
        categoryId: CATEGORY,
        customServiceText: null,
      });
      const expected = [one.fileUrl, two.fileUrl];

      // Seeker: a fresh read is what a hard refresh or a new login performs.
      expect((await requests.detail(SEEKER, created.id)).mediaUrls).toEqual(expected);

      // Provider feed and detail.
      const listed = await feed.list(PROVIDER_USER, {});
      const inFeed = listed.items.find((item: any) => item.id === created.id);
      // The matching provider sees the request at all.
      expect(inFeed).toBeDefined();
      expect(inFeed.media).toEqual(expected);
      expect((await feed.detail(PROVIDER_USER, created.id)).media).toEqual(expected);

      // Booking, as the seeker reads it.
      const bid = await prisma.bid.create({
        data: {
          requestId: created.id,
          providerId: PROVIDER,
          amount: 10000,
          currency: 'USD',
          pricingType: 'FIXED',
        },
      });
      const booking = await prisma.booking.create({
        data: {
          requestId: created.id,
          bidId: bid.id,
          seekerUserId: SEEKER,
          providerId: PROVIDER,
          priceAmount: 10000,
          currency: 'USD',
        },
      });
      expect((await seekerBookings.detail(SEEKER, booking.id)).requestMediaUrls).toEqual(expected);
      // R07 closes the last continuity gap: the same evidence remains visible
      // to the provider after bid acceptance turns the request into a booking.
      expect((await providerBookings.detail(PROVIDER_USER, booking.id)).requestMediaUrls).toEqual(
        expected,
      );

      // And the URLs resolve to the stored objects.
      expect(objectExists(one.key)).toBe(true);
      expect(objectExists(two.key)).toBe(true);
    });

    // ── what must never attach ──────────────────────────────────────────────

    it('refuses another user’s asset, indistinguishably from an unknown id', async () => {
      const foreign = await readyAsset(OTHER);
      const countBefore = (await requestsOf(SEEKER)).length;

      const refused = await requests.create(SEEKER, body([foreign.id])).catch((e: any) => e);
      const unknown = await requests
        .create(SEEKER, body(['doesnotexist000000000000']))
        .catch((e: any) => e);

      expect(refused).toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(refused.details).toEqual(unknown.details);
      expect(refused.message).toBe(unknown.message);
      expect((await requestsOf(SEEKER)).length).toBe(countBefore);
      // The owner's asset is untouched and still theirs to use.
      expect(await asset(foreign.id)).toMatchObject({
        serviceRequestId: null,
        requestClaimedAt: null,
      });
      await expect(requests.create(OTHER, body([foreign.id]))).resolves.toBeDefined();
    });

    it('refuses a reservation whose upload never happened', async () => {
      const reserved = await reserve(SEEKER);
      await expect(media.finalize(SEEKER, [reserved.assetId])).rejects.toMatchObject({
        details: { reason: 'FILE_MISSING' },
      });
      await expect(requests.create(SEEKER, body([reserved.assetId]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await asset(reserved.assetId)).toMatchObject({ uploadCompletedAt: null });
    });

    it('refuses an uploaded but unverified asset at request creation', async () => {
      const reserved = await reserve(SEEKER);
      await put(reserved.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      // The bytes are there, but nothing has verified them yet.
      await expect(requests.create(SEEKER, body([reserved.assetId]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('refuses a partial object: the signed upload rejects it and nothing is stored', async () => {
      const reserved = await reserve(SEEKER, 'image/jpeg', SIZE);
      await expect(put(reserved.uploadUrl, bytes(JPEG, SIZE / 2), 'image/jpeg')).rejects.toThrow(
        'size-mismatch',
      );
      const row = await asset(reserved.assetId);
      expect(objectExists(row.storageKey)).toBe(false);
      await expect(media.finalize(SEEKER, [reserved.assetId])).rejects.toMatchObject({
        details: { reason: 'FILE_MISSING' },
      });
    });

    it('refuses a stored object whose size is not the reserved size', async () => {
      // A backend that did not enforce the signed length (or an object replaced
      // out of band) must still be caught by the read-back.
      const reserved = await reserve(SEEKER, 'image/jpeg', SIZE);
      await put(reserved.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      await prisma.mediaAsset.update({
        where: { id: reserved.assetId },
        data: { sizeBytes: SIZE * 2 },
      });

      await expect(media.finalize(SEEKER, [reserved.assetId])).rejects.toMatchObject({
        details: { reason: 'SIZE_MISMATCH' },
      });
      expect(await asset(reserved.assetId)).toMatchObject({ uploadCompletedAt: null });
    });

    it.each([
      ['a PNG declared as a JPEG', PNG],
      ['an HTML document declared as a JPEG', HTML],
    ])('refuses %s', async (_label, head) => {
      const reserved = await reserve(SEEKER, 'image/jpeg', SIZE);
      // The transport type matches the reservation; only the bytes lie.
      await put(reserved.uploadUrl, bytes(head, SIZE), 'image/jpeg');

      await expect(media.finalize(SEEKER, [reserved.assetId])).rejects.toMatchObject({
        details: { reason: 'CONTENT_MISMATCH' },
      });
      expect(await asset(reserved.assetId)).toMatchObject({
        uploadCompletedAt: null,
        detectedMimeType: null,
      });
      await expect(requests.create(SEEKER, body([reserved.assetId]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('refuses an upload whose transport content type is not the reserved one', async () => {
      const reserved = await reserve(SEEKER, 'image/jpeg', SIZE);
      await expect(put(reserved.uploadUrl, bytes(PNG, SIZE), 'image/png')).rejects.toThrow(
        'content-type-mismatch',
      );
    });

    it('refuses an expired reservation, at finalize and at claim', async () => {
      const unfinished = await reserve(SEEKER);
      await put(unfinished.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      await prisma.mediaAsset.update({
        where: { id: unfinished.assetId },
        data: { uploadExpiresAt: new Date(Date.now() - 1000) },
      });
      await expect(media.finalize(SEEKER, [unfinished.assetId])).rejects.toMatchObject({
        details: { reason: 'ATTACHMENT_EXPIRED' },
      });

      // Verified in time, but the request arrives after the window closed.
      const late = await readyAsset(SEEKER);
      await prisma.mediaAsset.update({
        where: { id: late.id },
        data: { uploadExpiresAt: new Date(Date.now() - 1000) },
      });
      await expect(requests.create(SEEKER, body([late.id]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await asset(late.id)).toMatchObject({ serviceRequestId: null });
    });

    it('does not let the bytes be replaced after they were verified', async () => {
      const reserved = await reserve(SEEKER, 'image/jpeg', SIZE);
      await put(reserved.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      await media.finalize(SEEKER, [reserved.assetId]);

      // The signed URL is still inside its validity window. Uploads are
      // write-once, so a second PUT of different bytes fails.
      await expect(put(reserved.uploadUrl, bytes(HTML, SIZE), 'image/jpeg')).rejects.toMatchObject({
        code: 'EEXIST',
      });
      const row = await asset(reserved.assetId);
      const head = await storage.readObjectHead(row.storageKey, 4);
      expect([...head.head]).toEqual(JPEG);
    });

    // ── single use ──────────────────────────────────────────────────────────

    it('refuses to attach one asset to a second request', async () => {
      const one = await readyAsset(SEEKER);
      const first = await requests.create(SEEKER, body([one.id]));
      const countAfterFirst = (await requestsOf(SEEKER)).length;

      await expect(requests.create(SEEKER, body([one.id]))).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect((await requestsOf(SEEKER)).length).toBe(countAfterFirst);
      expect(await asset(one.id)).toMatchObject({ serviceRequestId: first.id });
      // Nor can it be re-verified into a fresh, claimable state.
      await expect(media.finalize(SEEKER, [one.id])).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses the same asset listed twice in one request', async () => {
      const one = await readyAsset(SEEKER);
      const countBefore = (await requestsOf(SEEKER)).length;
      await expect(requests.create(SEEKER, body([one.id, one.id]))).rejects.toMatchObject({
        details: { reason: 'DUPLICATE_ATTACHMENT' },
      });
      expect((await requestsOf(SEEKER)).length).toBe(countBefore);
      expect(await asset(one.id)).toMatchObject({ serviceRequestId: null });
    });

    it('gives a contested asset to exactly ONE of several concurrent requests', async () => {
      const contested = await readyAsset(SEEKER);
      const countBefore = (await requestsOf(SEEKER)).length;

      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => requests.create(SEEKER, body([contested.id]))),
      );
      const won = attempts.filter((a) => a.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const lost = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(5);
      for (const failure of lost) {
        expect(failure.reason).toMatchObject({ code: 'CONFLICT', status: 409 });
      }
      // Losers left no request, no timeline event and no announcement behind.
      const after = await requestsOf(SEEKER);
      expect(after.length).toBe(countBefore + 1);
      const winnerId = won[0].value.id;
      expect(await asset(contested.id)).toMatchObject({
        serviceRequestId: winnerId,
        requestAttachmentPosition: 0,
      });
      const linked = await prisma.mediaAsset.count({ where: { id: contested.id } });
      expect(linked).toBe(1);
      const announcements = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'ServiceRequest',
          aggregateId: { in: after.map((r: any) => r.id) },
        },
      });
      expect(announcements).toBe(after.length);
    });

    // ── rollback ────────────────────────────────────────────────────────────

    it('leaves the asset unclaimed when the request transaction fails after the claim', async () => {
      const one = await readyAsset(SEEKER);
      const countBefore = (await requestsOf(SEEKER)).length;

      await expect(failingRequests.create(SEEKER, body([one.id]))).rejects.toThrow(
        'simulated failure after the claim',
      );

      expect((await requestsOf(SEEKER)).length).toBe(countBefore);
      expect(await asset(one.id)).toMatchObject({
        serviceRequestId: null,
        requestClaimedAt: null,
        requestAttachmentPosition: null,
      });
      // Not falsely consumed: the seeker's retry succeeds with the same upload.
      const retried = await requests.create(SEEKER, body([one.id]));
      expect(retried.mediaUrls).toEqual([one.fileUrl]);
    });

    it('claims nothing when one asset of a batch is not attachable', async () => {
      const good = await readyAsset(SEEKER);
      const foreign = await readyAsset(OTHER);
      await expect(requests.create(SEEKER, body([good.id, foreign.id]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await asset(good.id)).toMatchObject({
        serviceRequestId: null,
        requestClaimedAt: null,
      });
    });

    // ── database invariants ─────────────────────────────────────────────────

    it('the database itself refuses a malformed request link', async () => {
      const target = (await requestsOf(SEEKER))[0];
      const unverified = await reserve(SEEKER);
      const ledgerRow = await prisma.mediaAsset.create({
        data: {
          visibility: 'PUBLIC',
          storageKey: `avatars/${P}ref/not-a-request-attachment.jpg`,
          declaredMimeType: 'image/jpeg',
          sizeBytes: 1,
          ownerUserId: SEEKER,
          uploadCompletedAt: new Date(),
        },
      });
      const link = {
        serviceRequestId: target.id,
        requestClaimedAt: new Date(),
        requestAttachmentPosition: 0,
      };

      // An upload nobody verified.
      await expect(
        prisma.mediaAsset.update({
          where: { id: unverified.assetId },
          data: { ...link, requestAttachmentPosition: 20 },
        }),
      ).rejects.toThrow(/media_asset_request_claim_shape_chk/);
      // An avatar or portfolio asset.
      await expect(
        prisma.mediaAsset.update({
          where: { id: ledgerRow.id },
          data: { ...link, requestAttachmentPosition: 21 },
        }),
      ).rejects.toThrow(/media_asset_request_claim/);
      // A link with no claim time or position.
      const ready = await readyAsset(SEEKER);
      await expect(
        prisma.mediaAsset.update({
          where: { id: ready.id },
          data: { serviceRequestId: target.id },
        }),
      ).rejects.toThrow(/media_asset_request_claim_shape_chk/);
      // Two assets in one position of one request.
      const occupied = await prisma.mediaAsset.findFirst({
        where: { serviceRequestId: { not: null } },
      });
      await expect(
        prisma.mediaAsset.update({
          where: { id: ready.id },
          data: {
            serviceRequestId: occupied.serviceRequestId,
            requestClaimedAt: new Date(),
            requestAttachmentPosition: occupied.requestAttachmentPosition,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
      // A request that does not exist.
      await expect(
        prisma.mediaAsset.update({
          where: { id: ready.id },
          data: { ...link, serviceRequestId: 'no-such-request', requestAttachmentPosition: 22 },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });

    // ── cleanup ─────────────────────────────────────────────────────────────

    it('sweeps abandoned and unclaimed uploads, and never a claimed one', async () => {
      // Claimed, and old enough that every time-based rule would match it.
      const claimed = await readyAsset(SEEKER);
      const live = await requests.create(SEEKER, body([claimed.id]));
      await prisma.mediaAsset.update({
        where: { id: claimed.id },
        data: { uploadExpiresAt: daysAgo(30), createdAt: daysAgo(31) },
      });

      // Reserved, uploaded, never finalized.
      const abandoned = await reserve(SEEKER);
      await put(abandoned.uploadUrl, bytes(JPEG, SIZE), 'image/jpeg');
      const abandonedKey = (await asset(abandoned.assetId)).storageKey;
      await prisma.mediaAsset.update({
        where: { id: abandoned.assetId },
        data: { uploadExpiresAt: daysAgo(3) },
      });

      // Finalized, never attached to any request.
      const unclaimed = await readyAsset(SEEKER);
      await prisma.mediaAsset.update({
        where: { id: unclaimed.id },
        data: { uploadExpiresAt: daysAgo(3) },
      });

      // Finalized moments ago: its seeker may still be filling in the form.
      const fresh = await readyAsset(SEEKER);

      const result = await sweep();
      expect(result.failed).toBe(0);

      expect(objectExists(abandonedKey)).toBe(false);
      expect((await asset(abandoned.assetId)).deletedAt).not.toBeNull();

      expect(objectExists(unclaimed.key)).toBe(false);
      expect(await asset(unclaimed.id)).toMatchObject({
        deletionReason: 'REQUEST_ATTACHMENT_UNCLAIMED',
      });
      expect((await asset(unclaimed.id)).deletedAt).not.toBeNull();

      expect(objectExists(fresh.key)).toBe(true);
      expect(await asset(fresh.id)).toMatchObject({ deletedAt: null, retainUntil: null });

      // The claimed attachment: bytes present, row untouched, request intact.
      expect(objectExists(claimed.key)).toBe(true);
      expect(await asset(claimed.id)).toMatchObject({
        serviceRequestId: live.id,
        deletedAt: null,
        retainUntil: null,
      });
      const stored = await prisma.serviceRequest.findUnique({ where: { id: live.id } });
      expect(stored.mediaUrls).toEqual([claimed.fileUrl]);

      // A second pass changes nothing.
      await sweep();
      expect(objectExists(claimed.key)).toBe(true);
      expect(objectExists(fresh.key)).toBe(true);
    });

    it('a swept asset can no longer be attached', async () => {
      const gone = await readyAsset(SEEKER);
      await prisma.mediaAsset.update({
        where: { id: gone.id },
        data: { uploadExpiresAt: daysAgo(3) },
      });
      await sweep();
      await expect(requests.create(SEEKER, body([gone.id]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('an asset whose request was deleted is retired, and is never reusable', async () => {
      const used = await readyAsset(SEEKER);
      const doomed = await requests.create(SEEKER, body([used.id]));
      await prisma.outboxEvent.deleteMany({
        where: { aggregateType: 'ServiceRequest', aggregateId: doomed.id },
      });
      await prisma.serviceRequest.delete({ where: { id: doomed.id } });

      // The link is cleared by the foreign key; the claim time stays.
      const orphan = await asset(used.id);
      expect(orphan.serviceRequestId).toBeNull();
      expect(orphan.requestClaimedAt).not.toBeNull();
      await expect(requests.create(SEEKER, body([used.id]))).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      await prisma.mediaAsset.update({
        where: { id: used.id },
        data: { uploadExpiresAt: daysAgo(3) },
      });
      await sweep();
      expect(objectExists(used.key)).toBe(false);
      expect((await asset(used.id)).deletedAt).not.toBeNull();
    });

    it('a claim and a sweep racing for one asset never both win', async () => {
      for (let round = 0; round < 8; round += 1) {
        const contested = await readyAsset(SEEKER);
        // Eligible for the sweep by age, but still inside the claim window is
        // impossible by construction, so widen the claim side for this proof:
        // the fence, not the clock, must be what decides.
        await prisma.mediaAsset.update({
          where: { id: contested.id },
          data: { uploadExpiresAt: new Date(Date.now() + 60_000) },
        });
        const [claim, swept] = await Promise.allSettled([
          requests.create(SEEKER, body([contested.id])),
          cleanup.sweep({ limit: 200, reservationGraceMs: -120_000 }),
        ]);
        expect(swept.status).toBe('fulfilled');

        const row = await asset(contested.id);
        if (claim.status === 'fulfilled') {
          // The request won: its bytes must still be there.
          expect(row.serviceRequestId).toBe(claim.value.id);
          expect(row.deletedAt).toBeNull();
          expect(objectExists(contested.key)).toBe(true);
        } else {
          // The sweep won: no request points at the deleted object.
          expect(claim.reason).toMatchObject({ code: 'CONFLICT' });
          expect(row.serviceRequestId).toBeNull();
          expect(objectExists(contested.key)).toBe(false);
        }
      }
    });
  },
);
