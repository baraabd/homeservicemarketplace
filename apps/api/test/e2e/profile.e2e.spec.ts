// Route-level e2e for /v1/me/profile. Boots a minimal Nest app with
// only the ProfileController; ProfileService is replaced with an
// in-test fake. Real HTTP stack (cookie-parser, ValidationPipe,
// exception filter, JwtAuthGuard, CsrfGuard) without booting Prisma.
//
// What these tests pin:
//   - GET / PATCH are auth-gated (no session ⇒ 401)
//   - PATCH is CSRF-gated (no token pair ⇒ 401)
//   - DTO validation rejects unknown fields (forbidNonWhitelisted),
//     blocking IDOR attempts to inject email / userId / role / status
//   - controller forwards (sessionUserId, body) intact
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
import { ProfileController } from '../../src/modules/profile/profile.controller';
import { ProfileService } from '../../src/modules/profile/profile.service';
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

const profileService = {
  get: jest.fn(),
  update: jest.fn(),
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
    controllers: [ProfileController],
    providers: [
      { provide: ProfileService, useValue: profileService },
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

const PROFILE_FIXTURE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  email: 'ada@example.com',
  phoneNumber: null,
  city: null,
  bio: null,
  avatarUrl: null,
  updatedAt: '2026-04-29T00:00:00.000Z',
};

describe('ProfileController (e2e)', () => {
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
    it('GET /v1/me/profile → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/profile');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(profileService.get).not.toHaveBeenCalled();
    });

    it('PATCH /v1/me/profile → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .send({ firstName: 'Grace' });
      expect(res.status).toBe(401);
      expect(profileService.update).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the profile envelope and forwards userId', async () => {
      profileService.get.mockResolvedValue({ profile: PROFILE_FIXTURE });
      const res = await request(app.getHttpServer()).get('/v1/me/profile');
      expect(res.status).toBe(200);
      expect(res.body.profile.email).toBe('ada@example.com');
      expect(profileService.get).toHaveBeenCalledWith('user-1');
    });
  });

  describe('PATCH', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token (CsrfGuard fires before service)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .send({ firstName: 'Grace' });
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(profileService.update).not.toHaveBeenCalled();
    });

    it('rejects email update (forbidNonWhitelisted blocks the field)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ email: 'attacker@example.com' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(profileService.update).not.toHaveBeenCalled();
    });

    it('rejects userId / role / status / password injection', async () => {
      for (const payload of [
        { userId: 'user-victim' },
        { role: 'admin' },
        { status: 'SUSPENDED' },
        { password: 'pwn' },
      ]) {
        const res = await request(app.getHttpServer())
          .patch('/v1/me/profile')
          .set('Cookie', 'hsm_csrf=tok')
          .set('X-CSRF-Token', 'tok')
          .send(payload);
        expect(res.status).toBe(400);
        expect(profileService.update).not.toHaveBeenCalled();
      }
    });

    it('forwards (userId, body) on a valid PATCH', async () => {
      profileService.update.mockResolvedValue({
        profile: { ...PROFILE_FIXTURE, firstName: 'Grace' },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ firstName: 'Grace', city: 'Palo Alto' });
      expect(res.status).toBe(200);
      expect(res.body.profile.firstName).toBe('Grace');
      expect(profileService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ firstName: 'Grace', city: 'Palo Alto' }),
      );
    });

    it('rejects oversize bio (MaxLength 500)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ bio: 'x'.repeat(501) });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('error bodies do not leak Prisma / SQL strings', async () => {
      profileService.update.mockRejectedValue(
        Object.assign(
          new Error('PrismaClientKnownRequestError: column users.email does not exist'),
          {
            name: 'PrismaClientKnownRequestError',
          },
        ),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/me/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ firstName: 'Grace' });
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|SELECT|INSERT|UPDATE/i);
    });
  });
});
