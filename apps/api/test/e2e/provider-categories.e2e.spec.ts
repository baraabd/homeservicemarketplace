import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
// Route-level e2e for /v1/me/provider/categories/applications (Sprint 2).
//
// Boots a minimal Nest app with the real HTTP stack — cookie-parser,
// ValidationPipe, exception filter, RolesGuard — and an in-test fake for the
// session and CSRF guards, mirroring provider.e2e.spec.ts. The service is
// faked: what is under test here is the edge, not the domain logic (that has
// its own unit and integration suites).
//
// What these tests pin:
//   - the endpoints are auth-gated (no session => 401)
//   - the endpoints are role-gated (seeker with a valid session => 403)
//   - POST is CSRF-gated
//   - the DTO rejects the fields a client would forge to skip review —
//     `status`, `providerProfileId`, `approved` — with 400, before the service
//     is reached
//   - there is no request shape through which a caller can name a DIFFERENT
//     provider: the service only ever receives the session user id
//   - POST answers 201, not 200: applying is not being granted
//   - error bodies never carry Prisma / SQL / constraint strings

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
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { ProviderCategoriesController } from '../../src/modules/provider/categories/provider-categories.controller';
import { ProviderCategoriesService } from '../../src/modules/provider/categories/provider-categories.service';

jest.setTimeout(15_000);

const PATH = '/v1/me/provider/categories/applications';

const APPLICATION = {
  id: 'app-1',
  status: 'PENDING' as const,
  category: {
    id: 'cat-plumbing',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'plumbing-ar',
    icon: 'wrench',
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  supersededAt: null,
};

const categoriesService = {
  apply: jest.fn(),
  listMine: jest.fn(),
};

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;

class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    ctx.switchToHttp().getRequest().user = fakeAuthedUser;
    return true;
  }
}

// Mirrors the real guard's contract: a matching cookie/header pair or nothing.
class FakeCsrfGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const cookie = req.cookies?.hsm_csrf;
    const header = req.headers['x-csrf-token'];
    if (!cookie || !header || cookie !== header) {
      throw new UnauthorizedException({ code: 'AUTH_CSRF_INVALID' });
    }
    return true;
  }
}

// The exception filter deliberately echoes an unrecognised error's message in
// development, for debuggability, and redacts it in production. The redaction
// test therefore has to run against the PRODUCTION configuration — that is
// where the guarantee has to hold — so this flag is mutable.
let isProduction = false;

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return isProduction;
    },
  } as unknown as AppConfigService;
}

