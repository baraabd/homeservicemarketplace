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

// Sprint 9B.9 — the redacted preview at the HTTP boundary, with both
// enforcement flags ON.
//
// docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md
//
// The audience for this surface is providers who are NOT verified. Every
// assertion below is therefore written from the attacker's side: what does the
// wire actually carry, and what can be rebuilt by asking repeatedly?
//
// The guard, the capability service, the policy settings and the request rows
// are all real. Only the services behind the mutation routes are stubbed,
// because whether those routes RETURN anything is irrelevant — whether they
// are reachable is the question.
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

d('Redacted marketplace preview (real guard, real Postgres, flags ON)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('preview');
  const USER = `${P}user`;
  const OTHER = `${P}other`;
  const SEEKER = `${P}seeker`;
  const PP = `${P}pp`;
  const PP2 = `${P}pp2`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  // The seeker's true location, to six decimals. Nothing this precise may
  // appear anywhere on the wire.
  const TRUE_LAT = 36.202105;
  const TRUE_LNG = 37.13426;
  const SECRET_DESCRIPTION = 'Leaking tap at 14 Baron Street, call me on 0555123456';

  const get = (q = '') => request(http).get(`/v1/me/provider/marketplace-preview${q}`);

  async function setPolicy(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: USER },
        update: { value, updatedBy: USER },
      });
    }
  }

  async function clearPolicy(): Promise<void> {
    await prisma.platformSetting.deleteMany({
      where: { key: { startsWith: 'marketplace_preview_' } },
    });
  }

  /** The eligible state: onboarded, verification not complete, no grant. */
  async function setEligible(): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.serviceRequest.deleteMany({ where: { seekerUserId: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
    await clearPolicy();
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
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
      MarketplacePreviewController,
    } = require('../../src/modules/provider/preview/marketplace-preview.controller');
    const {
      MarketplacePreviewService,
    } = require('../../src/modules/provider/preview/marketplace-preview.service');
    // Mounted to prove a preview user cannot reach them.
    const bidsMod = require('../../src/modules/provider/bids/provider-bids.controller');
    const {
      ProviderBidsService,
    } = require('../../src/modules/provider/bids/provider-bids.service');
    const {
      ProviderBookingsController,
    } = require('../../src/modules/provider/bookings/provider-bookings.controller');
    const {
      ProviderBookingsService,
    } = require('../../src/modules/provider/bookings/provider-bookings.service');
    const {
      ProviderWalletController,
    } = require('../../src/modules/provider/wallet/provider-wallet.controller');
    const {
      ProviderWalletService,
    } = require('../../src/modules/provider/wallet/provider-wallet.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    const FLAGS: Record<string, unknown> = {
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
      JWT_ACCESS_SECRET: 'preview-test-secret',
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };
    const stub = (): Record<string, unknown> =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return async () => ({ reached: true });
          },
        },
      ) as Record<string, unknown>;

    const moduleRef = await Test.createTestingModule({
      controllers: [
        MarketplacePreviewController,
        bidsMod.ProviderBidsController,
        ProviderBookingsController,
        ProviderWalletController,
      ],
      providers: [
        MarketplacePreviewService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        PlatformSettingRepository,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: ProviderBidsService, useValue: stub() },
        { provide: ProviderBookingsService, useValue: stub() },
        { provide: ProviderWalletService, useValue: stub() },
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
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    for (const [id, email] of [
      [USER, `${USER}@pv.test`],
      [OTHER, `${OTHER}@pv.test`],
      [SEEKER, `${SEEKER}@pv.test`],
    ]) {
      await prisma.user.create({
        data: {
          id,
          email,
          firstName: 'Layla',
          lastName: 'Mansour',
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
      [PP, USER, 'PV'],
      [PP2, OTHER, 'PW'],
    ]) {
      await prisma.providerProfile.create({
        data: {
          id,
          userId,
          displayName: `Preview Provider ${initials}`,
          headline: 'Experienced provider serving the test region',
          bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete.',
          phoneNumber: `+96390000${initials === 'PV' ? '444' : '445'}`,
          // A service area no other suite uses — an eligible provider is a
          // shared-world fixture and geo-fanout counts recipients table-wide.
          serviceAreaCity: 'PreviewTestCity',
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

    // 25 open requests, all in one small area, all carrying data the preview
    // must never disclose.
    for (let i = 0; i < 25; i++) {
      await prisma.serviceRequest.create({
        data: {
          id: `${P}req${String(i).padStart(2, '0')}`,
          seekerUserId: SEEKER,
          categoryId: CATEGORY,
          description: SECRET_DESCRIPTION,
          mediaUrls: ['https://example.test/secret-photo.jpg'],
          status: 'OPEN_FOR_BIDS',
          scheduleType: 'ASAP',
          addressSnapshot: {
            line1: '14 Baron Street',
            city: 'PreviewTestCity',
            cityKey: 'previewtestcity',
          },
          locationCityKey: 'previewtestcity',
          // A few hundred metres apart: inside one cell.
          locationLat: TRUE_LAT + i * 0.0002,
          locationLng: TRUE_LNG + i * 0.0002,
        },
      });
    }
  });

  beforeEach(async () => {
    currentUser = { id: USER };
    await setEligible();
    await setPolicy({
      marketplace_preview_enabled: true,
      marketplace_preview_cell_km: 25,
      marketplace_preview_page_size: 10,
      marketplace_preview_max_items: 30,
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the response boundary ───────────────────────────────────────────────

  describe('what actually reaches the wire', () => {
    it('serves a preview to an onboarded provider without work access', async () => {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('carries none of the seeker’s identity, address, media or free text', async () => {
      // Asserted against the RAW BODY rather than parsed fields: a leak that
      // arrived under an unexpected key would slip past a field-by-field check.
      const raw = JSON.stringify((await get()).body);

      for (const forbidden of [
        SECRET_DESCRIPTION,
        'Baron Street',
        '0555123456',
        'secret-photo',
        'Layla',
        'Mansour',
        `${SEEKER}@pv.test`,
        SEEKER,
        'addressSnapshot',
        'line1',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('carries no exact coordinates, however deep the page', async () => {
      // The六-decimal truth must not appear anywhere, in any format.
      const raw = JSON.stringify((await get()).body);
      expect(raw).not.toContain(String(TRUE_LAT));
      expect(raw).not.toContain(String(TRUE_LNG));
      expect(raw).not.toContain('36.2021');
      expect(raw).not.toContain('37.1342');
    });

    it('carries no real request id', async () => {
      const raw = JSON.stringify((await get()).body);
      expect(raw).not.toContain(`${P}req00`);
      expect(raw).not.toContain(`${P}req`);
    });

    it('emits exactly the allowlisted item keys', async () => {
      const item = (await get()).body.items[0];
      expect(Object.keys(item).sort()).toEqual(
        [
          'area',
          'categoryLabelAr',
          'categoryLabelEn',
          'categorySlug',
          'freshness',
          'ref',
          'scheduleType',
        ].sort(),
      );
    });

    it('gives two different providers different refs for the same listings', async () => {
      // Colluding preview users must not be able to align their harvests.
      const mine = (await get()).body.items.map((i: { ref: string }) => i.ref);
      currentUser = { id: OTHER };
      const theirs = (await get()).body.items.map((i: { ref: string }) => i.ref);

      expect(mine.length).toBeGreaterThan(0);
      expect(new Set([...mine, ...theirs]).size).toBe(mine.length + theirs.length);
    });
  });

  // ── pagination and anti-scraping ────────────────────────────────────────

  describe('pagination cannot rebuild a location or drain the marketplace', () => {
    it('stops at the policy’s total reach rather than paging on', async () => {
      // Without the cap, a small page size only SLOWS a harvest: 200 pages of
      // 10 is still the whole marketplace.
      await setPolicy({ marketplace_preview_max_items: 12 });

      let cursor: string | null = null;
      let seen = 0;
      for (let i = 0; i < 50; i++) {
        const res: { body: { items: unknown[]; nextCursor: string | null } } = await get(
          cursor ? `?cursor=${cursor}` : '',
        );
        seen += res.body.items.length;
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toBe(12);
      expect(cursor).toBeNull();
    });

    it('walking every page yields ONE cell for listings that share one', async () => {
      // The reconstruction test. All 25 fixtures sit within a few hundred
      // metres; at a 25 km cell they must be one indistinguishable dot no
      // matter how the attacker pages.
      const cells = new Set<string>();
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const res: {
          body: {
            items: Array<{ area: { cellLat: number; cellLng: number } }>;
            nextCursor: string | null;
          };
        } = await get(cursor ? `?cursor=${cursor}` : '');
        for (const it of res.body.items) cells.add(`${it.area.cellLat},${it.area.cellLng}`);
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }
      expect(cells.size).toBe(1);
    });

    it('re-requesting the same page returns an identical cell every time', async () => {
      // Deterministic snapping, observed over HTTP: no averaging attack.
      const cells = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const res = await get();
        for (const it of res.body.items) cells.add(`${it.area.cellLat},${it.area.cellLng}`);
      }
      expect(cells.size).toBe(1);
    });

    it('reports how much the preview will ever show, so the client can say so', async () => {
      const res = await get();
      expect(res.body.totalReach).toBe(30);
      expect(res.body.cellKm).toBe(25);
    });

    it('treats a forged or absurd cursor as the beginning, not an error', async () => {
      // A malformed cursor is not worth an error surface, and restarting
      // discloses strictly less than continuing.
      for (const c of ['abc', '-5', '9999999999', '1e9']) {
        const res = await get(`?cursor=${c}`);
        expect(res.status).toBe(200);
      }
    });

    it('a cursor past the reach returns nothing rather than more listings', async () => {
      const res = await get('?cursor=30');
      expect(res.body.items).toEqual([]);
      expect(res.body.nextCursor).toBeNull();
    });
  });

  // ── the policy switch ───────────────────────────────────────────────────

  describe('the policy is off unless it is explicitly on', () => {
    it('serves nothing when the flag is absent entirely', async () => {
      await clearPolicy();
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      expect(res.body.items).toEqual([]);
    });

    it('serves nothing when the flag is off', async () => {
      await setPolicy({ marketplace_preview_enabled: false });
      const res = await get();
      expect(res.body.available).toBe(false);
      expect(res.body.items).toEqual([]);
    });

    it('answers 200 either way, so toggling the setting is not observable as a status change', async () => {
      // A 404 when disabled would tell any observer exactly when an operator
      // flipped the policy.
      const on = await get();
      await setPolicy({ marketplace_preview_enabled: false });
      const off = await get();
      expect(on.status).toBe(off.status);
    });

    it('honours a coarser cell when the policy widens it', async () => {
      // Non-vacuity for the policy path: if the settings were ignored, every
      // policy test above would pass for the wrong reason.
      const before = (await get()).body.items[0].area;
      await setPolicy({ marketplace_preview_cell_km: 200 });
      const after = (await get()).body.items[0].area;

      expect(after.cellKm).toBe(200);
      expect(`${after.cellLat},${after.cellLng}`).not.toBe(`${before.cellLat},${before.cellLng}`);
    });

    it('falls back to the LARGEST cell when the stored value is nonsense', async () => {
      await setPolicy({ marketplace_preview_cell_km: 'tiny' });
      const res = await get();
      expect(res.body.cellKm).toBe(200);
    });
  });

  // ── who may see it ──────────────────────────────────────────────────────

  describe('eligibility', () => {
    it('denies a suspended provider, whatever the policy says', async () => {
      await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'SUSPENDED' } });
      expect((await get()).status).toBe(403);
    });

    it('denies a terminated provider', async () => {
      await prisma.providerProfile.update({
        where: { id: PP },
        data: { standingState: 'TERMINATED' },
      });
      expect((await get()).status).toBe(403);
    });

    it('denies a provider still in onboarding — they have a task, not a wait', async () => {
      await prisma.providerProfile.update({
        where: { id: PP },
        data: { status: 'DRAFT', onboardingState: 'DRAFT' },
      });
      expect((await get()).status).toBe(403);
    });

    it('denies a provider who already has work access — they get the real feed', async () => {
      await prisma.providerProfile.update({
        where: { id: PP },
        data: { verificationState: 'VERIFIED' },
      });
      await prisma.providerWorkAccessGrant.create({
        data: {
          providerProfileId: PP,
          status: 'ACTIVE',
          source: 'VERIFIED_DOCUMENTS',
          reason: 'PREVIEW_FIXTURE',
          grantedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      expect((await get()).status).toBe(403);

      await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: PP } });
    });

    it('serves a VERIFIED provider whose grant has lapsed — the second "not yet" state', async () => {
      await prisma.providerProfile.update({
        where: { id: PP },
        data: { verificationState: 'VERIFIED' },
      });
      expect((await get()).status).toBe(200);
    });
  });

  // ── the preview user cannot act ─────────────────────────────────────────

  describe('a preview user cannot mutate anything', () => {
    it.each([
      ['bid', () => request(http).post('/v1/provider/bids').send({})],
      ['withdraw a bid', () => request(http).post('/v1/provider/bids/x/withdraw').send({})],
      ['start a booking', () => request(http).post('/v1/me/provider/bookings/x/start').send({})],
      [
        'complete a booking',
        () => request(http).post('/v1/me/provider/bookings/x/complete').send({}),
      ],
      ['cancel a booking', () => request(http).post('/v1/me/provider/bookings/x/cancel').send({})],
      ['read earnings', () => request(http).get('/v1/me/provider/earnings')],
    ])('cannot %s', async (_label, call) => {
      expect((await call()).status).toBe(403);
    });

    it('the preview family exposes no mutation verb at all', async () => {
      // Not "the mutation is denied" but "there is nothing to deny": a POST to
      // this path has no handler. The audience may not act on the marketplace,
      // so a mutation route here would be a contradiction, not a gap.
      for (const verb of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await request(http)[verb]('/v1/me/provider/marketplace-preview').send({});
        expect(res.status).toBe(404);
      }
    });

    it('the ref cannot be posted back anywhere as a request id', async () => {
      const ref = (await get()).body.items[0].ref;
      const res = await request(http).post('/v1/provider/bids').send({ requestId: ref });
      expect(res.status).toBe(403);
    });
  });

  // ── the copy ────────────────────────────────────────────────────────────

  describe('the provider is told why, in both locales', () => {
    it('carries a bilingual notice whether the preview is on or off', async () => {
      for (const enabled of [true, false]) {
        await setPolicy({ marketplace_preview_enabled: enabled });
        const notice = (await get()).body.notice;
        expect(notice.code).toBe('PREVIEW_ONLY');
        for (const field of ['titleEn', 'titleAr', 'bodyEn', 'bodyAr']) {
          expect(typeof notice[field]).toBe('string');
          expect(notice[field].length).toBeGreaterThan(0);
        }
      }
    });

    it('the Arabic copy is actually Arabic, not the English string', async () => {
      const notice = (await get()).body.notice;
      expect(notice.bodyAr).not.toBe(notice.bodyEn);
      expect(notice.bodyAr).toMatch(/[؀-ۿ]/);
      expect(notice.titleAr).toMatch(/[؀-ۿ]/);
    });

    it('says the locations are approximate ON PURPOSE', async () => {
      // A provider looking at a vague map concludes the platform is broken or
      // hiding something. Both are worse than being told plainly.
      const notice = (await get()).body.notice;
      expect(notice.bodyEn.toLowerCase()).toContain('approximate');
      expect(notice.bodyEn.toLowerCase()).toContain('on purpose');
    });

    it('does not blame the provider for being unverified', async () => {
      // "You are not verified" reads as an accusation to someone who has
      // submitted their documents and is waiting.
      const body = (await get()).body.notice.bodyEn.toLowerCase();
      expect(body).not.toContain('you are not verified');
      expect(body).not.toContain('you failed');
      expect(body).toContain('being checked');
    });

    it('promises no timeline nobody can keep', async () => {
      const body = (await get()).body.notice.bodyEn.toLowerCase();
      for (const promise of ['24 hours', '48 hours', 'within a day', 'shortly', 'soon']) {
        expect(body).not.toContain(promise);
      }
    });
  });

  // ── audit ───────────────────────────────────────────────────────────────

  describe('the audit trail records the disclosure, not the people', () => {
    it('logs no user id, request id, coordinate or city', async () => {
      const lines: unknown[] = [];
      const logger = app.get(
        require('../../src/modules/provider/preview/marketplace-preview.service')
          .MarketplacePreviewService,
      ) as unknown as { log: { log: (o: unknown) => void } };
      const original = logger.log;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (logger as any).log = { log: (o: unknown) => lines.push(o), warn: () => undefined };

      await get();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (logger as any).log = original;

      const serialised = JSON.stringify(lines);
      expect(lines.length).toBeGreaterThan(0);
      for (const pii of [USER, SEEKER, `${P}req`, String(TRUE_LAT), 'previewtestcity']) {
        expect(serialised).not.toContain(pii);
      }
      // What it DOES carry: the shape of the disclosure and the policy that
      // governed it, so "served under what limits?" has an answer after the
      // settings row is next edited.
      expect(serialised).toContain('policyFingerprint');
    });
  });
});
