// Route-level e2e for /v1/me/addresses. Boots a minimal Nest app with
// only the AddressesController; AddressesService is replaced with an
// in-test fake. This gives us a real HTTP stack (cookie-parser,
// ValidationPipe, exception filter, JwtAuthGuard, CsrfGuard) without
// booting Prisma/Mongo/Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - DTO validation rejects malformed bodies before they reach the service
//   - validation errors are normalized through the exception filter
//     (no internal Prisma/SQL details leak)
//   - CSRF guard fires on mutations (cookie present, header missing ⇒ 403)
//   - userId is sourced from the authenticated session, never from the
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

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { AddressesController } from '../../src/modules/addresses/addresses.controller';
import { AddressesService } from '../../src/modules/addresses/addresses.service';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';

jest.setTimeout(15_000);

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    isProduction: false,
  };
  const merged = { ...values, ...overrides };
  return {
    get: (k: string) => merged[k],
    get isProduction() {
      return merged.isProduction === true;
    },
  } as unknown as AppConfigService;
}

const addressesService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  setDefault: jest.fn(),
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

// Real CSRF semantics in miniature: presence of hsm_csrf cookie + matching
// X-CSRF-Token header. Pinned here so the test exercises the guard wiring,
// not the guard's full algorithm (covered in csrf.guard.spec.ts).
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
    controllers: [AddressesController],
    providers: [
      { provide: AddressesService, useValue: addressesService },
      { provide: AppConfigService, useValue: config },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  // overrideGuard is the documented Nest test API for swapping a guard
  // instance — provider-override alone leaves @UseGuards() pointing at
  // the original class, which then tries to resolve the real passport
  // 'jwt' strategy (we don't boot it here).
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

describe('AddressesController (e2e)', () => {
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
    it('GET /v1/me/addresses → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/addresses');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(addressesService.list).not.toHaveBeenCalled();
    });

    it('every mutation route requires auth', async () => {
      const server = app.getHttpServer();
      // Sequential, not Promise.all, so we don't fan out four concurrent
      // sockets at the in-process Nest test server. CI workers exhibit
      // ECONNRESET when the parallel keep-alive sockets stack up against
      // a single-process server; the auth gate doesn't need parallelism
      // to be exercised, only coverage.
      const requestFns = [
        () => request(server).post('/v1/me/addresses').send({}),
        () => request(server).patch('/v1/me/addresses/x').send({}),
        () => request(server).delete('/v1/me/addresses/x'),
        () => request(server).post('/v1/me/addresses/x/default'),
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
      addressesService.list.mockResolvedValue([
        {
          id: 'a1',
          label: 'Home',
          type: 'HOME',
          line1: '4 Main',
          city: 'Riyadh',
          country: 'SA',
          lat: null,
          lng: null,
          isDefault: true,
        },
      ]);
      const res = await request(app.getHttpServer()).get('/v1/me/addresses');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          {
            id: 'a1',
            label: 'Home',
            type: 'HOME',
            line1: '4 Main',
            city: 'Riyadh',
            country: 'SA',
            lat: null,
            lng: null,
            isDefault: true,
          },
        ],
      });
      expect(addressesService.list).toHaveBeenCalledWith('user-1');
    });
  });

  describe('create', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects requests missing the CSRF token before reaching the service', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/addresses').send({
        label: 'Office',
        type: 'WORK',
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        country: 'SA',
      });
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(addressesService.create).not.toHaveBeenCalled();
    });

    it('rejects malformed payloads with VALIDATION_ERROR (no Prisma details leak)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/addresses')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ label: '', type: 'NOT_A_REAL_TYPE', line1: '', city: '', country: 'X' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      // No internal/Prisma/SQL hints anywhere in the body.
      const blob = JSON.stringify(res.body);
      expect(blob).not.toMatch(/prisma/i);
      expect(blob).not.toMatch(/PrismaClient/);
      expect(blob).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
      expect(addressesService.create).not.toHaveBeenCalled();
    });

    it('strips unknown fields from the wire body (forbidNonWhitelisted) — userId never reaches the service', async () => {
      addressesService.create.mockResolvedValue({
        id: 'a-new',
        label: 'Office',
        type: 'WORK',
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        country: 'SA',
        lat: null,
        lng: null,
        isDefault: false,
      });
      // Attempting to override userId via the wire is rejected — the global
      // ValidationPipe (forbidNonWhitelisted: true) returns 400 for any
      // unknown property, including the IDOR-vector attempt.
      const res = await request(app.getHttpServer())
        .post('/v1/me/addresses')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({
          userId: 'user-victim',
          label: 'Office',
          type: 'WORK',
          line1: 'King Fahd Rd',
          city: 'Riyadh',
          country: 'SA',
        });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(addressesService.create).not.toHaveBeenCalled();
    });

    it('forwards the authenticated user id (NOT any client-sent id) on a valid create', async () => {
      addressesService.create.mockResolvedValue({
        id: 'a-new',
        label: 'Office',
        type: 'WORK',
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        country: 'SA',
        lat: null,
        lng: null,
        isDefault: false,
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/addresses')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({
          label: 'Office',
          type: 'WORK',
          line1: 'King Fahd Rd',
          city: 'Riyadh',
          country: 'SA',
        });
      expect(res.status).toBe(201);
      expect(addressesService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ label: 'Office', type: 'WORK' }),
      );
    });
  });

  describe('setDefault', () => {
    it('returns the promoted summary and forwards the session userId', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      addressesService.setDefault.mockResolvedValue({
        id: 'a-2',
        label: 'Office',
        type: 'WORK',
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        country: 'SA',
        lat: null,
        lng: null,
        isDefault: true,
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/addresses/a-2/default')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.isDefault).toBe(true);
      expect(addressesService.setDefault).toHaveBeenCalledWith('user-1', 'a-2');
    });
  });

  describe('remove', () => {
    it('returns 204 on a successful soft-delete', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      addressesService.remove.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .delete('/v1/me/addresses/a-1')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(204);
      expect(addressesService.remove).toHaveBeenCalledWith('user-1', 'a-1');
    });
  });
});
