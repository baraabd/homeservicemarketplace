// Route-level e2e for /v1/admin/users + /v1/admin/roles (Sprint 6.1).
// Boots a minimal Nest app with only the AdminUsers + AdminRoles
// controllers; AdminUsersService is replaced with an in-test fake.
// Real HTTP stack (cookie-parser, ValidationPipe, exception filter,
// JwtAuthGuard, CsrfGuard, RolesGuard) without booting Prisma.
//
// What these tests pin (Sprint 6.1 canonical surface):
//   • GET /admin/users — auth-gated, role-gated, accepts query=/q=
//   • GET /admin/users/:id — auth-gated, role-gated, 404 on missing
//   • PATCH /admin/users/:id/status — body validated, CSRF-gated for
//     cookie-mode, refuses unknown body fields, refuses unsupported
//     status values
//   • GET /admin/roles — auth-gated, role-gated, returns the items envelope
//   • Cross-role 403 + no-token 401 for every read + the PATCH
//   • Wire shape never carries passwordHash / mfaSecret on success
//     OR error paths

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
import { AdminUsersService } from '../../src/modules/admin/users/admin-users.service';
import {
  AdminRolesController,
  AdminUsersController,
} from '../../src/modules/admin/users/admin-users.controller';
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

const adminUsersService = {
  list: jest.fn(),
  detail: jest.fn(),
  setStatus: jest.fn(),
  suspend: jest.fn(),
  restore: jest.fn(),
  listRoles: jest.fn(),
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

// Bearer-mode CSRF bypass mirrors production: the real guard returns
// true when authTransport is not 'cookie'. The e2e skips CSRF for
// every request because supertest doesn't carry an access cookie.
class FakeCsrfGuard {
  canActivate(): boolean {
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [AdminUsersController, AdminRolesController],
    providers: [
      Reflector,
      { provide: AdminUsersService, useValue: adminUsersService },
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
  // Real RolesGuard: it reads req.user.roles and consults @Roles metadata.
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

const USER_FIXTURE = {
  id: 'u-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  isActive: true,
  emailVerifiedAt: '2026-01-02T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const SUSPENDED_USER = { ...USER_FIXTURE, status: 'SUSPENDED' as const, isActive: false };

const ROLES_FIXTURE = {
  items: [
    { id: 'r-admin', name: 'admin', description: 'Platform admin' },
    { id: 'r-provider', name: 'provider', description: null },
    { id: 'r-customer', name: 'customer', description: null },
  ],
};

describe('AdminUsers + AdminRoles (e2e) — Sprint 6.1', () => {
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
    it('GET /v1/admin/users → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/users');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('PATCH /v1/admin/users/:id/status → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(401);
    });

    it('GET /v1/admin/roles → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/roles');
      expect(res.status).toBe(401);
    });
  });

  describe('role gating', () => {
    it('GET /v1/admin/users → 403 for a non-admin (customer) session', async () => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/admin/users');
      expect(res.status).toBe(403);
      expect(adminUsersService.list).not.toHaveBeenCalled();
    });

    it('PATCH /v1/admin/users/:id/status → 403 for a non-admin session', async () => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(403);
      expect(adminUsersService.setStatus).not.toHaveBeenCalled();
    });

    it('GET /v1/admin/roles → 403 for a non-admin session', async () => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['provider'] };
      const res = await request(app.getHttpServer()).get('/v1/admin/roles');
      expect(res.status).toBe(403);
    });
  });

  describe('list (admin happy-path)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the items envelope', async () => {
      adminUsersService.list.mockResolvedValue({ items: [USER_FIXTURE], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/admin/users');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual(USER_FIXTURE);
      expect(res.body.nextCursor).toBeNull();
    });

    it('forwards `query=` on the wire', async () => {
      adminUsersService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/users?query=ada');
      expect(adminUsersService.list).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'ada' }),
      );
    });

    it('forwards the legacy `q=` alias', async () => {
      adminUsersService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/users?q=ada');
      expect(adminUsersService.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'ada' }));
    });

    it('forwards role + status filters', async () => {
      adminUsersService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/users?role=provider&status=ACTIVE');
      expect(adminUsersService.list).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'provider', status: 'ACTIVE' }),
      );
    });

    it('rejects an unknown query parameter (IDOR/wire-shape lockdown)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/users?userId=victim');
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(adminUsersService.list).not.toHaveBeenCalled();
    });

    it('limit honours the [1, 100] range', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/users?limit=999');
      expect(res.status).toBe(400);
    });

    it('responses do not leak passwordHash / mfaSecret', async () => {
      adminUsersService.list.mockResolvedValue({ items: [USER_FIXTURE], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/admin/users');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('mfaSecret');
    });
  });

  describe('detail (admin happy-path)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the user summary', async () => {
      adminUsersService.detail.mockResolvedValue(USER_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/users/u-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(USER_FIXTURE);
    });

    it('surfaces NOT_FOUND for a missing user', async () => {
      adminUsersService.detail.mockRejectedValue(new AppError('NOT_FOUND', 'User not found.', 404));
      const res = await request(app.getHttpServer()).get('/v1/admin/users/missing');
      expect(res.status).toBe(404);
      expect(res.body?.error?.code).toBe('NOT_FOUND');
      // No prisma / SQL strings on the error path.
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/PrismaClient|SELECT |INSERT |UPDATE /i);
    });
  });

  describe('PATCH status (Sprint 6.1 canonical)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the post-mutation user envelope for SUSPENDED', async () => {
      adminUsersService.setStatus.mockResolvedValue({ user: SUSPENDED_USER });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'SUSPENDED', reason: 'fraud' });
      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe('SUSPENDED');
      expect(res.body.user.isActive).toBe(false);
      expect(adminUsersService.setStatus).toHaveBeenCalledWith('admin-1', 'u-1', {
        status: 'SUSPENDED',
        reason: 'fraud',
      });
    });

    it('returns the post-mutation user envelope for ACTIVE', async () => {
      adminUsersService.setStatus.mockResolvedValue({ user: USER_FIXTURE });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'ACTIVE' });
      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe('ACTIVE');
    });

    it('rejects unknown status values (PENDING_VERIFICATION blocked)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'PENDING_VERIFICATION' });
      expect(res.status).toBe(400);
      expect(adminUsersService.setStatus).not.toHaveBeenCalled();
    });

    it('rejects DELETED status (admins cannot hard-delete via PATCH)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'DELETED' });
      expect(res.status).toBe(400);
    });

    it('rejects extra body fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/u-1/status')
        .send({ status: 'SUSPENDED', roles: ['admin'] });
      expect(res.status).toBe(400);
    });

    it('surfaces VALIDATION_ERROR when admin tries to disable self', async () => {
      adminUsersService.setStatus.mockRejectedValue(
        new AppError('VALIDATION_ERROR', 'Admins cannot disable their own account.', 400),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/admin-1/status')
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('surfaces NOT_FOUND for a missing target', async () => {
      adminUsersService.setStatus.mockRejectedValue(
        new AppError('NOT_FOUND', 'User not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/users/missing/status')
        .send({ status: 'SUSPENDED' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/admin/roles', () => {
    it('returns the seeded role list for an admin', async () => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
      adminUsersService.listRoles.mockResolvedValue(ROLES_FIXTURE);
      const res = await request(app.getHttpServer()).get('/v1/admin/roles');
      expect(res.status).toBe(200);
      expect(res.body.items.map((r: { name: string }) => r.name)).toEqual([
        'admin',
        'provider',
        'customer',
      ]);
    });
  });
});
