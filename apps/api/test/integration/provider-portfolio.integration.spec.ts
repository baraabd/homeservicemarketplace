/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.10 — the provider portfolio over real HTTP against a real database.
//
// docs/sprint-09b10/PROVIDER_PORTFOLIO.md
//
// The guard, the capability service, the settings and the rows are all real.
//
// THE ASSERTION THIS SUITE EXISTS FOR
//
// Portfolio media is PUBLIC and verification evidence is RESTRICTED. They share
// one MediaAsset table, so the only thing keeping a provider's identity
// documents out of the public marketplace is code — and code is what tests are
// for. Every direction is covered here: attaching evidence, moving evidence,
// re-using an evidence key, and deleting a portfolio item in a way that could
// touch an evidence row.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('Provider portfolio (real guard, real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let logLines: unknown[];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('portfolio');
  const OWNER = `${P}owner`;
  const OTHER = `${P}other`;
  const PP = `${P}pp`;
  const PP2 = `${P}pp2`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  const base = '/v1/me/provider/portfolio';
  const list = () => request(http).get(base);
  const create = (body: Record<string, unknown>) => request(http).post(base).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(http).patch(`${base}/${id}`).send(body);
  const reorder = (itemIds: string[]) => request(http).post(`${base}/reorder`).send({ itemIds });
  const remove = (id: string) => request(http).delete(`${base}/${id}`);

  let seq = 0;
  /** The opaque owner segment the presign step puts in a portfolio key.
   *  Computed the same way the server does — a public portfolio URL must never
   *  carry a raw user id, so the fixtures cannot use one either. */
  let ownerRef = '';
  let otherRef = '';
  const keyFor = (ref = ownerRef) => `portfolio/${ref}/${P}img${(seq += 1)}.jpg`;
  const goodBody = (over: Record<string, unknown> = {}) => ({
    storageKey: keyFor(),
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    publicationRightAck: true,
    ...over,
  });

  async function setLimits(maxItems: number, maxFileBytes: number): Promise<void> {
    for (const [key, value] of [
      ['provider_portfolio_max_items', maxItems],
      ['provider_portfolio_max_file_bytes', maxFileBytes],
    ] as const) {
      await prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: OWNER },
        update: { value, updatedBy: OWNER },
      });
    }
  }

  async function cleanupItems(): Promise<void> {
    await prisma.providerPortfolioItem.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
  }

  async function cleanupFixtures(): Promise<void> {
    await cleanupItems();
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
    await prisma.platformSetting.deleteMany({
      where: { key: { startsWith: 'provider_portfolio_' } },
    });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      ProviderCapabilityGuard,
    } = require('../../src/modules/provider/guards/provider-capability.guard');
    const {
      ProviderPortfolioController,
    } = require('../../src/modules/provider/portfolio/provider-portfolio.controller');
    const {
      ProviderPortfolioService,
    } = require('../../src/modules/provider/portfolio/provider-portfolio.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    const FLAGS: Record<string, unknown> = {
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
      JWT_ACCESS_SECRET: 'portfolio-test-secret',
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderPortfolioController],
      providers: [
        ProviderPortfolioService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        PlatformSettingRepository,
        TransactionRunner,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // The same ValidationPipe main.ts installs — without it the DTO decorators
    // are inert and every "refuses a bad body" assertion below would be a lie.
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    http = app.getHttpServer();

    // Capture the service's own logger so the log-hygiene test can inspect it.
    logLines = [];
    const svc = app.get(ProviderPortfolioService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).log = {
      log: (o: unknown) => logLines.push(o),
      warn: (o: unknown) => logLines.push(o),
    };

    const { portfolioOwnerRef } = require('../../src/modules/provider/portfolio/portfolio-policy');
    ownerRef = portfolioOwnerRef(OWNER, 'portfolio-test-secret');
    otherRef = portfolioOwnerRef(OTHER, 'portfolio-test-secret');
    expect(ownerRef).not.toBe(otherRef);

    await cleanupFixtures();
    for (const [id, email] of [
      [OWNER, `${OWNER}@pf.test`],
      [OTHER, `${OTHER}@pf.test`],
    ]) {
      await prisma.user.create({
        data: {
          id,
          email,
          firstName: 'P',
          lastName: 'F',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          // Rank 0 denies everything for an ineligible account, which would
          // make every assertion below pass for the wrong reason.
          status: 'ACTIVE',
        },
      });
    }
    await prisma.serviceCategory.create({
      data: { id: CATEGORY, slug: CATEGORY, labelEn: 'Plumbing', labelAr: 'سباكة', icon: 'bolt' },
    });
    for (const [id, userId, initials] of [
      [PP, OWNER, 'PF'],
      [PP2, OTHER, 'PG'],
    ]) {
      await prisma.providerProfile.create({
        data: {
          id,
          userId,
          displayName: `Portfolio Provider ${initials}`,
          headline: 'Experienced provider serving the test region',
          bio: 'A sufficiently long biography for the onboarding policy to consider this complete.',
          phoneNumber: `+9639000005${initials === 'PF' ? '5' : '6'}`,
          // A service area no other suite uses: an eligible provider is a
          // shared-world fixture and geo-fanout counts recipients table-wide.
          serviceAreaCity: 'PortfolioTestCity',
          serviceAreaCountry: 'SY',
          serviceAreaRadiusKm: 25,
          initials,
          status: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          standingState: 'GOOD',
          verificationState: 'UNVERIFIED',
        },
      });
    }
  });

  beforeEach(async () => {
    await cleanupItems();
    await setLimits(12, 5 * 1024 * 1024);
    currentUser = { id: OWNER };
    logLines.length = 0;
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── lifecycle ───────────────────────────────────────────────────────────

  describe('the whole lifecycle', () => {
    it('starts empty, and says how much room there is', async () => {
      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.remainingSlots).toBe(12);
      expect(res.body.maxItems).toBe(12);
    });

    it('creates, lists, updates, reorders and deletes', async () => {
      const a = await create(goodBody({ title: 'Kitchen' }));
      const b = await create(goodBody({ title: 'Bathroom' }));
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      let page = (await list()).body;
      expect(page.items.map((i: { title: string }) => i.title)).toEqual(['Kitchen', 'Bathroom']);
      expect(page.items.map((i: { position: number }) => i.position)).toEqual([0, 1]);
      expect(page.remainingSlots).toBe(10);

      const renamed = await patch(a.body.id, { title: 'Kitchen refit', description: 'Two days' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.title).toBe('Kitchen refit');
      expect(renamed.body.description).toBe('Two days');

      const reordered = await reorder([b.body.id, a.body.id]);
      expect(reordered.status).toBe(200);
      expect(reordered.body.items.map((i: { id: string }) => i.id)).toEqual([b.body.id, a.body.id]);

      expect((await remove(a.body.id)).status).toBe(204);
      page = (await list()).body;
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(b.body.id);
      // Positions stay dense so a client can render by index.
      expect(page.items[0].position).toBe(0);
      expect(page.remainingSlots).toBe(11);
    });

    it('new work goes to the END of the gallery', async () => {
      // Prepending would silently reorder a gallery the provider arranged.
      const a = await create(goodBody({ title: 'first' }));
      const b = await create(goodBody({ title: 'second' }));
      const items = (await list()).body.items;
      expect(items[0].id).toBe(a.body.id);
      expect(items[1].id).toBe(b.body.id);
    });

    it('links a service category when given one, and tolerates none', async () => {
      const withCat = await create(goodBody({ serviceCategoryId: CATEGORY }));
      expect(withCat.body.serviceCategoryId).toBe(CATEGORY);
      const without = await create(goodBody());
      expect(without.body.serviceCategoryId).toBeNull();
    });

    it('starts every item in PENDING moderation and hides the reason until rejected', async () => {
      const created = await create(goodBody());
      expect(created.body.moderationState).toBe('PENDING');
      expect(created.body.moderationReason).toBeNull();

      await prisma.providerPortfolioItem.update({
        where: { id: created.body.id },
        data: { moderationState: 'REJECTED', moderationReason: 'FACE_VISIBLE' },
      });
      const rejected = (await list()).body.items[0];
      expect(rejected.moderationState).toBe('REJECTED');
      // Surfaced only on a rejection, because that is the only state the
      // provider can act on.
      expect(rejected.moderationReason).toBe('FACE_VISIBLE');

      await prisma.providerPortfolioItem.update({
        where: { id: created.body.id },
        data: { moderationState: 'APPROVED', moderationReason: 'FACE_VISIBLE' },
      });
      expect((await list()).body.items[0].moderationReason).toBeNull();
    });
  });

  // ── ownership / IDOR ────────────────────────────────────────────────────

  describe('one provider cannot touch another’s gallery', () => {
    let victimItemId: string;

    beforeEach(async () => {
      const mine = await create(goodBody({ title: 'victim' }));
      victimItemId = mine.body.id;
      currentUser = { id: OTHER };
    });

    it('does not list it', async () => {
      expect((await list()).body.items).toEqual([]);
    });

    it.each([
      ['update', () => patch(victimItemId, { title: 'stolen' })],
      ['delete', () => remove(victimItemId)],
    ])('refuses to %s it with a 404', async (_label, call) => {
      expect((await call()).status).toBe(404);
    });

    it('answers an item that does not exist EXACTLY as one that is not theirs', async () => {
      // Non-enumerating: the two answers must be indistinguishable, or the
      // surface becomes an oracle for which item ids exist.
      const notMine = await patch(victimItemId, { title: 'x' });
      const nonexistent = await patch(`${P}no-such-item`, { title: 'x' });

      expect(notMine.status).toBe(nonexistent.status);
      expect(notMine.body).toEqual(nonexistent.body);
    });

    it('a reorder naming another provider’s item silently ignores it', async () => {
      // Converge rather than error, and above all do not move it.
      // Keyed to OTHER's own ref: a provider can only ever publish a file
      // uploaded under their own opaque owner segment.
      const own = await create(goodBody({ title: 'theirs', storageKey: keyFor(otherRef) }));
      expect(own.status).toBe(200);
      const res = await reorder([victimItemId, own.body.id]);

      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([own.body.id]);

      currentUser = { id: OWNER };
      const victim = (await list()).body.items[0];
      expect(victim.id).toBe(victimItemId);
      expect(victim.position).toBe(0);
    });

    it('cannot publish a file uploaded by another provider', async () => {
      // Ownership is inside the storage key, so guessing one is not enough.
      const res = await create(goodBody({ storageKey: `portfolio/${ownerRef}/${P}stolen.jpg` }));
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('NOT_A_PORTFOLIO_KEY');
    });
  });

  // ── evidence separation ─────────────────────────────────────────────────

  describe('verification evidence can never become portfolio media', () => {
    it('refuses an evidence storage key', async () => {
      const res = await create(goodBody({ storageKey: `verification/${P}case/${P}doc.jpg` }));
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('NOT_A_PORTFOLIO_KEY');
    });

    it('refuses a traversal that climbs out of the portfolio namespace', async () => {
      const res = await create(
        goodBody({ storageKey: `portfolio/${ownerRef}/../../verification/case/doc.jpg` }),
      );
      expect(res.status).toBe(400);
    });

    it('creates its MediaAsset as PUBLIC, under the portfolio prefix', async () => {
      const created = await create(goodBody());
      const item = await prisma.providerPortfolioItem.findUnique({
        where: { id: created.body.id },
        select: { mediaAsset: { select: { visibility: true, storageKey: true } } },
      });
      expect(item.mediaAsset.visibility).toBe('PUBLIC');
      expect(item.mediaAsset.storageKey.startsWith(`portfolio/${ownerRef}/`)).toBe(true);
    });

    it('deleting a portfolio item never marks a RESTRICTED asset for cleanup', async () => {
      // The scoped WHERE on the media update, observed. A mis-linked row must
      // not be able to reach into the evidence namespace on the way out.
      const evidence = await prisma.mediaAsset.create({
        data: {
          id: `${P}eviasset`,
          visibility: 'RESTRICTED',
          storageKey: `verification/${P}case/${P}evidence.pdf`,
          declaredMimeType: 'application/pdf',
          sizeBytes: 10,
          ownerUserId: OWNER,
        },
      });
      const item = await prisma.providerPortfolioItem.create({
        data: { providerProfileId: PP, mediaAssetId: evidence.id, position: 0 },
      });

      expect((await remove(item.id)).status).toBe(204);

      const after = await prisma.mediaAsset.findUnique({ where: { id: evidence.id } });
      expect(after.deletedAt).toBeNull();
      expect(after.deletionReason).toBeNull();
      expect(after.visibility).toBe('RESTRICTED');
    });

    it('a portfolio delete marks only the PUBLIC asset it owns', async () => {
      // Non-vacuity for the test above: the scoped update must still work for
      // the case it is meant for.
      const created = await create(goodBody());
      const before = await prisma.providerPortfolioItem.findUnique({
        where: { id: created.body.id },
        select: { mediaAssetId: true },
      });
      await remove(created.body.id);

      const asset = await prisma.mediaAsset.findUnique({ where: { id: before.mediaAssetId } });
      expect(asset.deletedAt).not.toBeNull();
      expect(asset.deletionReason).toBe('PROVIDER_REMOVED_PORTFOLIO_ITEM');
      // SOFT: the bytes are marked, not erased, so a moderation record does not
      // end up describing a file nobody can look at.
      expect(asset).not.toBeNull();
    });
  });

  // ── what the wire carries ───────────────────────────────────────────────

  describe('internal metadata never reaches the client', () => {
    it('exposes no storage key, media asset id, or profile id', async () => {
      await create(goodBody({ title: 'x' }));
      const raw = JSON.stringify((await list()).body);

      for (const forbidden of ['storageKey', 'mediaAssetId', 'providerProfileId', PP, OWNER]) {
        expect(raw).not.toContain(forbidden);
      }
      // The URL necessarily references the object, but its owner segment is an
      // HMAC: a public portfolio image URL is handed to every customer, and a
      // raw user id in it would publish an internal identifier that correlates
      // the provider across every other surface.
      expect(raw).toContain('/v1/media/files/portfolio/');
      expect(raw).not.toContain(OWNER);
    });

    it('emits exactly the allowlisted item keys', async () => {
      const created = await create(goodBody());
      expect(Object.keys(created.body).sort()).toEqual(
        [
          'createdAt',
          'description',
          'id',
          'media',
          'moderationReason',
          'moderationState',
          'position',
          'serviceCategoryId',
          'title',
        ].sort(),
      );
      expect(Object.keys(created.body.media).sort()).toEqual(['contentType', 'url'].sort());
    });

    it('logs no storage key, user id or title', async () => {
      await create(goodBody({ title: 'A customer kitchen in Aleppo' }));
      const serialised = JSON.stringify(logLines);

      expect(logLines.length).toBeGreaterThan(0);
      for (const pii of [OWNER, 'portfolio/', 'A customer kitchen']) {
        expect(serialised).not.toContain(pii);
      }
    });
  });

  // ── limits ──────────────────────────────────────────────────────────────

  describe('configured limits', () => {
    it('refuses the item past the ceiling, and says which rule fired', async () => {
      await setLimits(2, 5 * 1024 * 1024);
      await create(goodBody());
      await create(goodBody());
      const third = await create(goodBody());

      expect(third.status).toBe(400);
      expect(third.body?.error?.details?.reason).toBe('LIMIT_REACHED');
      expect((await list()).body.remainingSlots).toBe(0);
    });

    it('a LOWERED ceiling keeps existing work published', async () => {
      await setLimits(3, 5 * 1024 * 1024);
      await create(goodBody());
      await create(goodBody());
      await create(goodBody());

      await setLimits(1, 5 * 1024 * 1024);
      const page = (await list()).body;

      // Three items still visible. An operator tightening a limit must not
      // silently unpublish work customers were already shown.
      expect(page.items).toHaveLength(3);
      expect(page.remainingSlots).toBe(0);
      expect((await create(goodBody())).status).toBe(400);
    });

    it('refuses a file over the configured size', async () => {
      // 64 KiB is the schema FLOOR for this setting. A smaller value would be
      // clamped back to the default — correctly, since a row below the floor
      // was written by something that bypassed the admin validation — and the
      // test would then be asserting the fallback rather than the limit.
      await setLimits(12, 64 * 1024);
      const res = await create(goodBody({ sizeBytes: 128 * 1024 }));
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('FILE_TOO_LARGE');
    });

    it.each([
      ['video/mp4', 'video'],
      ['application/pdf', 'a document'],
      ['image/svg+xml', 'SVG, which can carry script'],
    ])('refuses %s (%s)', async (contentType) => {
      const res = await create(goodBody({ contentType }));
      // Refused by the DTO whitelist before the service is reached.
      expect(res.status).toBe(400);
    });

    it('refuses a create without the publication-right acknowledgement', async () => {
      for (const ack of [false, 'true', undefined]) {
        const body = goodBody();
        if (ack === undefined) delete (body as Record<string, unknown>).publicationRightAck;
        else (body as Record<string, unknown>).publicationRightAck = ack;
        expect((await create(body)).status).toBe(400);
      }
    });

    it('records WHEN the publication right was acknowledged', async () => {
      const created = await create(goodBody());
      const row = await prisma.providerPortfolioItem.findUnique({
        where: { id: created.body.id },
        select: { publicationRightAckAt: true, publicationRightAckText: true },
      });
      expect(row.publicationRightAckAt).not.toBeNull();
      expect(row.publicationRightAckText).toBe('PROVIDER_CONFIRMED_RIGHT_TO_PUBLISH');
    });

    it('rejects an unknown field rather than ignoring it', async () => {
      const res = await create(goodBody({ moderationState: 'APPROVED' }));
      expect(res.status).toBe(400);
    });
  });

  // ── idempotency and concurrency ─────────────────────────────────────────

  describe('idempotency and concurrency', () => {
    it('posting the same storage key twice yields ONE item', async () => {
      const body = goodBody({ title: 'once' });
      const first = await create(body);
      const second = await create(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect((await list()).body.items).toHaveLength(1);
    });

    it('the idempotent replay is not refused by the limit it already occupies', async () => {
      // The ordering trap: check the replay BEFORE the ceiling, or a retry of
      // the create that filled the last slot is rejected for filling it.
      await setLimits(1, 5 * 1024 * 1024);
      const body = goodBody();
      const first = await create(body);
      const replay = await create(body);

      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(first.body.id);
    });

    it('two concurrent creates of one key produce exactly one item', async () => {
      const body = goodBody();
      const [a, b] = await Promise.all([create(body), create(body)]);

      // One may lose the unique-constraint race; neither may produce a second
      // item, and at least one must succeed.
      expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect((await list()).body.items).toHaveLength(1);
    });

    it('deleting twice is a no-op, not an error', async () => {
      // A double-tap on a phone must not produce an error nobody can act on.
      const created = await create(goodBody());
      expect((await remove(created.body.id)).status).toBe(204);
      expect((await remove(created.body.id)).status).toBe(204);
      expect((await list()).body.items).toEqual([]);
    });

    it('two concurrent deletes both settle without corrupting the gallery', async () => {
      const a = await create(goodBody());
      const b = await create(goodBody());
      const [r1, r2] = await Promise.all([remove(a.body.id), remove(a.body.id)]);

      expect([r1.status, r2.status].every((s) => s === 204 || s === 404)).toBe(true);
      const page = (await list()).body;
      expect(page.items.map((i: { id: string }) => i.id)).toEqual([b.body.id]);
      expect(page.items[0].position).toBe(0);
    });

    it('two concurrent reorders leave positions dense and unique', async () => {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push((await create(goodBody())).body.id);

      await Promise.all([reorder([...ids].reverse()), reorder(ids)]);

      const items = (await list()).body.items;
      const positions = items.map((i: { position: number }) => i.position).sort();
      expect(positions).toEqual([0, 1, 2, 3]);
      expect(new Set(items.map((i: { id: string }) => i.id)).size).toBe(4);
    });

    it('repeating one update is stable', async () => {
      const created = await create(goodBody());
      const a = await patch(created.body.id, { title: 'same' });
      const b = await patch(created.body.id, { title: 'same' });
      expect(a.body).toEqual(b.body);
    });
  });

  // ── update rules ────────────────────────────────────────────────────────

  describe('what an update may change', () => {
    it('changes caption, description and category', async () => {
      const created = await create(goodBody());
      const res = await patch(created.body.id, {
        title: 'New title',
        description: 'New description',
        serviceCategoryId: CATEGORY,
      });
      expect(res.body).toMatchObject({
        title: 'New title',
        description: 'New description',
        serviceCategoryId: CATEGORY,
      });
    });

    it('clears a caption when explicitly set to null', async () => {
      const created = await create(goodBody({ title: 'remove me' }));
      const res = await patch(created.body.id, { title: null });
      expect(res.body.title).toBeNull();
    });

    it('leaves untouched fields alone', async () => {
      const created = await create(goodBody({ title: 'keep', description: 'keep too' }));
      const res = await patch(created.body.id, { title: 'changed' });
      expect(res.body.description).toBe('keep too');
    });

    it('cannot swap the media behind an item', async () => {
      // Media is immutable: replacing the image behind an approved item would
      // launder unmoderated content through a decision made about something
      // else. The DTO has no field for it, and an attempt is refused outright.
      const created = await create(goodBody());
      const res = await patch(created.body.id, {
        storageKey: `portfolio/${ownerRef}/${P}other.jpg`,
      });
      expect(res.status).toBe(400);
    });

    it('cannot set its own moderation state', async () => {
      const created = await create(goodBody());
      const res = await patch(created.body.id, { moderationState: 'APPROVED' });
      expect(res.status).toBe(400);

      const row = await prisma.providerPortfolioItem.findUnique({
        where: { id: created.body.id },
        select: { moderationState: true },
      });
      expect(row.moderationState).toBe('PENDING');
    });

    it('cannot update a deleted item', async () => {
      const created = await create(goodBody());
      await remove(created.body.id);
      expect((await patch(created.body.id, { title: 'zombie' })).status).toBe(404);
    });
  });
});
