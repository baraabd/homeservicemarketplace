// Route-level e2e for /v1/provider/earnings/* (Sprint 5.6 refined).
// Boots a minimal Nest app with only the ProviderEarningsController;
// the service is replaced with an in-test fake. Real HTTP stack
// (cookie-parser, ValidationPipe, exception filter) without booting
// Prisma. JwtAuthGuard, CsrfGuard, and ProviderCapabilityGuard are
// overridden with fakes; RolesGuard runs unchanged so the role-gate
// behaviour matches production.
//
// What these tests pin:
//   - GET endpoints are auth-gated (no session ⇒ 401)
//   - GET endpoints are role-gated (non-provider ⇒ 403)
//   - GET endpoints are gated by ProviderCapabilityGuard (non-ACTIVE ⇒ 403)
//   - DTO validation rejects unknown query parameters
//   - chart range validation rejects invalid values + defaults to 30d
//   - summary / transactions / chart wire shapes carry the canonical
//     fields (grossEarnings, platformFees, netEarnings, etc.)
//   - error bodies never leak Prisma / SQL / secret strings

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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
import { ProviderEarningsController } from '../../src/modules/provider/wallet/provider-earnings.controller';
import { ProviderEarningsService } from '../../src/modules/provider/wallet/provider-earnings.service';
import { ProviderCapabilityGuard } from '../../src/modules/provider/guards/provider-capability.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
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

const earningsService = {
  summary: jest.fn(),
  transactions: jest.fn(),
  chart: jest.fn(),
};

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;
let fakeProviderActive = true;

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

class FakeCsrfGuard {
  canActivate(): boolean {
    return true;
  }
}

