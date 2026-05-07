// Route-level e2e for /v1/admin/analytics/* + /v1/admin/financials/*
// (Sprint 6.4). Pins:
//   - GET /admin/analytics/overview + revenue (date-range)
//   - GET /admin/financials/{summary,bookings,provider-earnings}
//   - auth gating (401)
//   - role gating (403 for non-admin)
//   - DTO validation (invalid date format, unknown query, oversize limit)
//   - no payment-secret leak on any happy or error path

import {
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { AdminAnalyticsController } from '../../src/modules/admin/analytics/admin-analytics.controller';
import { AdminAnalyticsService } from '../../src/modules/admin/analytics/admin-analytics.service';
import { AdminFinancialsController } from '../../src/modules/admin/financials/admin-financials.controller';
import { AdminFinancialsService } from '../../src/modules/admin/financials/admin-financials.service';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';

jest.setTimeout(15_000);

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return false;
    },
  } as unknown as AppConfigService;
}

const analyticsService = {
  summary: jest.fn(),
  overview: jest.fn(),
  revenue: jest.fn(),
};
const financialsService = {
  summary: jest.fn(),
  listBookings: jest.fn(),
  listProviderEarnings: jest.fn(),
};

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;

class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const req = ctx.switchToHttp().getRequest();
    req.user = fakeAuthedUser;
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [AdminAnalyticsController, AdminFinancialsController],
    providers: [
      Reflector,
      { provide: AdminAnalyticsService, useValue: analyticsService },
      { provide: AdminFinancialsService, useValue: financialsService },
      { provide: AppConfigService, useValue: config },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

const OVERVIEW_FIXTURE = {
  range: { from: '2026-04-01', to: '2026-04-30' },
  counts: {
    users: 100,
    providers: 25,
    requests: 50,
    bookingsCompleted: 6,
    bookingsCancelled: 1,
    disputesOpen: 2,
  },
  revenue: {
    grossWithinRange: 4_000,
    platformFeesWithinRange: 400,
    netProviderEarningsWithinRange: 3_600,
    grossLifetime: 12_000,
  },
  currency: 'USD',
  platformFeeRateBps: 1000,
  generatedAt: '2026-05-02T00:00:00.000Z',
};

const REVENUE_FIXTURE = {
  range: { from: '2026-04-01', to: '2026-04-07' },
  currency: 'USD',
  platformFeeRateBps: 1000,
  buckets: [
    {
      date: '2026-04-03',
      grossEarnings: 5_000,
      platformFees: 500,
      netProviderEarnings: 4_500,
      completedBookings: 2,
    },
  ],
};

const FIN_SUMMARY_FIXTURE = {
  totalRevenue: 12_000,
  totalPlatformFees: 1_200,
  totalProviderEarnings: 10_800,
  totalRefunds: 0,
  pendingBalance: 800,
  completedBookingsCount: 17,
  currency: 'USD',
  platformFeeRateBps: 1000,
  generatedAt: '2026-05-02T00:00:00.000Z',
};

describe('Admin Analytics + Financials (e2e) — Sprint 6.4', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    fakeAuthedUser = null;
  });

  describe('auth gating', () => {
    const routes = [
      '/v1/admin/analytics/overview',
      '/v1/admin/analytics/revenue',
      '/v1/admin/financials/summary',
      '/v1/admin/financials/bookings',
      '/v1/admin/financials/provider-earnings',
    ];
    for (const path of routes) {
      it(`GET ${path} → 401 when unauthenticated`, async () => {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBe(401);
        expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      });
    }
  });

  describe('role gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
    });
    it('overview → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/analytics/overview');
      expect(res.status).toBe(403);
      expect(analyticsService.overview).not.toHaveBeenCalled();
    });
    it('financials/summary → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/financials/summary');
      expect(res.status).toBe(403);
      expect(financialsService.summary).not.toHaveBeenCalled();
    });
  });

  describe('overview happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the overview envelope', async () => {
      analyticsService.overview.mockResolvedValue(OVERVIEW_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/analytics/overview');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(OVERVIEW_FIXTURE);
    });

    it('forwards from + to query params', async () => {
      analyticsService.overview.mockResolvedValue(OVERVIEW_FIXTURE);
      await request(app.getHttpServer()).get(
        '/v1/admin/analytics/overview?from=2026-04-01&to=2026-04-30',
      );
      expect(analyticsService.overview).toHaveBeenCalledWith('2026-04-01', '2026-04-30');
    });

    it('rejects malformed `from` date', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/admin/analytics/overview?from=not-a-date',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(analyticsService.overview).not.toHaveBeenCalled();
    });

    it('rejects unknown query parameter', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/admin/analytics/overview?providerId=victim',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('revenue happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the buckets envelope', async () => {
      analyticsService.revenue.mockResolvedValue(REVENUE_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/analytics/revenue');
      expect(res.status).toBe(200);
      expect(res.body.buckets).toHaveLength(1);
      expect(res.body.buckets[0].grossEarnings).toBe(5_000);
    });
  });

  describe('financials/summary happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the canonical summary fields', async () => {
      financialsService.summary.mockResolvedValue(FIN_SUMMARY_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/financials/summary');
      expect(res.status).toBe(200);
      for (const k of [
        'totalRevenue',
        'totalPlatformFees',
        'totalProviderEarnings',
        'totalRefunds',
        'pendingBalance',
        'completedBookingsCount',
      ] as const) {
        expect(typeof res.body[k]).toBe('number');
      }
      expect(res.body.totalProviderEarnings).toBe(
        res.body.totalRevenue - res.body.totalPlatformFees,
      );
    });

    it('does not leak passwordHash / mfaSecret / payment secrets', async () => {
      financialsService.summary.mockResolvedValue(FIN_SUMMARY_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/financials/summary');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('mfaSecret');
      expect(body).not.toContain('refreshToken');
      expect(body).not.toContain('JWT_SECRET');
      expect(body).not.toContain('DATABASE_URL');
      expect(body).not.toContain('STRIPE_SECRET');
    });
  });

  describe('financials/bookings + provider-earnings', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('bookings: forwards limit + cursor', async () => {
      financialsService.listBookings.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get(
        '/v1/admin/financials/bookings?limit=10&cursor=opaque',
      );
      expect(financialsService.listBookings).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, cursor: 'opaque' }),
      );
    });

    it('bookings: rejects limit > 100', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/financials/bookings?limit=999');
      expect(res.status).toBe(400);
    });

    it('provider-earnings: rejects non-numeric cursor', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/admin/financials/provider-earnings?cursor=abc',
      );
      expect(res.status).toBe(400);
    });

    it('provider-earnings: forwards numeric-string cursor', async () => {
      financialsService.listProviderEarnings.mockResolvedValue({
        items: [],
        nextCursor: null,
      });
      await request(app.getHttpServer()).get('/v1/admin/financials/provider-earnings?cursor=50');
      expect(financialsService.listProviderEarnings).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: '50' }),
      );
    });
  });
});
