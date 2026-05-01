// Route-level e2e for /v1/me/requests/:requestId/bids. Boots a
// minimal Nest app with only the BidsController; BidsService is
// replaced with an in-test fake. Real HTTP stack (cookie-parser,
// ValidationPipe, exception filter, JwtAuthGuard) without booting
// Prisma/Mongo/Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - DTO validation rejects unknown sort values before the service
//   - validation errors normalize through the exception filter
//   - controller forwards (sessionUserId, requestId, sort?) intact
//   - cross-user request id surfaces as the service's NOT_FOUND, not
//     a privilege escalation

import {
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { BidsController } from '../../src/modules/bids/bids.controller';
import { BidsService } from '../../src/modules/bids/bids.service';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { AppError } from '../../src/shared/errors/app-error';

jest.setTimeout(15_000);

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = { isProduction: false };
  const merged = { ...values, ...overrides };
  return {
    get: (k: string) => merged[k],
    get isProduction() {
      return merged.isProduction === true;
    },
  } as unknown as AppConfigService;
}

const bidsService = {
  listForRequest: jest.fn(),
  detail: jest.fn(),
  accept: jest.fn(),
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

// CSRF in miniature — accept-bid is the only mutation in this slice;
// the guard wiring is what's under test here, not the full algorithm
// (covered in csrf.guard.spec.ts).
class FakeCsrfGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const cookie = req.cookies?.hsm_csrf;
    const header = req.header('x-csrf-token');
    if (!cookie || !header || cookie !== header) {
      throw new UnauthorizedException({ code: 'AUTH_CSRF_FAILED' });
    }
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [BidsController],
    providers: [
      { provide: BidsService, useValue: bidsService },
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

describe('BidsController (e2e)', () => {
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
    it('GET /v1/me/requests/:id/bids → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-1/bids');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bidsService.listForRequest).not.toHaveBeenCalled();
    });

    it('GET /v1/me/requests/:id/bids/:bidId → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-1/bids/b-1');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bidsService.detail).not.toHaveBeenCalled();
    });

    it('POST /v1/me/requests/:id/bids/:bidId/accept → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/requests/req-1/bids/b-1/accept');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bidsService.accept).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the items envelope and forwards (userId, requestId)', async () => {
      bidsService.listForRequest.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-1/bids');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(bidsService.listForRequest).toHaveBeenCalledWith(
        'user-1',
        'req-1',
        expect.any(Object),
      );
    });

    it('forwards the sort query parameter', async () => {
      bidsService.listForRequest.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/me/requests/req-1/bids?sort=price');
      expect(bidsService.listForRequest).toHaveBeenCalledWith(
        'user-1',
        'req-1',
        expect.objectContaining({ sort: 'price' }),
      );
    });

    it('rejects an unknown sort value with VALIDATION_ERROR (no leak)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/me/requests/req-1/bids?sort=NOT_A_SORT',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      const blob = JSON.stringify(res.body);
      expect(blob).not.toMatch(/prisma/i);
      expect(blob).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
      expect(bidsService.listForRequest).not.toHaveBeenCalled();
    });

    it('rejects unknown query parameters (forbidNonWhitelisted) — IDOR vector closed', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/me/requests/req-1/bids?seekerUserId=user-victim',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(bidsService.listForRequest).not.toHaveBeenCalled();
    });

    it('cross-user request id → 404 (service emits NOT_FOUND, not 403)', async () => {
      bidsService.listForRequest.mockRejectedValue(
        new AppError('NOT_FOUND', 'Request not found.', 404),
      );
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-victim/bids');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });
  });

  describe('detail', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('forwards (userId, requestId, bidId) on a valid GET', async () => {
      bidsService.detail.mockResolvedValue({
        id: 'b-1',
        requestId: 'req-1',
        amount: 35,
        currency: 'USD',
        pricingType: 'HOURLY',
        note: null,
        status: 'PENDING',
        responseTimeMinutes: 5,
        badge: 'BEST_MATCH',
        submittedAt: '2026-04-28T01:00:00.000Z',
        provider: {
          id: 'pp-1',
          displayName: 'Omar',
          initials: 'O',
          avatarUrl: null,
          ratingAvg: 4.9,
          reviewCount: 312,
          completedJobs: 540,
          verified: true,
          topPro: true,
        },
      });
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-1/bids/b-1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('b-1');
      expect(bidsService.detail).toHaveBeenCalledWith('user-1', 'req-1', 'b-1');
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects the request when CSRF token is missing (CsrfGuard fires)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/requests/req-1/bids/b-1/accept');
      // FakeCsrfGuard mirrors the real one — without the matching
      // cookie+header pair the request is bounced with AUTH_CSRF_FAILED
      // before reaching the service.
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(bidsService.accept).not.toHaveBeenCalled();
    });

    it('forwards (userId, requestId, bidId) on a valid POST', async () => {
      bidsService.accept.mockResolvedValue({
        bid: {
          id: 'b-1',
          requestId: 'req-1',
          amount: 35,
          currency: 'USD',
          pricingType: 'HOURLY',
          note: null,
          status: 'ACCEPTED',
          responseTimeMinutes: 5,
          badge: null,
          submittedAt: '2026-04-28T01:00:00.000Z',
          provider: {
            id: 'pp-1',
            displayName: 'Omar',
            initials: 'O',
            avatarUrl: null,
            ratingAvg: 4.9,
            reviewCount: 312,
            completedJobs: 540,
            verified: true,
            topPro: true,
          },
        },
        booking: {
          id: 'bk-1',
          requestId: 'req-1',
          bidId: 'b-1',
          status: 'SCHEDULED',
          scheduledAt: null,
          priceAmount: 35,
          currency: 'USD',
          createdAt: '2026-04-28T02:00:00.000Z',
        },
        requestStatus: 'BID_ACCEPTED',
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests/req-1/bids/b-1/accept')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.bid.status).toBe('ACCEPTED');
      expect(res.body.booking.id).toBe('bk-1');
      expect(res.body.requestStatus).toBe('BID_ACCEPTED');
      expect(bidsService.accept).toHaveBeenCalledWith('user-1', 'req-1', 'b-1');
    });

    it('cross-user requestId surfaces as 404 (service emits NOT_FOUND, no leak)', async () => {
      bidsService.accept.mockRejectedValue(new AppError('NOT_FOUND', 'Request not found.', 404));
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests/req-victim/bids/b-1/accept')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });

    it('returns 409 CONFLICT on double-accept (service emits CONFLICT, no leak)', async () => {
      bidsService.accept.mockRejectedValue(
        new AppError('CONFLICT', 'A bid has already been accepted for this request.', 409),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests/req-1/bids/b-2/accept')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(409);
      expect(res.body?.error?.code).toBe('CONFLICT');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|SELECT|INSERT|UPDATE/i);
    });
  });
});