class FakeProviderCapabilityGuard implements CanActivate {
  canActivate(): boolean {
    if (!fakeProviderActive) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [ProviderEarningsController],
    providers: [
      Reflector,
      { provide: ProviderEarningsService, useValue: earningsService },
      { provide: AppConfigService, useValue: config },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
    .overrideGuard(CsrfGuard)
    .useClass(FakeCsrfGuard)
    .overrideGuard(ProviderCapabilityGuard)
    .useClass(FakeProviderCapabilityGuard)
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

const SUMMARY_FIXTURE = {
  grossEarnings: 12_000,
  platformFees: 1_200,
  netEarnings: 10_800,
  availableBalance: 10_800,
  pendingBalance: 800,
  completedBookingsCount: 17,
  currency: 'USD',
  platformFeeRateBps: 1000,
  ratingAvg: 4.7,
  reviewCount: 23,
};

const TRANSACTION_FIXTURE = {
  id: 'bk-1',
  bookingId: 'bk-1',
  kind: 'BOOKING_COMPLETED' as const,
  amount: 4500,
  platformFee: 450,
  netAmount: 4050,
  currency: 'USD',
  occurredAt: '2026-05-02T10:00:00.000Z',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
  city: 'Riyadh',
};

const CHART_FIXTURE = {
  range: '30d' as const,
  windowStart: '2026-04-03T00:00:00.000Z',
  windowEnd: '2026-05-03T00:00:00.000Z',
  currency: 'USD',
  buckets: [
    {
      date: '2026-05-02',
      grossEarnings: 4500,
      platformFees: 450,
      netEarnings: 4050,
      completedBookings: 1,
    },
  ],
};

describe('ProviderEarningsController (e2e) — /v1/provider/earnings/*', () => {
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
    fakeProviderActive = true;
  });

  describe('auth gating', () => {
    it('GET /v1/provider/earnings/summary → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(earningsService.summary).not.toHaveBeenCalled();
    });

    it('GET /v1/provider/earnings/transactions → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/transactions');
      expect(res.status).toBe(401);
      expect(earningsService.transactions).not.toHaveBeenCalled();
    });

    it('GET /v1/provider/earnings/chart → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/chart');
      expect(res.status).toBe(401);
      expect(earningsService.chart).not.toHaveBeenCalled();
    });
  });

  describe('role gating', () => {
    it('summary → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      expect(res.status).toBe(403);
      expect(earningsService.summary).not.toHaveBeenCalled();
    });

    it('transactions → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/transactions');
      expect(res.status).toBe(403);
    });

    it('chart → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/chart');
      expect(res.status).toBe(403);
    });
  });

  describe('provider-active gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
      fakeProviderActive = false;
    });
    it('summary → 403 when provider profile is not ACTIVE', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      expect(res.status).toBe(403);
      expect(res.body?.error?.code).toBe('FORBIDDEN');
      expect(earningsService.summary).not.toHaveBeenCalled();
    });
  });

  describe('summary happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('returns the canonical EarningsSummary shape', async () => {
      earningsService.summary.mockResolvedValue(SUMMARY_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(SUMMARY_FIXTURE);
      expect(earningsService.summary).toHaveBeenCalledWith('user-prov-1');
    });

    it('every numeric earnings field is >= 0', async () => {
      earningsService.summary.mockResolvedValue(SUMMARY_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      for (const k of [
        'grossEarnings',
        'platformFees',
        'netEarnings',
        'availableBalance',
        'pendingBalance',
        'completedBookingsCount',
      ] as const) {
        expect(typeof res.body[k]).toBe('number');
        expect(res.body[k]).toBeGreaterThanOrEqual(0);
      }
    });

    it('a clean AppError does not leak prisma/SQL/secret strings', async () => {
      // The controller's only known failure mode is the service throwing
      // AppError('NOT_FOUND'). We pin that the response envelope carries
      // the structured shape the wire contract specifies, with no Prisma
      // / SQL / secret strings in the body. Generic-error redaction is
      // tested separately in exception-filter.e2e.spec.ts; here we only
      // need to confirm this controller doesn't smuggle anything in.
      const { AppError } = await import('../../src/shared/errors/app-error');
      earningsService.summary.mockRejectedValue(
        new AppError('NOT_FOUND', 'Provider profile not found.', 404),
      );
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/summary');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/PrismaClient|invocation|SELECT |INSERT |UPDATE /i);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('JWT_SECRET');
      expect(body).not.toContain('DATABASE_URL');
    });
  });

  describe('transactions happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('returns the items envelope with COMPLETED-only canonical rows', async () => {
      earningsService.transactions.mockResolvedValue({
        items: [TRANSACTION_FIXTURE],
        nextCursor: null,
      });
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/transactions');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual(TRANSACTION_FIXTURE);
      expect(res.body.nextCursor).toBeNull();
    });

    it('forwards the cursor query param', async () => {
      earningsService.transactions.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get(
        '/v1/provider/earnings/transactions?cursor=opaque-1&limit=10',
      );
      expect(earningsService.transactions).toHaveBeenCalledWith(
        'user-prov-1',
        expect.objectContaining({ cursor: 'opaque-1', limit: 10 }),
      );
    });

    it('rejects an unknown query parameter (IDOR vector closed)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/provider/earnings/transactions?providerId=victim',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(earningsService.transactions).not.toHaveBeenCalled();
    });

    it('rejects status filter (canonical endpoint is COMPLETED-only)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/provider/earnings/transactions?status=IN_PROGRESS',
      );
      expect(res.status).toBe(400);
      expect(earningsService.transactions).not.toHaveBeenCalled();
    });
  });

  describe('chart happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('defaults to range=30d when omitted', async () => {
      earningsService.chart.mockResolvedValue(CHART_FIXTURE);
      await request(app.getHttpServer()).get('/v1/provider/earnings/chart');
      expect(earningsService.chart).toHaveBeenCalledWith('user-prov-1', '30d');
    });

    it('honours an explicit range=7d', async () => {
      earningsService.chart.mockResolvedValue({ ...CHART_FIXTURE, range: '7d' });
      await request(app.getHttpServer()).get('/v1/provider/earnings/chart?range=7d');
      expect(earningsService.chart).toHaveBeenCalledWith('user-prov-1', '7d');
    });

    it('honours an explicit range=90d', async () => {
      earningsService.chart.mockResolvedValue({ ...CHART_FIXTURE, range: '90d' });
      await request(app.getHttpServer()).get('/v1/provider/earnings/chart?range=90d');
      expect(earningsService.chart).toHaveBeenCalledWith('user-prov-1', '90d');
    });

    it('rejects an invalid range (no silent default)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/chart?range=1y');
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(earningsService.chart).not.toHaveBeenCalled();
    });

    it('returns the buckets envelope', async () => {
      earningsService.chart.mockResolvedValue(CHART_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/provider/earnings/chart?range=30d');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.buckets)).toBe(true);
      expect(res.body.range).toBe('30d');
      expect(res.body.currency).toBe('USD');
    });
  });
});
