// Route-level e2e for /v1/admin/audit-logs + /v1/admin/notifications
// (Sprint 6.6). Pins:
//   - GET /admin/audit-logs (canonical) + actor/action filter forwarding
//   - GET /admin/audit (legacy) still callable
//   - Audit metadata redaction: passwordHash / JWT_SECRET / DATABASE_URL
//     keys are replaced with "<redacted>" before they leave the API.
//   - GET /admin/notifications (admin-scoped via experience='admin')
//   - POST /admin/notifications/:id/read
//   - auth/role gating for both surfaces.

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
import { AdminAuditController } from '../../src/modules/admin/audit/admin-audit.controller';
import { AdminNotificationsController } from '../../src/modules/admin/notifications/admin-notifications.controller';
import { AuditEventRepository } from '../../src/infrastructure/persistence/iam/audit-event.repository';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
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

const auditRepo = { list: jest.fn() };
const notificationsService = { list: jest.fn(), markRead: jest.fn() };

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
  canActivate(): boolean {
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [AdminAuditController, AdminNotificationsController],
    providers: [
      Reflector,
      { provide: AuditEventRepository, useValue: auditRepo },
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

const AUDIT_ROW = {
  id: 'ae-1',
  userId: 'admin-1',
  type: 'ADMIN_SETTING_UPDATED',
  metadata: {
    key: 'platform_fee_bps',
    previousValue: { passwordHash: 'should-redact', value: 1000 },
    newValue: { value: 1500, JWT_SECRET: 'leak-attempt' },
  },
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  requestId: 'req-1',
  createdAt: new Date('2026-05-02T00:00:00Z'),
};

describe('Admin Audit + Notifications (e2e) — Sprint 6.6', () => {
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

  describe('auth / role gating', () => {
    const routes = ['/v1/admin/audit', '/v1/admin/audit-logs', '/v1/admin/notifications'];
    for (const path of routes) {
      it(`GET ${path} → 401 when unauthenticated`, async () => {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBe(401);
      });
    }
    it('GET /admin/audit-logs → 403 for non-admin', async () => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/admin/audit-logs');
      expect(res.status).toBe(403);
    });
    it('GET /admin/notifications → 403 for non-admin', async () => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/admin/notifications');
      expect(res.status).toBe(403);
      expect(notificationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/audit-logs', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the canonical { items, nextCursor } envelope with renamed fields', async () => {
      auditRepo.list.mockResolvedValue([AUDIT_ROW]);
      const res = await request(app.getHttpServer()).get('/v1/admin/audit-logs');
      expect(res.status).toBe(200);
      expect(res.body.items[0].actor).toBe('admin-1'); // renamed from userId
      expect(res.body.items[0].action).toBe('ADMIN_SETTING_UPDATED'); // renamed from type
      expect(res.body.nextCursor).toBeNull();
    });

    it('forwards actor/action to the repo as userId/type', async () => {
      auditRepo.list.mockResolvedValue([]);
      await request(app.getHttpServer()).get(
        '/v1/admin/audit-logs?actor=admin-1&action=ADMIN_PROVIDER_APPROVED',
      );
      expect(auditRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: 'ADMIN_PROVIDER_APPROVED',
        }),
      );
    });

    it('redacts passwordHash / JWT_SECRET / DATABASE_URL from metadata', async () => {
      auditRepo.list.mockResolvedValue([AUDIT_ROW]);
      const res = await request(app.getHttpServer()).get('/v1/admin/audit-logs');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('should-redact');
      expect(body).not.toContain('leak-attempt');
      expect(body).toContain('<redacted>');
    });

    it('rejects unknown query parameter (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/audit-logs?secretQuery=foo');
      expect(res.status).toBe(400);
    });

    it('rejects limit > 100', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/audit-logs?limit=999');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/audit (legacy)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('still returns { items, nextCursor } with userId/type field names', async () => {
      auditRepo.list.mockResolvedValue([AUDIT_ROW]);
      const res = await request(app.getHttpServer()).get('/v1/admin/audit');
      expect(res.status).toBe(200);
      expect(res.body.items[0].userId).toBe('admin-1');
      expect(res.body.items[0].type).toBe('ADMIN_SETTING_UPDATED');
    });

    it('redacts metadata on the legacy surface too', async () => {
      auditRepo.list.mockResolvedValue([AUDIT_ROW]);
      const res = await request(app.getHttpServer()).get('/v1/admin/audit');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('should-redact');
      expect(body).not.toContain('leak-attempt');
    });
  });

  describe('GET /admin/notifications', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('forwards experience=admin to the notifications service', async () => {
      notificationsService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/notifications');
      expect(notificationsService.list).toHaveBeenCalledWith(
        'admin-1',
        expect.objectContaining({ experience: 'admin' }),
      );
    });

    it('returns the items envelope', async () => {
      notificationsService.list.mockResolvedValue({
        items: [
          {
            id: 'n-1',
            type: 'SYSTEM',
            title: 'Test',
            body: 'body',
            resourceType: null,
            resourceId: null,
            deepLink: '/admin/disputes/dp-1',
            metadata: null,
            readAt: null,
            createdAt: '2026-05-02T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      });
      const res = await request(app.getHttpServer()).get('/v1/admin/notifications');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('rejects unknown query parameter', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/notifications?userId=victim');
      expect(res.status).toBe(400);
      expect(notificationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/notifications/:id/read', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('forwards the calling admin id + notificationId', async () => {
      notificationsService.markRead.mockResolvedValue({
        notification: {
          id: 'n-1',
          type: 'SYSTEM',
          title: 'Test',
          body: 'body',
          resourceType: null,
          resourceId: null,
          deepLink: '/admin/disputes/dp-1',
          metadata: null,
          readAt: '2026-05-02T01:00:00.000Z',
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      });
      const res = await request(app.getHttpServer()).post('/v1/admin/notifications/n-1/read');
      expect(res.status).toBe(200);
      expect(res.body.notification.readAt).toBeTruthy();
      expect(notificationsService.markRead).toHaveBeenCalledWith('admin-1', 'n-1');
    });
  });
});
