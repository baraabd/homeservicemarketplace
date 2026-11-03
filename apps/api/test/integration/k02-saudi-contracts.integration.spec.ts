import { hash as hashPassword } from 'argon2';
import {
  CURRENT_LEGAL_DOCUMENTS,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@homeservicemarketplace/contracts';
import { PrismaClient, initSaudiLaunchMarket } from '@homeservicemarketplace/database';

import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { clearAuthRateBudget } from '../support/rate-limit-reset';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// K02 — Saudi product rules over real HTTP, PostgreSQL and Redis.
//
//   M — money: "100.25" SAR typed by a provider is stored as 10025 halalas
//       (scale 2) and read back as exactly 100.25 SAR on the bid, the
//       booking, the provider wallet and Admin; the server owns the
//       currency; legacy rows are quarantined, never converted or summed;
//       the database refuses a verified non-SAR row.
//   L — legal: signup persists the exact current Terms/Privacy versions with
//       the SERVER's time; a stale version is refused identically for a new
//       and an existing email; no acceptance is inferred for legacy users.
//   S — schedule: a Riyadh wall time round-trips through the request API.
//   K — market: the operator initializer is audited and idempotent.
//
// Real AppModule, guards and sessions; both Sprint 9 work-access axes armed.
// Every row is prefixed `it-k02-` and every assertion is scoped to it.
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('K02 Saudi contracts over real HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;
  let provider: Session;
  let seeker: Session;
  let admin: Session;

  const X = 'it-k02-';
  const CITY = 'K02 Riyadh Test';
  const KEY = normaliseCityKey(CITY)!;
  const CATEGORY = `${X}cat`;
  const P = { user: `${X}provider`, profile: `${X}provider-pp` };
  const S = { user: `${X}seeker` };

  async function clean() {
    const { db } = h.fixture;
    const ids = { startsWith: X };
    const requests = await db.serviceRequest.findMany({
      where: { OR: [{ id: ids }, { seekerUserId: S.user }] },
      select: { id: true },
    });
    const requestIds = { in: requests.map((r) => r.id) };
    await db.bookingEvent.deleteMany({ where: { booking: { requestId: requestIds } } });
    await db.booking.deleteMany({ where: { requestId: requestIds } });
    await db.bid.deleteMany({ where: { requestId: requestIds } });
    await db.serviceRequestEvent.deleteMany({ where: { requestId: requestIds } });
    await db.notification.deleteMany({ where: { userId: { in: [P.user, S.user] } } });
    await db.serviceRequest.deleteMany({ where: { id: requestIds } });
    await db.address.deleteMany({ where: { userId: S.user } });
    await db.auditEvent.deleteMany({ where: { userId: ids } });
    await db.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfile.deleteMany({ where: { id: ids } });
    await db.serviceCategory.deleteMany({ where: { id: ids } });
    await db.session.deleteMany({ where: { userId: ids } });
    await db.userRole.deleteMany({ where: { userId: ids } });
    const registered = await db.user.findMany({
      where: { email: { startsWith: X } },
      select: { id: true },
    });
    const regIds = { in: registered.map((u) => u.id) };
    await db.auditEvent.deleteMany({ where: { userId: regIds } });
    await db.verificationToken.deleteMany({ where: { userId: regIds } });
    await db.session.deleteMany({ where: { userId: regIds } });
    await db.userRole.deleteMany({ where: { userId: regIds } });
    await db.user.deleteMany({ where: { OR: [{ id: ids }, { id: regIds }] } });
  }

  beforeAll(async () => {
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    const passwordHash = await hashPassword(h.fixture.password!);
    await db.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'K02 Plumbing',
        labelAr: 'سباكة',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    for (const [id, roleName] of [
      [P.user, 'provider'],
      [S.user, 'customer'],
    ] as const) {
      await db.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          firstName: 'K02',
          lastName: roleName,
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });
      const role = await db.role.findUnique({ where: { name: roleName } });
      if (role) await db.userRole.create({ data: { userId: id, roleId: role.id } });
      h.enrol(id);
    }
    await db.providerProfile.create({
      data: {
        id: P.profile,
        userId: P.user,
        displayName: 'K02 Provider',
        initials: 'KP',
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        standingState: 'GOOD',
        verificationState: 'VERIFIED',
        serviceAreaCity: CITY,
        serviceAreaCityKey: KEY,
        serviceCategories: { create: [{ serviceCategoryId: CATEGORY }] },
      },
    });
    await db.providerWorkAccessGrant.create({
      data: {
        id: `${P.profile}-grant`,
        providerProfileId: P.profile,
        status: 'ACTIVE',
        source: 'MANUAL_OVERRIDE',
        reason: 'K02 fixture',
        grantedAt: new Date(Date.now() - 60_000),
      },
    });
    provider = await httpSession(h).login(P.user);
    seeker = await httpSession(h).login(S.user);
    admin = await httpSession(h).login(h.fixture.users.reviewer);
  });
  afterAll(async () => {
    if (h) await clean();
    await h?.dispose();
  });

  /** A seeker request through the real API, scheduled at a Riyadh wall time. */
  async function postRequest(wall: { date: string; time: string }) {
    const scheduledAt = zonedWallTimeToUtc(wall.date, wall.time, 'Asia/Riyadh')!.toISOString();
    const res = await seeker.request<{ id: string; scheduledAt: string | null }>(
      '/v1/me/requests',
      {
        method: 'POST',
        body: {
          categoryId: CATEGORY,
          description: 'K02 leaking kitchen tap',
          scheduleType: 'LATER',
          scheduledAt,
          manualAddress: {
            line1: 'King Fahd Rd 1',
            city: CITY,
            country: 'SA',
            lat: 24.7136,
            lng: 46.6753,
          },
        },
      },
    );
    expect(res.status).toBe(201);
    return { id: res.body.id, scheduledAt };
  }

  it('S01 a Riyadh wall time across midnight round-trips through the request API', async () => {
    const wall = { date: '2027-03-02', time: '00:30' };
    const { id, scheduledAt } = await postRequest(wall);
    expect(scheduledAt).toBe('2027-03-01T21:30:00.000Z');
    const stored = await h.fixture.db.serviceRequest.findUniqueOrThrow({ where: { id } });
    expect(stored.scheduledAt!.toISOString()).toBe(scheduledAt);
    const read = await seeker.request<{ scheduledAt: string }>(`/v1/me/requests/${id}`);
    expect(read.status).toBe(200);
    expect(utcToZonedWallTime(read.body.scheduledAt, 'Asia/Riyadh')).toEqual(wall);
  });

  it('M01 100.25 SAR → 10025 halalas → 100.25 SAR across bid, booking, wallet and Admin', async () => {
    const { db } = h.fixture;
    const { id: requestId } = await postRequest({ date: '2027-03-03', time: '10:00' });

    // The provider types a decimal; the server converts it once.
    const bid = await provider.request<{ id: string }>('/v1/me/provider/bids', {
      method: 'POST',
      body: { requestId, amountDecimal: '100.25', currency: 'SAR', pricingType: 'FIXED' },
    });
    expect(bid.status).toBe(201);
    const bidRow = await db.bid.findFirstOrThrow({ where: { requestId, providerId: P.profile } });
    expect(bidRow).toEqual(
      expect.objectContaining({ amount: 10025, currency: 'SAR', amountScale: 2 }),
    );

    // The seeker sees exactly what the provider typed, with its unit.
    const seekerBids = await seeker.request<{
      items: Array<{ id: string; amount: number; currency: string; amountScale: number | null }>;
    }>(`/v1/me/requests/${requestId}/bids`);
    expect(seekerBids.status).toBe(200);
    const seen = seekerBids.body.items.find((b) => b.id === bidRow.id)!;
    expect(seen).toEqual(
      expect.objectContaining({ amount: 10025, currency: 'SAR', amountScale: 2 }),
    );

    // Accept → booking snapshots the amount, currency and scale.
    const accepted = await seeker.request<{
      booking: { id: string; priceAmount: number; currency: string; amountScale: number };
    }>(`/v1/me/requests/${requestId}/bids/${bidRow.id}/accept`, { method: 'POST' });
    expect([200, 201]).toContain(accepted.status);
    const booking = await db.booking.findFirstOrThrow({ where: { requestId } });
    expect(booking).toEqual(
      expect.objectContaining({ priceAmount: 10025, currency: 'SAR', amountScale: 2 }),
    );

    for (const action of ['start', 'complete'] as const) {
      const step = await provider.request(`/v1/provider/bookings/${booking.id}/${action}`, {
        method: 'POST',
      });
      expect([200, 201]).toContain(step.status);
    }

    // Provider wallet: one SAR figure; no fee; the halalas are exact.
    const summary = await provider.request<{
      byCurrency: Array<{
        currency: string;
        amountScale: number;
        completedValue: number;
        completedCount: number;
      }>;
      excluded: unknown[];
      feeStatus: string;
      platformFeeRateBps: null;
    }>('/v1/provider/earnings/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.byCurrency).toEqual([
      expect.objectContaining({
        currency: 'SAR',
        amountScale: 2,
        completedValue: 10025,
        completedCount: 1,
      }),
    ]);
    expect(summary.body.feeStatus).toBe('NOT_APPROVED');
    expect(summary.body.platformFeeRateBps).toBeNull();
    expect(JSON.stringify(summary.body)).not.toMatch(/platformFees|netEarnings|availableBalance/);

    const tx = await provider.request<{
      items: Array<{
        bookingId: string;
        amount: number;
        currency: string;
        amountScale: number;
        pricingType: string;
      }>;
    }>('/v1/provider/earnings/transactions');
    expect(tx.body.items.find((i) => i.bookingId === booking.id)).toEqual(
      expect.objectContaining({
        amount: 10025,
        currency: 'SAR',
        amountScale: 2,
        pricingType: 'FIXED',
      }),
    );
    const chart = await provider.request<{
      currency: string;
      amountScale: number;
      buckets: Array<{ grossEarnings: number }>;
    }>('/v1/provider/earnings/chart?range=7d');
    expect(chart.status).toBe(200);
    expect(chart.body).toEqual(expect.objectContaining({ currency: 'SAR', amountScale: 2 }));
    expect(chart.body.buckets.reduce((n, b) => n + b.grossEarnings, 0)).toBe(10025);
    const usdChart = await provider.request('/v1/provider/earnings/chart?range=7d&currency=USD');
    expect(usdChart.status).toBe(400);

    // Admin: the same booking, the same exact amount, per provider+currency.
    const adminBookings = await admin.request<{
      items: Array<{ id: string; amount: number; currency: string; amountScale: number }>;
    }>('/v1/admin/financials/bookings?limit=100');
    expect(adminBookings.status).toBe(200);
    expect(adminBookings.body.items.find((r) => r.id === booking.id)).toEqual(
      expect.objectContaining({ amount: 10025, currency: 'SAR', amountScale: 2 }),
    );
    const adminProviders = await admin.request<{
      items: Array<{ providerId: string; currency: string; grossEarnings: number }>;
    }>('/v1/admin/financials/provider-earnings?limit=100');
    const ours = adminProviders.body.items.filter((r) => r.providerId === P.profile);
    expect(ours).toEqual([expect.objectContaining({ currency: 'SAR', grossEarnings: 10025 })]);
    const adminSummary = await admin.request<{
      byCurrency: Array<{ currency: string; amountScale: number }>;
      feeStatus: string;
    }>('/v1/admin/financials/summary');
    expect(adminSummary.status).toBe(200);
    expect(adminSummary.body.feeStatus).toBe('NOT_APPROVED');
    // Every money figure is one currency at its own approved scale.
    for (const group of adminSummary.body.byCurrency)
      expect(group).toEqual(expect.objectContaining({ currency: 'SAR', amountScale: 2 }));
  });

  it('M02 the server owns currency and unit: legacy fields, other currencies and lossy decimals are refused', async () => {
    const { id: requestId } = await postRequest({ date: '2027-03-04', time: '09:00' });
    const send = (body: Record<string, unknown>) =>
      provider.request<{ error: { code: string; details?: { reason?: string } } }>(
        '/v1/me/provider/bids',
        {
          method: 'POST',
          body: { requestId, pricingType: 'FIXED', ...body },
        },
      );
    const legacy = await send({ amount: 100 });
    expect(legacy.status).toBe(400); // pre-K02 integer field is not accepted
    const usd = await send({ amountDecimal: '100.25', currency: 'USD' });
    expect(usd.status).toBe(400);
    expect(usd.body.error.details?.reason).toBe('CURRENCY_NOT_APPROVED');
    const lossy = await send({ amountDecimal: '100.255', currency: 'SAR' });
    expect(lossy.status).toBe(400);
    expect(lossy.body.error.details?.reason).toBe('TOO_MANY_FRACTION_DIGITS');
    const injected = await send({ amountDecimal: '10', currency: 'SAR', amountScale: 0 });
    expect(injected.status).toBe(400); // the client cannot choose the unit
    expect(await h.fixture.db.bid.count({ where: { requestId } })).toBe(0);
  });

  it('M03 legacy amounts are quarantined: never converted, never summed, always counted', async () => {
    const { db } = h.fixture;
    const reqId = `${X}legacy-req`;
    await db.serviceRequest.create({
      data: {
        id: reqId,
        seekerUserId: S.user,
        categoryId: CATEGORY,
        description: 'pre-K02 row',
        scheduleType: 'LATER',
        status: 'BOOKED',
        addressSnapshot: { city: CITY, country: 'SA', cityKey: KEY },
        locationCityKey: KEY,
      },
    });
    await db.bid.create({
      data: {
        id: `${X}legacy-bid`,
        requestId: reqId,
        providerId: P.profile,
        amount: 1000,
        currency: 'USD',
        amountScale: null,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await db.booking.create({
      data: {
        id: `${X}legacy-bk`,
        requestId: reqId,
        bidId: `${X}legacy-bid`,
        seekerUserId: S.user,
        providerId: P.profile,
        priceAmount: 1000,
        currency: 'USD',
        amountScale: null,
        status: 'COMPLETED',
      },
    });
    const summary = await provider.request<{
      byCurrency: Array<{ currency: string; completedValue: number }>;
      excluded: Array<{ currency: string; reason: string; completedCount: number }>;
      completedBookingsCount: number;
    }>('/v1/provider/earnings/summary');
    expect(summary.body.byCurrency.map((c) => c.currency)).toEqual(['SAR']);
    expect(summary.body.byCurrency[0]!.completedValue).toBe(10025); // USD 1000 not added
    expect(summary.body.excluded).toEqual([
      { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 1, inFlightCount: 0 },
    ]);
    expect(summary.body.completedBookingsCount).toBe(2);
    // The stored legacy row is untouched: zero silent conversions.
    const after = await db.booking.findUniqueOrThrow({ where: { id: `${X}legacy-bk` } });
    expect(after).toEqual(
      expect.objectContaining({ priceAmount: 1000, currency: 'USD', amountScale: null }),
    );
  });

  it('M04 the database refuses a verified non-SAR amount and a verified zero amount', async () => {
    const { db } = h.fixture;
    const reqId = `${X}check-req`;
    await db.serviceRequest.create({
      data: {
        id: reqId,
        seekerUserId: S.user,
        categoryId: CATEGORY,
        scheduleType: 'ASAP',
        status: 'OPEN_FOR_BIDS',
        addressSnapshot: { city: CITY },
        locationCityKey: KEY,
      },
    });
    await expect(
      db.bid.create({
        data: {
          requestId: reqId,
          providerId: P.profile,
          amount: 100,
          currency: 'USD',
          amountScale: 2,
          pricingType: 'FIXED',
        },
      }),
    ).rejects.toThrow(/Bid_amountScale_currency_check/);
    await expect(
      db.bid.create({
        data: {
          requestId: reqId,
          providerId: P.profile,
          amount: 100,
          currency: 'SAR',
          amountScale: 0,
          pricingType: 'FIXED',
        },
      }),
    ).rejects.toThrow(/Bid_amountScale_currency_check/);
    await expect(
      db.bid.create({
        data: {
          requestId: reqId,
          providerId: P.profile,
          amount: 0,
          currency: 'SAR',
          amountScale: 2,
          pricingType: 'FIXED',
        },
      }),
    ).rejects.toThrow(/Bid_verified_amount_positive_check/);
    // A write that forgets the currency fails: no USD default remains.
    const raw = new PrismaClient({ log: [] });
    try {
      await expect(
        raw.$executeRawUnsafe(
          `INSERT INTO "Bid" ("id","requestId","providerId","amount","pricingType","updatedAt") VALUES ('${X}nodefault','${reqId}','${P.profile}',1,'FIXED',now())`,
        ),
      ).rejects.toThrow(/23502/); // NOT NULL: currency has no default
    } finally {
      await raw.$disconnect();
    }
  });

  it('L01 signup persists the exact current versions with the server time; stale versions are refused alike', async () => {
    const { db } = h.fixture;
    const anon = httpSession(h);
    const current = {
      termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
      privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
    };
    const docs = await anon.request<{
      documents: Array<{ kind: string; version: string; path: string }>;
      acceptanceOpen: boolean;
    }>('/v1/legal/documents');
    expect(docs.status).toBe(200); // public, unauthenticated
    expect(docs.body.acceptanceOpen).toBe(true); // NODE_ENV=test, flag unset
    expect(docs.body.documents.map((d) => d.version).sort()).toEqual(
      [current.privacyVersion, current.termsVersion].sort(),
    );

    const email = `${X}signup-${Date.now()}@example.test`;
    // Loopback registration budget is shared by every suite on this host; no
    // assertion here is about the throttle (registration-throttle.integration
    // drives that from synthetic IPs).
    await clearAuthRateBudget(h.app.get(RedisService).getClient(), [email]);
    const register = (body: Record<string, unknown>) =>
      anon.request<{ error?: { details?: { reason?: string } } }>('/v1/auth/register', {
        method: 'POST',
        body: {
          email,
          password: 'k02-Correct-Horse-9',
          firstName: 'Noura',
          lastName: 'K02',
          ...body,
        },
      });

    expect((await register({})).status).toBe(400); // consent versions are required

    const staleNew = await register({
      legalAcceptance: { ...current, termsVersion: 'ksa-terms-old', locale: 'ar' },
    });
    expect(staleNew.status).toBe(409);
    expect(staleNew.body.error?.details?.reason).toBe('LEGAL_VERSION_STALE');
    expect(await db.user.count({ where: { email } })).toBe(0);

    const before = Date.now();
    const ok = await register({ legalAcceptance: { ...current, locale: 'ar' } });
    const after = Date.now();
    expect(ok.status).toBe(202);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const rows = await db.userLegalAcceptance.findMany({
      where: { userId: user.id },
      orderBy: { documentKind: 'asc' },
    });
    expect(rows.map((r) => [r.documentKind, r.version, r.locale, r.source])).toEqual([
      ['TERMS_OF_SERVICE', current.termsVersion, 'ar', 'SIGNUP'],
      ['PRIVACY_NOTICE', current.privacyVersion, 'ar', 'SIGNUP'],
    ]);
    for (const r of rows) {
      expect(r.acceptedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(r.acceptedAt.getTime()).toBeLessThanOrEqual(after + 1000);
    }

    // The same stale version for an EXISTING email answers identically, so
    // the consent check cannot be used to enumerate accounts.
    const staleExisting = await register({
      legalAcceptance: { ...current, privacyVersion: 'x', locale: 'en' },
    });
    expect(staleExisting.status).toBe(409);
    expect((staleExisting.body.error as { message?: string }).message).toBe(
      (staleNew.body.error as { message?: string }).message,
    );
    expect(staleExisting.body.error?.details?.reason).toBe('LEGAL_VERSION_STALE');

    // A duplicate registration never adds or rewrites acceptance rows.
    expect((await register({ legalAcceptance: { ...current, locale: 'en' } })).status).toBe(202);
    expect(await db.userLegalAcceptance.count({ where: { userId: user.id } })).toBe(2);
  });

  it('L02 no acceptance is inferred or backfilled for an account created before K02', async () => {
    // The seeker fixture predates K02 semantics: it was inserted directly.
    expect(await h.fixture.db.userLegalAcceptance.count({ where: { userId: S.user } })).toBe(0);
  });

  it('K01 the Saudi market initializer is audited, idempotent and never overwrites silently', async () => {
    const db = h.fixture.db;
    const KEY_NAME = 'platform_supported_markets';
    const original = await db.platformSetting.findUnique({ where: { key: KEY_NAME } });
    const runner = new PrismaClient({ log: [] });
    try {
      await db.platformSetting.deleteMany({ where: { key: KEY_NAME } });
      const historyBefore = await db.platformSettingHistory.count({ where: { key: KEY_NAME } });
      const first = await initSaudiLaunchMarket(runner);
      expect(first.outcome).toBe('CREATED');
      const second = await initSaudiLaunchMarket(runner);
      expect(second.outcome).toBe('UNCHANGED');
      expect(await db.platformSettingHistory.count({ where: { key: KEY_NAME } })).toBe(
        historyBefore + 1,
      );
      const audit = await db.auditEvent.findFirst({
        where: {
          type: 'ADMIN_SETTING_UPDATED',
          metadata: { path: ['actorSystem'], equals: 'operator-cli:market-init-ksa' },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      // The API reads it back as the only enabled market.
      const markets = await provider.request<{ markets: Array<{ countryCode: string }> }>(
        '/v1/me/provider/onboarding/markets',
      );
      expect(markets.status).toBe(200);
      expect(markets.body.markets.map((m) => m.countryCode)).toEqual(['SA']);

      await db.platformSetting.update({
        where: { key: KEY_NAME },
        data: { value: [{ countryCode: 'SY', enabled: true, displayNameKey: 'market.SY' }] },
      });
      const refused = await initSaudiLaunchMarket(runner);
      expect(refused).toEqual(
        expect.objectContaining({ outcome: 'REFUSED_DIFFERENT', previousCountryCodes: ['SY'] }),
      );
      const replaced = await initSaudiLaunchMarket(runner, { replace: true });
      expect(replaced.outcome).toBe('REPLACED');
    } finally {
      await runner.$disconnect();
      if (original) {
        await db.platformSetting.upsert({
          where: { key: KEY_NAME },
          create: { key: KEY_NAME, value: original.value as object },
          update: { value: original.value as object },
        });
      }
    }
  });
});
