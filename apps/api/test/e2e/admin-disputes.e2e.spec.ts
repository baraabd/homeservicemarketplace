// Route-level e2e for /v1/admin/disputes (Sprint 6.3 refined).
// Pins the new PATCH :id route + priority filter on list + the
// recentEvents projection on detail. Real HTTP stack
// (cookie-parser, ValidationPipe, exception filter, real
// RolesGuard); JwtAuthGuard + CsrfGuard overridden with fakes.

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
import { AdminDisputesController } from '../../src/modules/admin/disputes/admin-disputes.controller';
import { AdminDisputesService } from '../../src/modules/admin/disputes/admin-disputes.service';
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

const disputesService = {
  list: jest.fn(),
  detail: jest.fn(),
  open: jest.fn(),
  update: jest.fn(),
  resolve: jest.fn(),
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
    controllers: [AdminDisputesController],
    providers: [
      Reflector,
      { provide: AdminDisputesService, useValue: disputesService },
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

const DISPUTE_FIXTURE = {
  id: 'dp-1',
  bookingId: 'bk-1',
  openedById: 'user-seeker-1',
  status: 'OPEN' as const,
  priority: 'MEDIUM' as const,
  reason: 'Provider was late',
  description: null,
  resolution: null,
  resolvedAt: null,
  resolvedById: null,
  createdAt: '2026-05-02T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
};

const DISPUTE_WITH_EVENTS = {
  ...DISPUTE_FIXTURE,
  recentEvents: [
    {
      id: 'de-1',
      type: 'OPENED' as const,
      actorUserId: 'admin-1',
      before: null,
      after: { status: 'OPEN' },
      message: null,
      createdAt: '2026-05-02T00:00:00.000Z',
    },
  ],
};

describe('AdminDisputes (e2e) — Sprint 6.3 refined', () => {
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
    it('GET /v1/admin/disputes → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes');
      expect(res.status).toBe(401);
    });
    it('PATCH /v1/admin/disputes/:id → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ status: 'IN_REVIEW' });
      expect(res.status).toBe(401);
    });
  });

  describe('role gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
    });
    it('list → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes');
      expect(res.status).toBe(403);
    });
    it('PATCH → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ priority: 'HIGH' });
      expect(res.status).toBe(403);
      expect(disputesService.update).not.toHaveBeenCalled();
    });
  });

  describe('list (admin happy-path)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });
    it('returns the items envelope', async () => {
      disputesService.list.mockResolvedValue({ items: [DISPUTE_FIXTURE], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes');
      expect(res.status).toBe(200);
      expect(res.body.items[0].priority).toBe('MEDIUM');
    });
    it('forwards ?status=OPEN&priority=HIGH', async () => {
      disputesService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/disputes?status=OPEN&priority=HIGH');
      expect(disputesService.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'OPEN', priority: 'HIGH' }),
      );
    });
    it('rejects unknown query param (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes?disputeId=victim');
      expect(res.status).toBe(400);
    });
    it('rejects invalid priority value', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes?priority=GIGA');
      expect(res.status).toBe(400);
    });
  });

  describe('detail', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });
    it('returns the dispute with recentEvents', async () => {
      disputesService.detail.mockResolvedValue(DISPUTE_WITH_EVENTS);
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes/dp-1');
      expect(res.status).toBe(200);
      expect(res.body.recentEvents).toHaveLength(1);
      expect(res.body.recentEvents[0].type).toBe('OPENED');
    });
    it('surfaces NOT_FOUND on missing dispute', async () => {
      disputesService.detail.mockRejectedValue(
        new AppError('NOT_FOUND', 'Dispute not found.', 404),
      );
      const res = await request(app.getHttpServer()).get('/v1/admin/disputes/missing');
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/PrismaClient|invocation/i);
    });
  });

  describe('PATCH', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('forwards body to the service', async () => {
      disputesService.update.mockResolvedValue({
        dispute: { ...DISPUTE_FIXTURE, status: 'IN_REVIEW' },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ status: 'IN_REVIEW', priority: 'HIGH' });
      expect(res.status).toBe(200);
      expect(disputesService.update).toHaveBeenCalledWith(
        'admin-1',
        'dp-1',
        expect.objectContaining({ status: 'IN_REVIEW', priority: 'HIGH' }),
      );
    });

    it('rejects extra body fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ status: 'IN_REVIEW', resolvedById: 'forged' });
      expect(res.status).toBe(400);
      expect(disputesService.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid status value', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ status: 'NOT_A_STATUS' });
      expect(res.status).toBe(400);
    });

    it('surfaces 409 on terminal-state transition', async () => {
      disputesService.update.mockRejectedValue(
        new AppError('CONFLICT', 'Dispute is in a terminal state and cannot be reopened.', 409),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/dp-1')
        .send({ status: 'OPEN' });
      expect(res.status).toBe(409);
    });

    it('surfaces 404 on missing dispute', async () => {
      disputesService.update.mockRejectedValue(
        new AppError('NOT_FOUND', 'Dispute not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/disputes/missing')
        .send({ priority: 'HIGH' });
      expect(res.status).toBe(404);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });
    it('flips status + returns the mutation envelope', async () => {
      disputesService.resolve.mockResolvedValue({
        dispute: { ...DISPUTE_FIXTURE, status: 'RESOLVED_REFUND', resolution: 'full refund' },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/admin/disputes/dp-1/resolve')
        .send({ status: 'RESOLVED_REFUND', resolution: 'full refund' });
      expect(res.status).toBe(200);
      expect(res.body.dispute.status).toBe('RESOLVED_REFUND');
    });
    it('rejects an OPEN status on resolve (must be a RESOLVED_* terminal value)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/disputes/dp-1/resolve')
        .send({ status: 'OPEN', resolution: 'x' });
      expect(res.status).toBe(400);
    });
  });
});
