// Route-level e2e for /v1/me/bookings. Boots a minimal Nest app with
// only the BookingsController; BookingsService is replaced with an
// in-test fake. Real HTTP stack (cookie-parser, ValidationPipe,
// exception filter, JwtAuthGuard, CsrfGuard) without booting Prisma /
// Mongo / Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - cancel is CSRF-gated (no cookie+header pair ⇒ 401)
//   - DTO validation rejects unknown query parameters BEFORE the
//     service is called (forbidNonWhitelisted blocks IDOR vectors)
//   - controller forwards (sessionUserId, bookingId, query) intact
//   - cross-user bookingId surfaces as the service's NOT_FOUND, not a
//     privilege escalation, and the error body never leaks Prisma
//     internals

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
import { BookingsController } from '../../src/modules/bookings/bookings.controller';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
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

const bookingsService = {
  list: jest.fn(),
  detail: jest.fn(),
  timeline: jest.fn(),
  cancel: jest.fn(),
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
    controllers: [BookingsController],
    providers: [
      { provide: BookingsService, useValue: bookingsService },
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

describe('BookingsController (e2e)', () => {
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
    it('GET /v1/me/bookings → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/bookings');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bookingsService.list).not.toHaveBeenCalled();
    });

    it('GET /v1/me/bookings/:id → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/bookings/bk-1');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bookingsService.detail).not.toHaveBeenCalled();
    });

    it('GET /v1/me/bookings/:id/timeline → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/bookings/bk-1/timeline');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bookingsService.timeline).not.toHaveBeenCalled();
    });

    it('POST /v1/me/bookings/:id/cancel → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/bookings/bk-1/cancel');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(bookingsService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the items envelope and forwards (userId, query)', async () => {
      bookingsService.list.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/me/bookings');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(bookingsService.list).toHaveBeenCalledWith('user-1', expect.any(Object));
    });

    it('forwards a valid status filter', async () => {
      bookingsService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/me/bookings?status=COMPLETED');
      expect(bookingsService.list).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ status: 'COMPLETED' }),
      );
    });

    it('rejects an unknown status with 400 VALIDATION_ERROR (no Prisma leak)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/bookings?status=NOT_A_STATUS');
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      const blob = JSON.stringify(res.body);
      expect(blob).not.toMatch(/prisma/i);
      expect(blob).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
      expect(bookingsService.list).not.toHaveBeenCalled();
    });

    it('rejects unknown query parameters (IDOR vector closed)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/me/bookings?seekerUserId=user-victim',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(bookingsService.list).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('forwards (userId, bookingId)', async () => {
      bookingsService.detail.mockResolvedValue({ id: 'bk-1' });
      const res = await request(app.getHttpServer()).get('/v1/me/bookings/bk-1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('bk-1');
      expect(bookingsService.detail).toHaveBeenCalledWith('user-1', 'bk-1');
    });

    it('cross-user bookingId surfaces as 404 (no Prisma leak)', async () => {
      bookingsService.detail.mockRejectedValue(
        new AppError('NOT_FOUND', 'Booking not found.', 404),
      );
      const res = await request(app.getHttpServer()).get('/v1/me/bookings/bk-victim');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });
  });

  describe('timeline', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('forwards (userId, bookingId) and returns the items envelope', async () => {
      bookingsService.timeline.mockResolvedValue({
        items: [
          {
            id: 'bevt-1',
            type: 'BOOKING_CREATED',
            metadata: { requestId: 'req-1' },
            createdAt: '2026-04-28T02:00:00.000Z',
          },
        ],
      });
      const res = await request(app.getHttpServer()).get('/v1/me/bookings/bk-1/timeline');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(bookingsService.timeline).toHaveBeenCalledWith('user-1', 'bk-1');
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token (CsrfGuard fires)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/bookings/bk-1/cancel');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(bookingsService.cancel).not.toHaveBeenCalled();
    });

    it('forwards (userId, bookingId) on a valid POST', async () => {
      bookingsService.cancel.mockResolvedValue({ id: 'bk-1', status: 'CANCELLED' });
      const res = await request(app.getHttpServer())
        .post('/v1/me/bookings/bk-1/cancel')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(bookingsService.cancel).toHaveBeenCalledWith('user-1', 'bk-1');
    });

    it('returns 409 CONFLICT on already-cancelled (no Prisma leak)', async () => {
      bookingsService.cancel.mockRejectedValue(
        new AppError('CONFLICT', 'Booking is already cancelled.', 409),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/bookings/bk-1/cancel')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(409);
      expect(res.body?.error?.code).toBe('CONFLICT');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|SELECT|INSERT|UPDATE/i);
    });

    it('cross-user bookingId surfaces as 404 (no Prisma leak)', async () => {
      bookingsService.cancel.mockRejectedValue(
        new AppError('NOT_FOUND', 'Booking not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/bookings/bk-victim/cancel')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });
  });
});