const CSRF = 'csrf-token-value';
const withCsrf = (r: request.Test) =>
  r.set('Cookie', [`hsm_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);

// Sprint 9B.8 — the capability guard's dependency, as a controllable double.
//
// A SET, not a blanket allow: a guard stubbed to always pass would make every
// authorization assertion in this file vacuous. These are the capabilities the
// routes under test declare, so a controller that started asking for something
// else would 403 here rather than pass silently.
const HELD = new Set<string>(['EDIT_OWN_PROFILE']);
const capabilityService = { can: async (_u: string, c: string) => HELD.has(c) };

describe('Provider category applications — HTTP surface', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    @Module({
      controllers: [ProviderCategoriesController],
      providers: [
        { provide: ProviderCategoriesService, useValue: categoriesService },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: ProviderCapabilityService, useValue: capabilityService },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        Reflector,
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      .overrideGuard(CsrfGuard)
      .useClass(FakeCsrfGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // Same pipe configuration as main.ts — forbidNonWhitelisted is what makes
    // the injection tests below meaningful.
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    categoriesService.apply.mockResolvedValue({ application: APPLICATION });
    categoriesService.listMine.mockResolvedValue({ items: [APPLICATION] });
    fakeAuthedUser = { id: 'user-1', sessionId: 's-1', jti: 'j-1', roles: ['provider'] };
  });

  describe('authentication and authorization', () => {
    it('POST without a session is 401', async () => {
      fakeAuthedUser = null;
      await withCsrf(request(http).post(PATH)).send({ categoryId: 'cat-plumbing' }).expect(401);
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('GET without a session is 401', async () => {
      fakeAuthedUser = null;
      await request(http).get(PATH).expect(401);
      expect(categoriesService.listMine).not.toHaveBeenCalled();
    });

    it('POST as a seeker with a valid session is 403', async () => {
      // The role gate runs before any service code. A signed-in customer must
      // not be able to open provider skill applications.
      fakeAuthedUser = { id: 'user-2', sessionId: 's-2', jti: 'j-2', roles: ['customer'] };
      await withCsrf(request(http).post(PATH)).send({ categoryId: 'cat-plumbing' }).expect(403);
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('GET as a seeker with a valid session is 403', async () => {
      fakeAuthedUser = { id: 'user-2', sessionId: 's-2', jti: 'j-2', roles: ['customer'] };
      await request(http).get(PATH).expect(403);
      expect(categoriesService.listMine).not.toHaveBeenCalled();
    });

    it('POST without a CSRF pair is 401', async () => {
      await request(http).post(PATH).send({ categoryId: 'cat-plumbing' }).expect(401);
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('GET does not require CSRF', async () => {
      await request(http).get(PATH).expect(200);
    });
  });

  describe('payload validation', () => {
    it('rejects an attempt to send status=APPROVED', async () => {
      // The forgery that matters: a client trying to skip the queue by
      // declaring the outcome. Rejected by the whitelist before the service.
      const res = await withCsrf(request(http).post(PATH))
        .send({ categoryId: 'cat-plumbing', status: 'APPROVED' })
        .expect(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('rejects an attempt to send providerProfileId', async () => {
      // The IDOR attempt: naming someone else's profile. There is no such
      // field, so it cannot even be expressed.
      await withCsrf(request(http).post(PATH))
        .send({ categoryId: 'cat-plumbing', providerProfileId: 'pp-victim' })
        .expect(400);
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      await withCsrf(request(http).post(PATH)).send({}).expect(400);
      expect(categoriesService.apply).not.toHaveBeenCalled();
    });

    it('rejects an unknown status in the list query', async () => {
      await request(http).get(`${PATH}?status=SUPERSEDED`).expect(400);
      expect(categoriesService.listMine).not.toHaveBeenCalled();
    });

    it('accepts a valid status filter', async () => {
      await request(http).get(`${PATH}?status=REJECTED`).expect(200);
      expect(categoriesService.listMine).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ status: 'REJECTED' }),
      );
    });
  });

  describe('ownership is taken from the session, never the request', () => {
    it('POST forwards the session user id and only the category fields', async () => {
      await withCsrf(request(http).post(PATH)).send({ categoryId: 'cat-plumbing' }).expect(201);
      expect(categoriesService.apply).toHaveBeenCalledWith('user-1', {
        categoryId: 'cat-plumbing',
      });
    });

    it('a different session reaches the service as a different user', async () => {
      fakeAuthedUser = { id: 'user-9', sessionId: 's-9', jti: 'j-9', roles: ['provider'] };
      await request(http).get(PATH).expect(200);
      expect(categoriesService.listMine).toHaveBeenCalledWith('user-9', {});
    });
  });

  describe('responses', () => {
    it('POST answers 201 — applying is not being granted', async () => {
      const res = await withCsrf(request(http).post(PATH))
        .send({ categorySlug: 'plumbing' })
        .expect(201);
      expect(res.body.application).toMatchObject({ id: 'app-1', status: 'PENDING' });
    });

    it('GET returns the caller-scoped list', async () => {
      const res = await request(http).get(PATH).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).not.toHaveProperty('providerProfileId');
    });

    // The realistic failure: a Prisma error escapes the service. The filter
    // collapses anything Prisma-shaped to a stable response in EVERY
    // environment, so the constraint name, the table name, and the driver
    // never reach the client — even on a developer's machine.
    it('an escaped Prisma error never reaches the client, in any environment', async () => {
      const prismaError = Object.assign(
        new Error(
          'Invalid `prisma.providerCategoryApplication.create()` invocation: unique constraint ' +
            '"provider_category_application_one_pending_uniq" violated on public."ProviderCategoryApplication"',
        ),
        { name: 'PrismaClientKnownRequestError', code: 'P2002' },
      );
      categoriesService.apply.mockRejectedValue(prismaError);

      // P2002 maps to a safe 409; what this test is about is the BODY.
      const res = await withCsrf(request(http).post(PATH)).send({ categoryId: 'cat-plumbing' });

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/prisma/i);
      expect(body).not.toMatch(/unique constraint/i);
      expect(body).not.toMatch(/ProviderCategoryApplication/);
      expect(body).not.toMatch(/public\./);
    });

    it('in production, an unrecognised failure is redacted to a stable message', async () => {
      isProduction = true;
      try {
        categoriesService.apply.mockRejectedValue(
          new Error('connection string postgresql://user:secret@db-internal:5432 refused'),
        );
        const res = await withCsrf(request(http).post(PATH))
          .send({ categoryId: 'cat-plumbing' })
          .expect(500);

        expect(res.body.error).toMatchObject({
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        });
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/postgresql:/);
        expect(body).not.toMatch(/secret/);
        expect(body).not.toMatch(/db-internal/);
      } finally {
        isProduction = false;
      }
    });
  });
});
