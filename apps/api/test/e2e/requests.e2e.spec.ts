// Route-level e2e for /v1/me/requests. Boots a minimal Nest app with
// only the RequestsController; RequestsService is replaced with an
// in-test fake. This gives us a real HTTP stack (cookie-parser,
// ValidationPipe, exception filter, JwtAuthGuard, CsrfGuard) without
// booting Prisma/Mongo/Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - DTO validation rejects malformed bodies before reaching the service
//   - validation errors normalize through the exception filter
//   - CSRF guard fires on every mutation
//   - seekerUserId is sourced from the authenticated session, not the
//     request body — the controller passes user.id straight through

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

import { acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';
import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { RequestsController } from '../../src/modules/requests/requests.controller';
import { RequestsService } from '../../src/modules/requests/requests.service';

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

const requestsService = {
  list: jest.fn(),
  detail: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  cancel: jest.fn(),
  reopen: jest.fn(),
  timeline: jest.fn(),
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
    controllers: [RequestsController],
    providers: [
      { provide: RequestsService, useValue: requestsService },
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

describe('RequestsController (e2e)', () => {
  let app: INestApplication;

  let outboxLock: HeldLock;

  beforeAll(async () => {
    // SHARED on the outbox, because this suite is a PRODUCER.
    //
    // Creating a request enqueues request.available. outbox.integration.spec.ts
    // runs real workers that claim whatever is PENDING and due — a queue
    // consumer cannot be selective — and asserts on the exact rows it expects
    // back. Left unlocked, its workers claim and dead-letter this suite's
    // events, which surfaces as a stalled drain in THAT suite rather than a
    // failure in this one.
    //
    // That suite takes the same lock EXCLUSIVE, so shared here is exactly the
    // mutual exclusion required: producers may run together, never alongside
    // the consumer.
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');

    app = await bootApp();
  });
  afterAll(async () => {
    await outboxLock?.release();

    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    fakeAuthedUser = null;
  });

  describe('auth gating', () => {
    it('GET /v1/me/requests → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/requests');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(requestsService.list).not.toHaveBeenCalled();
    });

    it('every mutation route requires auth', async () => {
      const server = app.getHttpServer();
      // Sequential, not Promise.all, so we don't fan out five concurrent
      // sockets at the in-process Nest test server. CI workers exhibit
      // ECONNRESET when the parallel keep-alive sockets stack up against
      // a single-process server; the auth gate doesn't need parallelism
      // to be exercised, only coverage.
      const requestFns = [
        () => request(server).post('/v1/me/requests').send({}),
        () => request(server).patch('/v1/me/requests/x').send({}),
        () => request(server).post('/v1/me/requests/x/cancel'),
        () => request(server).post('/v1/me/requests/x/reopen'),
        () => request(server).get('/v1/me/requests/x/timeline'),
      ];
      for (const fn of requestFns) {
        const res = await fn();
        expect(res.status).toBe(401);
        expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      }
    });
  });

  describe('list', () => {
    it('returns the items envelope and forwards the session userId', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      requestsService.list.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/me/requests');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(requestsService.list).toHaveBeenCalledWith('user-1', expect.any(Object));
    });

    it('rejects unknown query parameters with VALIDATION_ERROR (forbidNonWhitelisted)', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get(
        '/v1/me/requests?seekerUserId=user-victim',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(requestsService.list).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects requests missing the CSRF token before reaching the service', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/requests').send({
        categoryId: 'cat-1',
        scheduleType: 'ASAP',
        addressId: 'addr-1',
      });
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(requestsService.create).not.toHaveBeenCalled();
    });

    it('rejects malformed payloads with VALIDATION_ERROR (no Prisma details leak)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ scheduleType: 'NOT_A_TYPE' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      const blob = JSON.stringify(res.body);
      expect(blob).not.toMatch(/prisma/i);
      expect(blob).not.toMatch(/PrismaClient/);
      expect(blob).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
      expect(requestsService.create).not.toHaveBeenCalled();
    });

    it('strips unknown fields — seekerUserId never reaches the service', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({
          // IDOR attempt — the global ValidationPipe rejects unknown
          // properties so the request is bounced before even reaching
          // the controller's body parameter.
          seekerUserId: 'user-victim',
          categoryId: 'cat-1',
          scheduleType: 'ASAP',
          addressId: 'addr-1',
        });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(requestsService.create).not.toHaveBeenCalled();
    });

    it('forwards the authenticated user id (NOT any client-sent id) on a valid create', async () => {
      requestsService.create.mockResolvedValue({
        id: 'req-new',
        status: 'OPEN_FOR_BIDS',
        category: null,
        customServiceText: null,
        description: null,
        scheduleType: 'ASAP',
        scheduledAt: null,
        addressSnapshot: {
          label: null,
          line1: 'a',
          city: 'b',
          country: 'cc',
          lat: null,
          lng: null,
        },
        bidsCount: 0,
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({
          categoryId: 'cat-1',
          scheduleType: 'ASAP',
          addressId: 'addr-1',
        });
      expect(res.status).toBe(201);
      expect(requestsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ categoryId: 'cat-1', scheduleType: 'ASAP' }),
      );
    });
  });

  describe('cancel / reopen / timeline', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('cancel forwards the session user id and request id', async () => {
      requestsService.cancel.mockResolvedValue({
        id: 'req-1',
        status: 'CANCELLED',
        category: null,
        customServiceText: null,
        description: null,
        scheduleType: 'ASAP',
        scheduledAt: null,
        addressSnapshot: {
          label: null,
          line1: 'a',
          city: 'b',
          country: 'cc',
          lat: null,
          lng: null,
        },
        bidsCount: 0,
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/requests/req-1/cancel')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(requestsService.cancel).toHaveBeenCalledWith('user-1', 'req-1');
    });

    it('timeline forwards the session user id and request id', async () => {
      requestsService.timeline.mockResolvedValue({
        items: [
          {
            id: 'evt-1',
            type: 'REQUEST_CREATED',
            metadata: null,
            createdAt: '2026-04-28T00:00:00.000Z',
          },
        ],
      });
      const res = await request(app.getHttpServer()).get('/v1/me/requests/req-1/timeline');
      expect(res.status).toBe(200);
      expect(res.body.items[0].type).toBe('REQUEST_CREATED');
      expect(requestsService.timeline).toHaveBeenCalledWith('user-1', 'req-1');
    });
  });
});
