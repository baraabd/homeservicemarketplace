/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma requires: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 * `any` on the Prisma and HTTP handles for the same reason.
 */

export {};

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// R11 — customer reviews and provider reputation, THROUGH THE REAL HTTP PATH,
// against real Postgres.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// A seeker reviews the provider of ONE of their COMPLETED bookings, once, and
// the review is final. The provider's rating and review count are recomputed
// from the PUBLISHED reviews in the transaction that changes one; the
// completed-jobs count is recomputed from COMPLETED bookings in the
// transaction that completes one. An administrator may hide or restore a
// review.
//
// Bookings are arranged directly in the database: what is under test is the
// review, not how a booking came to exist. Where completion itself matters
// (the race), the real provider booking service performs it.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // A request may name its own user, so two requests in flight at once can
    // belong to two people. Otherwise the suite's current user applies.
    const named = req.headers['x-test-user'];
    const user = typeof named === 'string' ? { id: named } : currentUser;
    if (!user) return false;
    req.user = user;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('R11 - booking reviews and provider reputation (real HTTP, real Postgres)', () => {
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let providerBookings: any;
  let locks: HeldLock | undefined;

  const P = fixturePrefix('r11rev');
  const SEEKER = `${P}seeker`;
  const OTHER_SEEKER = `${P}other-seeker`;
  const PROVIDER_USER = `${P}provider-user`;
  const PROVIDER = `${P}provider`;
  const OTHER_PROVIDER_USER = `${P}other-provider-user`;
  const OTHER_PROVIDER = `${P}other-provider`;
  // A person who is both the seeker and the provider of one booking.
  const DUAL_USER = `${P}dual-user`;
  const DUAL_PROVIDER = `${P}dual-provider`;
  const ADMIN = `${P}admin`;
  const SECOND_ADMIN = `${P}admin-two`;
  const USERS = [
    SEEKER,
    OTHER_SEEKER,
    PROVIDER_USER,
    OTHER_PROVIDER_USER,
    DUAL_USER,
    ADMIN,
    SECOND_ADMIN,
  ];
  const PROFILES = [
    [PROVIDER, PROVIDER_USER],
    [OTHER_PROVIDER, OTHER_PROVIDER_USER],
    [DUAL_PROVIDER, DUAL_USER],
  ] as const;

  const as = (userId: string | null) => {
    currentUser = userId ? { id: userId } : null;
  };
  const reviewUrl = (bookingId: string) => `/v1/me/bookings/${bookingId}/review`;
  const submit = (bookingId: string, body: Record<string, unknown>) =>
    request(http).post(reviewUrl(bookingId)).send(body);
  const status = (bookingId: string) => request(http).get(reviewUrl(bookingId));
  const reason = (res: { body: { error?: { details?: { reason?: string } } } }) =>
    res.body.error?.details?.reason;

  /** A booking, arranged directly. */
  async function booking(
    bookingStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
    over: { seeker?: string; provider?: string; deleted?: boolean } = {},
  ): Promise<string> {
    const id = `${P}b-${randomUUID()}`;
    const seekerUserId = over.seeker ?? SEEKER;
    const providerId = over.provider ?? PROVIDER;
    await prisma.serviceRequest.create({
      data: {
        id: `${id}-request`,
        seekerUserId,
        scheduleType: 'ASAP',
        addressSnapshot: {},
        status: 'BID_ACCEPTED',
      },
    });
    await prisma.bid.create({
      data: {
        id: `${id}-bid`,
        requestId: `${id}-request`,
        providerId,
        amount: 100,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await prisma.booking.create({
      data: {
        id,
        requestId: `${id}-request`,
        bidId: `${id}-bid`,
        seekerUserId,
        providerId,
        priceAmount: 100,
        status: bookingStatus,
        ...(over.deleted ? { deletedAt: new Date() } : {}),
      },
    });
    return id;
  }

  const reviewOf = (bookingId: string) => prisma.bookingReview.findUnique({ where: { bookingId } });
  const reviewsOf = (bookingId: string) => prisma.bookingReview.count({ where: { bookingId } });
  async function reputation(providerId = PROVIDER) {
    const row = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { ratingAvg: true, reviewCount: true, completedJobs: true },
    });
    return row as { ratingAvg: number; reviewCount: number; completedJobs: number };
  }
  /** The same numbers, computed independently from the source rows. */
  async function reconciled(providerId = PROVIDER) {
    const [stats] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n, COALESCE(sum("rating"), 0)::int AS total
         FROM "BookingReview" WHERE "providerId" = $1 AND "state" = 'PUBLISHED'`,
      providerId,
    );
    const [jobs] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Booking"
        WHERE "providerId" = $1 AND "status" = 'COMPLETED' AND "deletedAt" IS NULL`,
      providerId,
    );
    return {
      reviewCount: stats.n as number,
      ratingAvg: stats.n === 0 ? 0 : stats.total / stats.n,
      completedJobs: jobs.n as number,
    };
  }
  async function expectReconciled(providerId = PROVIDER): Promise<void> {
    const stored = await reputation(providerId);
    const truth = await reconciled(providerId);
    expect(stored.reviewCount).toBe(truth.reviewCount);
    expect(stored.ratingAvg).toBeCloseTo(truth.ratingAvg, 10);
  }
  const auditOf = (type: string, userId: string) =>
    prisma.auditEvent.findMany({ where: { type, userId }, orderBy: { createdAt: 'asc' } });

  /** Remove this suite's reviews and bookings, and put reputation back. */
  async function clearBookings(): Promise<void> {
    await prisma.bookingReview.deleteMany({ where: { bookingId: { startsWith: P } } });
    await prisma.bookingEvent.deleteMany({ where: { bookingId: { startsWith: P } } });
    await prisma.booking.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.bid.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.updateMany({
      where: { id: { startsWith: P } },
      data: { ratingAvg: 0, reviewCount: 0, completedJobs: 0 },
    });
  }
  async function wipe(): Promise<void> {
    await clearBookings();
    await prisma.notification.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma, isReady: () => true };

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      BookingReviewRepository,
    } = require('../../src/infrastructure/persistence/reviews/booking-review.repository');
    const {
      BookingRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking.repository');
    const {
      BookingEventRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking-event.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      ProviderBookingsService,
    } = require('../../src/modules/provider/bookings/provider-bookings.service');
    const { BookingReviewsService } = require('../../src/modules/reviews/booking-reviews.service');
    const { AdminReviewsService } = require('../../src/modules/reviews/admin-reviews.service');
    const {
      AdminReviewsController,
      BookingReviewsController,
    } = require('../../src/modules/reviews/reviews.controllers');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const {
      PermissionsGuard,
    } = require('../../src/modules/iam/authorization/guards/permissions.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');

    const FLAGS: Record<string, unknown> = { JWT_ACCESS_SECRET: makeTestSecret('r11-reviews') };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };
    // The moderation service asks the DATABASE for permissions on every call
    // (`resolveFreshForUser`); the cache is never consulted on that path.
    const noRedis = {
      getClient: () => {
        throw new Error('R11 cases must not read the permission cache');
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BookingReviewsController, AdminReviewsController],
      providers: [
        BookingReviewsService,
        AdminReviewsService,
        BookingReviewRepository,
        RoleRepository,
        PermissionResolverService,
        AuditService,
        AuditEventRepository,
        TransactionRunner,
        Reflector,
        { provide: PrismaService, useValue: prismaSvc },
        { provide: AppConfigService, useValue: config },
        { provide: RedisService, useValue: noRedis },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      // The role and permission GUARDS are replaced; the moderation service's
      // own permission check, read from the database, is what is under test.
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    // The real completion, for the races.
    const realtime = new Proxy({}, { get: () => () => undefined });
    providerBookings = new ProviderBookingsService(
      new ProviderProfileRepository(prismaSvc),
      new BookingRepository(prismaSvc),
      new BookingEventRepository(prismaSvc),
      new NotificationsService(new NotificationRepository(prismaSvc), realtime),
      new TransactionRunner(prismaSvc),
      realtime,
    );

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r11rev.test`,
          firstName: 'R11',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    for (const [id, userId] of PROFILES) {
      await prisma.providerProfile.create({
        data: { id, userId, displayName: `R11 ${id}`, initials: 'R1', status: 'ACTIVE' },
      });
    }
    // The seeded admin role carries the review permissions. Only ADMIN holds
    // it; SECOND_ADMIN is given it where a test needs two moderators.
    const adminRole = await prisma.role.findUnique({
      where: { name: 'admin' },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const keys = (adminRole?.rolePermissions ?? []).map((g: any) => g.permission.key);
    if (!keys.includes('reviews:moderate') || !keys.includes('reviews:read')) {
      throw new Error(
        'The admin role lacks reviews:read / reviews:moderate. Run the seed before this suite.',
      );
    }
    for (const userId of [ADMIN, SECOND_ADMIN]) {
      await prisma.userRole.create({ data: { userId, roleId: adminRole.id } });
    }
  });

  afterAll(async () => {
    try {
      if (prisma) await wipe();
    } finally {
      try {
        await app?.close();
      } finally {
        currentUser = null;
        await locks?.release();
      }
    }
  });

  beforeEach(async () => {
    await clearBookings();
    await prisma.auditEvent.deleteMany({ where: { userId: { in: USERS } } });
    as(SEEKER);
  });

  // ── creation and read-back ──────────────────────────────────────────────

  describe('a completed booking is reviewed once, and read back', () => {
    it('creates one review bound to the booking, its seeker and its provider', async () => {
      const id = await booking('COMPLETED');
      expect((await status(id)).body).toEqual({
        bookingId: id,
        eligibility: 'ELIGIBLE',
        review: null,
      });

      const res = await submit(id, { rating: 4, comment: '  Careful and on time.  ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        replayed: false,
        review: {
          id: expect.any(String),
          bookingId: id,
          rating: 4,
          comment: 'Careful and on time.',
          state: 'PUBLISHED',
          createdAt: expect.any(String),
        },
      });

      // The row: the author and the reviewed provider are the BOOKING's.
      expect(await reviewOf(id)).toMatchObject({
        id: res.body.review.id,
        bookingId: id,
        seekerUserId: SEEKER,
        providerId: PROVIDER,
        rating: 4,
        comment: 'Careful and on time.',
        state: 'PUBLISHED',
      });
      expect(await reputation()).toMatchObject({ ratingAvg: 4, reviewCount: 1 });

      // Read back, as a reload does.
      expect((await status(id)).body).toEqual({
        bookingId: id,
        eligibility: 'ALREADY_REVIEWED',
        review: res.body.review,
      });
    });

    it('records an audit row that names the review and carries neither the rating nor the comment', async () => {
      const id = await booking('COMPLETED');
      const res = await submit(id, { rating: 2, comment: 'private words' });
      const [audit] = await auditOf('BOOKING_REVIEW_SUBMITTED', SEEKER);
      expect(audit.metadata).toEqual({
        reviewId: res.body.review.id,
        bookingId: id,
        providerProfileId: PROVIDER,
      });
      expect(JSON.stringify(audit)).not.toContain('private words');
    });

    it('accepts a review with no comment, and stores an empty or blank comment as none', async () => {
      for (const comment of [undefined, null, '', '   \n\t ']) {
        const id = await booking('COMPLETED');
        const res = await submit(
          id,
          comment === undefined ? { rating: 5 } : { rating: 5, comment },
        );
        expect([String(comment), res.status]).toEqual([String(comment), 201]);
        expect((await reviewOf(id)).comment).toBeNull();
      }
    });

    it('stores Arabic, mixed and emoji text exactly, and markup as inert text', async () => {
      const comments = [
        'عمل ممتاز وفي الوقت المحدد',
        'ممتاز — excellent work, جداً 👍🏽',
        '<script>alert(1)</script> <img src=x onerror=alert(2)> https://example.invalid/x',
      ];
      for (const comment of comments) {
        const id = await booking('COMPLETED');
        const res = await submit(id, { rating: 5, comment });
        expect(res.status).toBe(201);
        expect(res.body.review.comment).toBe(comment);
        expect((await reviewOf(id)).comment).toBe(comment);
      }
    });

    it('accepts a comment at the limit and refuses one character more', async () => {
      const atLimit = await booking('COMPLETED');
      const ok = await submit(atLimit, { rating: 3, comment: 'ن'.repeat(1000) });
      expect(ok.status).toBe(201);
      expect([...(await reviewOf(atLimit)).comment]).toHaveLength(1000);

      const over = await booking('COMPLETED');
      const refused = await submit(over, { rating: 3, comment: 'ن'.repeat(1001) });
      expect(refused.status).toBe(400);
      expect(reason(refused)).toBe('COMMENT_TOO_LONG');
      expect(await reviewsOf(over)).toBe(0);
    });

    it.each([
      ['zero', 0],
      ['six', 6],
      ['a negative number', -1],
      ['a half star', 3.5],
      ['text', 'five'],
      ['a numeric string', '5'],
      ['null', null],
      ['nothing', undefined],
    ])('REFUSES a rating of %s and stores nothing', async (_label, rating) => {
      const id = await booking('COMPLETED');
      const res = await submit(id, rating === undefined ? { comment: 'x' } : { rating });
      expect(res.status).toBe(400);
      expect(await reviewsOf(id)).toBe(0);
      expect(await reputation()).toMatchObject({ ratingAvg: 0, reviewCount: 0 });
    });
  });

  // ── who may review what ─────────────────────────────────────────────────

  describe('eligibility and identity are the server’s', () => {
    it.each(['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'] as const)(
      'REFUSES a review of a %s booking',
      async (bookingStatus) => {
        const id = await booking(bookingStatus);
        expect((await status(id)).body.eligibility).toBe('BOOKING_NOT_COMPLETED');
        const res = await submit(id, { rating: 5 });
        expect(res.status).toBe(409);
        expect(reason(res)).toBe('BOOKING_NOT_COMPLETED');
        expect(await reviewsOf(id)).toBe(0);
        expect(await reputation()).toMatchObject({ ratingAvg: 0, reviewCount: 0 });
      },
    );

    it('answers another seeker’s booking exactly as it answers a booking that does not exist', async () => {
      const id = await booking('COMPLETED');
      as(OTHER_SEEKER);
      const foreign = await submit(id, { rating: 1, comment: 'not mine' });
      const missing = await submit(`${P}no-such-booking`, { rating: 1, comment: 'not mine' });
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      const scrub = (body: any) => ({ ...body.error, requestId: undefined });
      expect(scrub(foreign.body)).toEqual(scrub(missing.body));

      // Reading is refused the same way.
      expect((await status(id)).status).toBe(404);
      expect(await reviewsOf(id)).toBe(0);

      // The owner's review, once written, is not readable by anyone else.
      as(SEEKER);
      await submit(id, { rating: 5, comment: 'owner only' });
      as(OTHER_SEEKER);
      const peek = await status(id);
      expect(peek.status).toBe(404);
      expect(JSON.stringify(peek.body)).not.toContain('owner only');
    });

    it('does not let the reviewed provider write or read the review of their own booking', async () => {
      const id = await booking('COMPLETED');
      as(PROVIDER_USER);
      expect((await submit(id, { rating: 5 })).status).toBe(404);
      expect((await status(id)).status).toBe(404);
      expect(await reviewsOf(id)).toBe(0);
    });

    it('treats a request id as no booking at all', async () => {
      const id = await booking('COMPLETED');
      const res = await submit(`${id}-request`, { rating: 5 });
      expect(res.status).toBe(404);
      expect(await reviewsOf(id)).toBe(0);
    });

    it('does not find a deleted booking', async () => {
      const id = await booking('COMPLETED', { deleted: true });
      expect((await submit(id, { rating: 5 })).status).toBe(404);
      expect(await reviewsOf(id)).toBe(0);
    });

    it('REFUSES a review of one’s own work, even where such a booking exists', async () => {
      const id = await booking('COMPLETED', { seeker: DUAL_USER, provider: DUAL_PROVIDER });
      as(DUAL_USER);
      const res = await submit(id, { rating: 5, comment: 'I was great' });
      expect(res.status).toBe(403);
      expect(reason(res)).toBe('SELF_REVIEW');
      expect(await reviewsOf(id)).toBe(0);
      expect(await reputation(DUAL_PROVIDER)).toMatchObject({ ratingAvg: 0, reviewCount: 0 });
    });

    it.each([
      ['a reviewer', { seekerUserId: 'someone-else' }],
      ['a provider', { providerId: 'someone-else' }],
      ['a booking', { bookingId: 'another-booking' }],
      ['a state', { state: 'PUBLISHED' }],
      ['a timestamp', { createdAt: '2020-01-01T00:00:00Z' }],
      ['an aggregate', { ratingAvg: 5, reviewCount: 999 }],
    ])('REFUSES a body that names %s', async (_label, forged) => {
      const id = await booking('COMPLETED');
      const res = await submit(id, { rating: 5, ...forged });
      expect(res.status).toBe(400);
      expect(await reviewsOf(id)).toBe(0);
    });

    it('refuses a request with no signed-in user', async () => {
      const id = await booking('COMPLETED');
      as(null);
      expect((await submit(id, { rating: 5 })).status).toBe(403);
      expect((await status(id)).status).toBe(403);
      expect(await reviewsOf(id)).toBe(0);
    });

    it('a review completes nothing, approves nothing and changes no booking', async () => {
      const id = await booking('COMPLETED');
      const before = await prisma.booking.findUnique({ where: { id } });
      const provider = await prisma.providerProfile.findUnique({ where: { id: PROVIDER } });
      await submit(id, { rating: 5 });
      expect(await prisma.booking.findUnique({ where: { id } })).toEqual(before);
      const after = await prisma.providerProfile.findUnique({ where: { id: PROVIDER } });
      // Only the two reputation columns moved.
      expect({ ...after, ratingAvg: 0, reviewCount: 0, updatedAt: null }).toEqual({
        ...provider,
        ratingAvg: 0,
        reviewCount: 0,
        updatedAt: null,
      });
    });
  });

  // ── one review, however often it is sent ────────────────────────────────

  describe('repeated submission', () => {
    it('answers the same review again with the saved one, and counts it once', async () => {
      const id = await booking('COMPLETED');
      const first = await submit(id, { rating: 4, comment: 'Good' });
      const again = await submit(id, { rating: 4, comment: '  Good ' });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ replayed: true, review: first.body.review });
      expect(await reviewsOf(id)).toBe(1);
      expect(await reputation()).toMatchObject({ ratingAvg: 4, reviewCount: 1 });
      expect(await auditOf('BOOKING_REVIEW_SUBMITTED', SEEKER)).toHaveLength(1);
    });

    it('treats the same text in another Unicode form as the same review', async () => {
      const id = await booking('COMPLETED');
      const composed = 'café';
      const decomposed = 'café';
      expect(composed).not.toBe(decomposed);
      expect((await submit(id, { rating: 5, comment: decomposed })).status).toBe(201);
      const again = await submit(id, { rating: 5, comment: composed });
      expect(again.status).toBe(200);
      expect((await reviewOf(id)).comment).toBe(composed);
    });

    it.each([
      ['a different rating', { rating: 1, comment: 'Good' }],
      ['a different comment', { rating: 4, comment: 'Changed my mind' }],
      ['a removed comment', { rating: 4 }],
    ])('REFUSES %s: a review is final', async (_label, second) => {
      const id = await booking('COMPLETED');
      const first = await submit(id, { rating: 4, comment: 'Good' });
      const before = await reviewOf(id);

      const res = await submit(id, second);
      expect(res.status).toBe(409);
      expect(reason(res)).toBe('REVIEW_ALREADY_SUBMITTED');
      expect(await reviewOf(id)).toEqual(before);
      expect((await status(id)).body.review).toEqual(first.body.review);
      expect(await reputation()).toMatchObject({ ratingAvg: 4, reviewCount: 1 });
    });

    it('eight identical submissions at once: one review, one contribution', async () => {
      for (let round = 0; round < 4; round += 1) {
        await clearBookings();
        const id = await booking('COMPLETED');
        const results = await Promise.all(
          Array.from({ length: 8 }, () => submit(id, { rating: 3, comment: 'same' })),
        );
        const statuses = results.map((r) => r.status).sort();
        expect([round, statuses]).toEqual([round, [200, 200, 200, 200, 200, 200, 200, 201]]);
        const ids = new Set(results.map((r) => r.body.review.id));
        expect(ids.size).toBe(1);
        expect(await reviewsOf(id)).toBe(1);
        expect(await reputation()).toMatchObject({ ratingAvg: 3, reviewCount: 1 });
      }
    });

    it('two different submissions at once: one is saved whole, the other is refused', async () => {
      for (let round = 0; round < 8; round += 1) {
        await clearBookings();
        const id = await booking('COMPLETED');
        const [a, b] = await Promise.all([
          submit(id, { rating: 5, comment: 'from tab A' }),
          submit(id, { rating: 1, comment: 'from tab B' }),
        ]);
        expect([round, [a.status, b.status].sort()]).toEqual([round, [201, 409]]);
        const winner =
          a.status === 201
            ? { rating: 5, comment: 'from tab A' }
            : { rating: 1, comment: 'from tab B' };
        expect(await reviewOf(id)).toMatchObject(winner);
        expect(await reviewsOf(id)).toBe(1);
        expect(await reputation()).toMatchObject({ ratingAvg: winner.rating, reviewCount: 1 });
      }
    });

    it('PostgreSQL itself refuses a second review, a rating out of range and a review of someone else’s booking', async () => {
      const id = await booking('COMPLETED');
      const other = await booking('COMPLETED');
      const row = (over: Record<string, unknown> = {}) => ({
        bookingId: id,
        seekerUserId: SEEKER,
        providerId: PROVIDER,
        rating: 5,
        ...over,
      });
      await prisma.bookingReview.create({ data: row() });
      // The unique index.
      await expect(prisma.bookingReview.create({ data: row() })).rejects.toMatchObject({
        code: 'P2002',
      });
      // The rating CHECK.
      await expect(
        prisma.bookingReview.create({ data: row({ bookingId: other, rating: 6 }) }),
      ).rejects.toThrow();
      // The composite foreign key: the author and the provider are the booking's.
      await expect(
        prisma.bookingReview.create({
          data: row({ bookingId: other, seekerUserId: OTHER_SEEKER }),
        }),
      ).rejects.toThrow();
      await expect(
        prisma.bookingReview.create({
          data: row({ bookingId: other, providerId: OTHER_PROVIDER }),
        }),
      ).rejects.toThrow();
      expect(await reviewsOf(other)).toBe(0);
    });
  });

  // ── reputation ──────────────────────────────────────────────────────────

  describe('reputation is what the source rows say', () => {
    it('a provider with no reviews has no rating, not a made-up one', async () => {
      expect(await reputation()).toEqual({ ratingAvg: 0, reviewCount: 0, completedJobs: 0 });
      expect(await reconciled()).toEqual({ ratingAvg: 0, reviewCount: 0, completedJobs: 0 });
    });

    it('is the exact mean of whole-star ratings, not an average of rounded averages', async () => {
      const ratings = [5, 4, 4, 3, 5, 1, 2];
      for (const rating of ratings) {
        const id = await booking('COMPLETED');
        expect((await submit(id, { rating })).status).toBe(201);
      }
      const stored = await reputation();
      expect(stored.reviewCount).toBe(ratings.length);
      expect(stored.ratingAvg).toBeCloseTo(24 / 7, 12);
      await expectReconciled();
    });

    it('twelve reviews of twelve bookings at once lose no contribution', async () => {
      for (let round = 0; round < 3; round += 1) {
        await clearBookings();
        const ratings = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5, 5];
        const ids = await Promise.all(ratings.map(() => booking('COMPLETED')));
        const results = await Promise.all(ids.map((id, i) => submit(id, { rating: ratings[i] })));
        expect(results.map((r) => r.status)).toEqual(ratings.map(() => 201));
        const stored = await reputation();
        expect([round, stored.reviewCount]).toEqual([round, 12]);
        expect(stored.ratingAvg).toBeCloseTo(40 / 12, 12);
        await expectReconciled();
      }
    });

    it('keeps two providers apart', async () => {
      const mine = await booking('COMPLETED');
      const theirs = await booking('COMPLETED', { provider: OTHER_PROVIDER });
      await submit(mine, { rating: 5 });
      await submit(theirs, { rating: 1 });
      expect(await reputation(PROVIDER)).toMatchObject({ ratingAvg: 5, reviewCount: 1 });
      expect(await reputation(OTHER_PROVIDER)).toMatchObject({ ratingAvg: 1, reviewCount: 1 });
    });

    it('rolls the review back when the reputation write fails, and leaves no audit row', async () => {
      const id = await booking('COMPLETED');
      // A real database failure after the review has been inserted: the
      // provider row cannot be updated. Scoped to this suite's provider.
      const fn = `r11_refuse_reputation_${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$
           BEGIN RAISE EXCEPTION 'r11 simulated reputation failure'; END;
         $$ LANGUAGE plpgsql`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${fn}" BEFORE UPDATE ON "ProviderProfile"
           FOR EACH ROW WHEN (NEW."id" = '${PROVIDER}') EXECUTE FUNCTION "${fn}"()`,
      );
      try {
        const res = await submit(id, { rating: 5, comment: 'must not survive' });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('r11 simulated');
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "ProviderProfile"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
      }
      // No review without its contribution, and no record of one.
      expect(await reviewsOf(id)).toBe(0);
      expect(await reputation()).toMatchObject({ ratingAvg: 0, reviewCount: 0 });
      expect(await auditOf('BOOKING_REVIEW_SUBMITTED', SEEKER)).toHaveLength(0);
      expect((await status(id)).body.eligibility).toBe('ELIGIBLE');

      // The same review is accepted once the database is well again.
      expect((await submit(id, { rating: 5, comment: 'must not survive' })).status).toBe(201);
      await expectReconciled();
    });
  });

  // ── the booking lifecycle ───────────────────────────────────────────────

  describe('completion and review', () => {
    it('a review racing the completion of its booking is all or nothing', async () => {
      let reviewedInRace = 0;
      for (let round = 0; round < 10; round += 1) {
        const id = await booking('IN_PROGRESS');
        const [completion, review] = await Promise.all([
          providerBookings.complete(PROVIDER_USER, id).then(
            () => 'completed',
            (e: any) => e,
          ),
          submit(id, { rating: 4 }),
        ]);
        expect(completion).toBe('completed');
        expect((await prisma.booking.findUnique({ where: { id } })).status).toBe('COMPLETED');

        // Either the review saw a COMPLETED booking and exists, or it saw one
        // that was not yet completed and does not. Never a review that was
        // refused, and never a refusal that left a row.
        if (review.status === 201) {
          reviewedInRace += 1;
          expect(await reviewsOf(id)).toBe(1);
        } else {
          expect([round, review.status, reason(review)]).toEqual([
            round,
            409,
            'BOOKING_NOT_COMPLETED',
          ]);
          expect(await reviewsOf(id)).toBe(0);
          // And it can be reviewed now.
          expect((await submit(id, { rating: 4 })).status).toBe(201);
        }
        await expectReconciled();
      }
      const stored = await reputation();
      expect(stored.reviewCount).toBe(10);
      expect(stored.completedJobs).toBe(10);
      // Recorded, not asserted: how often the review won the race.
      expect(reviewedInRace).toBeGreaterThanOrEqual(0);
    });

    it('six bookings completed at once count as six jobs', async () => {
      for (let round = 0; round < 3; round += 1) {
        await clearBookings();
        const ids = await Promise.all(Array.from({ length: 6 }, () => booking('IN_PROGRESS')));
        await Promise.all(ids.map((id) => providerBookings.complete(PROVIDER_USER, id)));
        expect([round, (await reputation()).completedJobs]).toEqual([round, 6]);
        expect((await reconciled()).completedJobs).toBe(6);
      }
    });

    it('a cancelled or unfinished booking is not a completed job', async () => {
      await booking('SCHEDULED');
      await booking('CANCELLED');
      const active = await booking('IN_PROGRESS');
      await providerBookings.complete(PROVIDER_USER, active);
      expect((await reputation()).completedJobs).toBe(1);
    });

    it('a reviewed booking cannot be deleted from under its review', async () => {
      const id = await booking('COMPLETED');
      await submit(id, { rating: 5 });
      await expect(prisma.booking.delete({ where: { id } })).rejects.toThrow();
      // Nor through the cascade from its request.
      await expect(
        prisma.serviceRequest.delete({ where: { id: `${id}-request` } }),
      ).rejects.toThrow();
      expect(await reviewsOf(id)).toBe(1);
    });
  });

  // ── moderation ──────────────────────────────────────────────────────────

  describe('an administrator may hide and restore a review', () => {
    const REASON = 'Contains a private phone number.';
    const hide = (reviewId: string, body: Record<string, unknown> = { reason: REASON }) =>
      request(http).post(`/v1/admin/reviews/${reviewId}/hide`).send(body);
    const restore = (reviewId: string, body: Record<string, unknown> = { reason: REASON }) =>
      request(http).post(`/v1/admin/reviews/${reviewId}/restore`).send(body);
    const list = (query = '') => request(http).get(`/v1/admin/reviews${query}`);

    async function threeReviews(): Promise<string[]> {
      const ids: string[] = [];
      for (const rating of [5, 5, 2]) {
        const id = await booking('COMPLETED');
        ids.push((await submit(id, { rating, comment: `rated ${rating}` })).body.review.id);
      }
      return ids;
    }

    it('a hidden review stops counting, is kept, and is audited with its reason', async () => {
      const [, , low] = await threeReviews();
      expect(await reputation()).toMatchObject({ ratingAvg: 4, reviewCount: 3 });

      as(ADMIN);
      const res = await hide(low);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: low,
        state: 'HIDDEN',
        moderationReason: REASON,
        providerProfileId: PROVIDER,
        authorUserId: SEEKER,
        rating: 2,
        comment: 'rated 2',
      });

      expect(await reputation()).toMatchObject({ ratingAvg: 5, reviewCount: 2 });
      await expectReconciled();
      // Kept, with its original content.
      expect(await prisma.bookingReview.findUnique({ where: { id: low } })).toMatchObject({
        state: 'HIDDEN',
        rating: 2,
        comment: 'rated 2',
        hiddenByUserId: ADMIN,
        moderationReason: REASON,
      });
      const [audit] = await auditOf('ADMIN_REVIEW_HIDDEN', ADMIN);
      expect(audit.metadata).toMatchObject({
        reviewId: low,
        providerProfileId: PROVIDER,
        previousState: 'PUBLISHED',
        newState: 'HIDDEN',
        reason: REASON,
      });
    });

    it('a restored review counts again', async () => {
      const [, , low] = await threeReviews();
      as(ADMIN);
      await hide(low);
      const res = await restore(low, {
        reason: 'Hidden by mistake; the number is the business line.',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        state: 'PUBLISHED',
        hiddenAt: null,
        moderationReason: null,
      });
      expect(await reputation()).toMatchObject({ ratingAvg: 4, reviewCount: 3 });
      await expectReconciled();
      expect(await auditOf('ADMIN_REVIEW_RESTORED', ADMIN)).toHaveLength(1);
    });

    it('the author still sees their review, marked hidden, and still cannot write another', async () => {
      const id = await booking('COMPLETED');
      const mine = (await submit(id, { rating: 1, comment: 'bad' })).body.review;
      as(ADMIN);
      await hide(mine.id);

      as(SEEKER);
      const view = (await status(id)).body;
      expect(view.eligibility).toBe('ALREADY_REVIEWED');
      expect(view.review).toEqual({ ...mine, state: 'HIDDEN' });
      // Nothing about who hid it or why reaches the author's view.
      expect(JSON.stringify(view)).not.toContain(REASON);
      expect(JSON.stringify(view)).not.toContain(ADMIN);

      const again = await submit(id, { rating: 5, comment: 'good now' });
      expect(again.status).toBe(409);
      expect(await reviewsOf(id)).toBe(1);
      expect(await reputation()).toMatchObject({ ratingAvg: 0, reviewCount: 0 });
    });

    it.each([
      ['hide something already hidden', 'hide', 'hide'],
      ['restore something not hidden', 'restore', null],
    ] as const)('REFUSES to %s', async (_label, action, first) => {
      const id = await booking('COMPLETED');
      const reviewId = (await submit(id, { rating: 3 })).body.review.id;
      as(ADMIN);
      if (first) expect((await hide(reviewId)).status).toBe(200);
      const before = await reputation();
      const res = action === 'hide' ? await hide(reviewId) : await restore(reviewId);
      expect(res.status).toBe(409);
      expect(reason(res)).toBe('REVIEW_STATE_CHANGED');
      expect(await reputation()).toEqual(before);
    });

    it('two administrators hiding one review at once: one action, one audit row', async () => {
      for (let round = 0; round < 6; round += 1) {
        await clearBookings();
        await prisma.auditEvent.deleteMany({ where: { userId: { in: USERS } } });
        as(SEEKER);
        const [, , low] = await threeReviews();
        as(ADMIN);
        const [a, b] = await Promise.all([hide(low), hide(low)]);
        expect([round, [a.status, b.status].sort()]).toEqual([round, [200, 409]]);
        expect(await reputation()).toMatchObject({ ratingAvg: 5, reviewCount: 2 });
        expect(await auditOf('ADMIN_REVIEW_HIDDEN', ADMIN)).toHaveLength(1);
      }
    });

    it('a hide racing a new review of the same provider leaves the right total', async () => {
      for (let round = 0; round < 6; round += 1) {
        await clearBookings();
        as(SEEKER);
        const [, , low] = await threeReviews();
        const fresh = await booking('COMPLETED');
        // Two people, at once: each request carries its own user.
        const [hidden, added] = await Promise.all([
          hide(low).set('x-test-user', ADMIN),
          submit(fresh, { rating: 5 }).set('x-test-user', SEEKER),
        ]);
        expect([hidden.status, added.status]).toEqual([200, 201]);
        // Three fives remain.
        expect([round, await reputation()]).toEqual([
          round,
          expect.objectContaining({ ratingAvg: 5, reviewCount: 3 }),
        ]);
        await expectReconciled();
      }
    });

    it.each([
      ['no reason', {}],
      ['a reason that says nothing', { reason: 'bad' }],
      ['a blank reason', { reason: '              ' }],
      ['an overlong reason', { reason: 'x'.repeat(501) }],
    ])('REFUSES to hide with %s', async (_label, body) => {
      const id = await booking('COMPLETED');
      const reviewId = (await submit(id, { rating: 3 })).body.review.id;
      as(ADMIN);
      expect((await hide(reviewId, body)).status).toBe(400);
      expect((await prisma.bookingReview.findUnique({ where: { id: reviewId } })).state).toBe(
        'PUBLISHED',
      );
    });

    it.each([
      ['the reviewed provider', PROVIDER_USER],
      ['the author', SEEKER],
      ['another seeker', OTHER_SEEKER],
    ])('REFUSES moderation by %s, who holds no permission', async (_label, actor) => {
      const id = await booking('COMPLETED');
      const reviewId = (await submit(id, { rating: 1, comment: 'harsh' })).body.review.id;
      as(actor);
      expect((await hide(reviewId)).status).toBe(403);
      expect((await list()).status).toBe(403);
      expect((await prisma.bookingReview.findUnique({ where: { id: reviewId } })).state).toBe(
        'PUBLISHED',
      );
      expect(await reputation()).toMatchObject({ ratingAvg: 1, reviewCount: 1 });
    });

    it('a permission withdrawn is withdrawn at once', async () => {
      const id = await booking('COMPLETED');
      const reviewId = (await submit(id, { rating: 3 })).body.review.id;
      const role = await prisma.role.findUnique({ where: { name: 'admin' } });
      await prisma.userRole.delete({
        where: { userId_roleId: { userId: SECOND_ADMIN, roleId: role.id } },
      });
      try {
        as(SECOND_ADMIN);
        expect((await hide(reviewId)).status).toBe(403);
      } finally {
        await prisma.userRole.create({ data: { userId: SECOND_ADMIN, roleId: role.id } });
      }
      expect((await hide(reviewId)).status).toBe(200);
    });

    it('lists reviews for moderation, filtered and paged, newest first', async () => {
      const ids = await threeReviews();
      const elsewhere = await booking('COMPLETED', { provider: OTHER_PROVIDER });
      await submit(elsewhere, { rating: 4 });
      as(ADMIN);
      await hide(ids[2]);

      const mine = await list(`?providerProfileId=${PROVIDER}&limit=2`);
      expect(mine.status).toBe(200);
      expect(mine.body.items).toHaveLength(2);
      expect(mine.body.nextCursor).toBe(mine.body.items[1].id);
      const rest = await list(
        `?providerProfileId=${PROVIDER}&limit=2&cursor=${mine.body.nextCursor}`,
      );
      expect(rest.body.items).toHaveLength(1);
      expect(rest.body.nextCursor).toBeNull();
      expect([...mine.body.items, ...rest.body.items].map((i: any) => i.id).sort()).toEqual(
        [...ids].sort(),
      );

      const hidden = await list(`?providerProfileId=${PROVIDER}&state=HIDDEN`);
      expect(hidden.body.items.map((i: any) => i.id)).toEqual([ids[2]]);
      // An allow-listed shape: no email, no address, no booking detail.
      expect(Object.keys(hidden.body.items[0]).sort()).toEqual([
        'authorUserId',
        'bookingId',
        'comment',
        'createdAt',
        'hiddenAt',
        'id',
        'moderationReason',
        'providerDisplayName',
        'providerProfileId',
        'rating',
        'state',
      ]);
      expect((await hide(`${P}no-such-review`)).status).toBe(404);
    });
  });
});
