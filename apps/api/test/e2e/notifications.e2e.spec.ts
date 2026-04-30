// Route-level e2e for /v1/me/notifications. Boots a minimal Nest app
// with only the NotificationsController; NotificationsService is replaced
// with an in-test fake. Real HTTP stack (cookie-parser, ValidationPipe,
// exception filter, JwtAuthGuard, CsrfGuard) without booting Prisma /
// Mongo / Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - mark-read / mark-all-read / delete are CSRF-gated
//   - DTO validation rejects unknown query parameters
//   - controller forwards (sessionUserId, notificationId, query) intact
//   - cross-user notificationId surfaces as NOT_FOUND (no leak)
//   - error bodies never carry Prisma / SQL strings

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
import { NotificationsController } from '../../src/modules/notifications/notifications.controller';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
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

const notificationsService = {
  list: jest.fn(),
  unreadCount: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
  delete: jest.fn(),
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
    controllers: [NotificationsController],
    providers: [
      { provide: NotificationsService, useValue: notificationsService },
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

describe('NotificationsController (e2e)', () => {
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
    it('GET /v1/me/notifications → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/notifications');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(notificationsService.list).not.toHaveBeenCalled();
    });

    it('GET /v1/me/notifications/unread-count → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/notifications/unread-count');
      expect(res.status).toBe(401);
      expect(notificationsService.unreadCount).not.toHaveBeenCalled();
    });

    it('POST :id/read → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/notifications/n-1/read');
      expect(res.status).toBe(401);
      expect(notificationsService.markRead).not.toHaveBeenCalled();
    });

    it('POST /read-all → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/notifications/read-all');
      expect(res.status).toBe(401);
      expect(notificationsService.markAllRead).not.toHaveBeenCalled();
    });

    it('DELETE :id → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).delete('/v1/me/notifications/n-1');
      expect(res.status).toBe(401);
      expect(notificationsService.delete).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the items envelope and forwards (userId, query)', async () => {
      notificationsService.list.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/me/notifications');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(notificationsService.list).toHaveBeenCalledWith('user-1', expect.any(Object));
    });

    it('forwards unread=true on the wire', async () => {
      notificationsService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/me/notifications?unread=true');
      expect(notificationsService.list).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ unread: true }),
      );
    });

    it('rejects unknown query parameters (IDOR vector closed)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/notifications?userId=user-victim');
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(notificationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the count envelope and forwards userId', async () => {
      notificationsService.unreadCount.mockResolvedValue({ count: 3 });
      const res = await request(app.getHttpServer()).get('/v1/me/notifications/unread-count');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 3 });
      expect(notificationsService.unreadCount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('markRead', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token (CsrfGuard fires)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/notifications/n-1/read');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(notificationsService.markRead).not.toHaveBeenCalled();
    });

    it('forwards (userId, notificationId) on a valid POST', async () => {
      notificationsService.markRead.mockResolvedValue({
        notification: {
          id: 'n-1',
          type: 'BID_ACCEPTED',
          title: 'Bid accepted',
          body: 'x',
          resourceType: 'BID',
          resourceId: 'bid-1',
          deepLink: '/home/requests/req-1/bids/bid-1',
          metadata: null,
          readAt: '2026-04-29T11:00:00.000Z',
          createdAt: '2026-04-29T10:00:00.000Z',
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/notifications/n-1/read')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.notification.readAt).toBe('2026-04-29T11:00:00.000Z');
      expect(notificationsService.markRead).toHaveBeenCalledWith('user-1', 'n-1');
    });

    it('cross-user notificationId surfaces as 404 (no Prisma leak)', async () => {
      notificationsService.markRead.mockRejectedValue(
        new AppError('NOT_FOUND', 'Notification not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/notifications/n-victim/read')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|SELECT|INSERT|UPDATE/i);
    });
  });

  describe('markAllRead', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/notifications/read-all');
      expect(res.status).toBe(401);
    });

    it('returns the updatedCount envelope on a valid POST', async () => {
      notificationsService.markAllRead.mockResolvedValue({ updatedCount: 5 });
      const res = await request(app.getHttpServer())
        .post('/v1/me/notifications/read-all')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updatedCount: 5 });
      expect(notificationsService.markAllRead).toHaveBeenCalledWith('user-1');
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token', async () => {
      const res = await request(app.getHttpServer()).delete('/v1/me/notifications/n-1');
      expect(res.status).toBe(401);
    });

    it('returns 204 on a valid DELETE', async () => {
      notificationsService.delete.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .delete('/v1/me/notifications/n-1')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(204);
      expect(notificationsService.delete).toHaveBeenCalledWith('user-1', 'n-1');
    });

    it('cross-user notificationId surfaces as 404 (no Prisma leak)', async () => {
      notificationsService.delete.mockRejectedValue(
        new AppError('NOT_FOUND', 'Notification not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .delete('/v1/me/notifications/n-victim')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });
  });
});
