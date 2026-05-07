// Route-level e2e for /v1/admin/settings (Sprint 6.5 refined).
// Pins the new bulk surface (GET / + PATCH /) alongside the legacy
// keyed routes (PUT /:key + DELETE /:key). Real HTTP stack
// (cookie-parser, ValidationPipe, exception filter, real RolesGuard);
// JwtAuthGuard + CsrfGuard overridden with fakes.

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
import { AdminSettingsController } from '../../src/modules/admin/settings/admin-settings.controller';
import { AdminSettingsService } from '../../src/modules/admin/settings/admin-settings.service';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { AppError } from '../../src/shared/errors/app-error';

jest.setTimeout(15_000);

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return false;
    },
  } as unknown as AppConfigService;
}

const settingsService = {
  getBulk: jest.fn(),
  updateBulk: jest.fn(),
  detail: jest.fn(),
  upsert: jest.fn(),
  remove: jest.fn(),
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
  canActivate(): boolean {
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [AdminSettingsController],
    providers: [
      Reflector,
      { provide: AdminSettingsService, useValue: settingsService },
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

const BULK_FIXTURE = {
  values: {
    platform_fee_bps: 1000,
    default_currency: 'USD',
    support_email: 'support@example.com',
    feature_show_hourly_rate: false,
  },
  defaults: {
    platform_fee_bps: 1000,
    default_currency: 'USD',
    support_email: 'support@homeservicemarketplace.local',
    feature_show_hourly_rate: false,
  },
  schema: [],
  lastUpdatedAt: '2026-05-02T00:00:00.000Z',
};

describe('AdminSettings (e2e) — Sprint 6.5 refined', () => {
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
    it('GET /v1/admin/settings → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/settings');
      expect(res.status).toBe(401);
    });
    it('PATCH /v1/admin/settings → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { platform_fee_bps: 1500 } });
      expect(res.status).toBe(401);
    });
  });

  describe('role gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
    });
    it('GET → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/settings');
      expect(res.status).toBe(403);
    });
    it('PATCH → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { platform_fee_bps: 1500 } });
      expect(res.status).toBe(403);
      expect(settingsService.updateBulk).not.toHaveBeenCalled();
    });
  });

  describe('bulk GET happy-path', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the canonical bulk envelope', async () => {
      settingsService.getBulk.mockResolvedValue(BULK_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/settings');
      expect(res.status).toBe(200);
      expect(res.body.values).toEqual(BULK_FIXTURE.values);
      expect(res.body.defaults).toEqual(BULK_FIXTURE.defaults);
      expect(typeof res.body.lastUpdatedAt).toBe('string');
    });

    it('does not leak server env secrets in the response', async () => {
      settingsService.getBulk.mockResolvedValue(BULK_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/settings');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('JWT_SECRET');
      expect(body).not.toContain('DATABASE_URL');
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('STRIPE_SECRET');
    });
  });

  describe('PATCH bulk', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('forwards body.values to the service', async () => {
      settingsService.updateBulk.mockResolvedValue({
        values: { ...BULK_FIXTURE.values, platform_fee_bps: 1500 },
        changedKeys: ['platform_fee_bps'],
        lastUpdatedAt: '2026-05-02T01:00:00.000Z',
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { platform_fee_bps: 1500 } });
      expect(res.status).toBe(200);
      expect(res.body.changedKeys).toEqual(['platform_fee_bps']);
      expect(res.body.values.platform_fee_bps).toBe(1500);
      expect(settingsService.updateBulk).toHaveBeenCalledWith('admin-1', {
        platform_fee_bps: 1500,
      });
    });

    it('rejects extra body fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { platform_fee_bps: 1500 }, secret: 'leak' });
      expect(res.status).toBe(400);
      expect(settingsService.updateBulk).not.toHaveBeenCalled();
    });

    it('rejects when `values` is missing', async () => {
      const res = await request(app.getHttpServer()).patch('/v1/admin/settings').send({});
      expect(res.status).toBe(400);
    });

    it('surfaces VALIDATION_ERROR from the service for unknown key', async () => {
      settingsService.updateBulk.mockRejectedValue(
        new AppError('VALIDATION_ERROR', 'Unknown setting: JWT_SECRET', 400),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { JWT_SECRET: 'pwned' } });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      // The error message itself names the offending key but does NOT
      // echo the attempted secret value back.
      expect(JSON.stringify(res.body)).not.toContain('pwned');
    });

    it('surfaces VALIDATION_ERROR from the service for out-of-range value', async () => {
      settingsService.updateBulk.mockRejectedValue(
        new AppError('VALIDATION_ERROR', '`platform_fee_bps` must be ≤ 10000.', 400),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/settings')
        .send({ values: { platform_fee_bps: 99_999 } });
      expect(res.status).toBe(400);
    });
  });

  describe('legacy keyed routes still work', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('GET /:key still returns AdminSettingValue', async () => {
      settingsService.detail.mockResolvedValue({
        key: 'platform_fee_bps',
        value: 1500,
        updatedAt: '2026-05-02T00:00:00.000Z',
        updatedBy: 'admin-1',
      });
      const res = await request(app.getHttpServer()).get('/v1/admin/settings/platform_fee_bps');
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('platform_fee_bps');
    });

    it('PUT /:key still works', async () => {
      settingsService.upsert.mockResolvedValue({
        setting: {
          key: 'platform_fee_bps',
          value: 1500,
          updatedAt: '2026-05-02T00:00:00.000Z',
          updatedBy: 'admin-1',
        },
      });
      const res = await request(app.getHttpServer())
        .put('/v1/admin/settings/platform_fee_bps')
        .send({ value: 1500 });
      expect(res.status).toBe(200);
    });
  });
});
