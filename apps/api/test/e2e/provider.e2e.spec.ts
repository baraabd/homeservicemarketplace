import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
// Route-level e2e for /v1/me/provider/*. Boots a minimal Nest app with
// only the ProviderController; ProviderService is replaced with an
// in-test fake. Real HTTP stack (cookie-parser, ValidationPipe,
// exception filter, JwtAuthGuard, CsrfGuard, RolesGuard) without
// booting Prisma.
//
// What these tests pin:
//   - GET / PATCH endpoints are auth-gated (no session ⇒ 401)
//   - GET / PATCH endpoints are role-gated (non-provider ⇒ 403)
//   - PATCH endpoints are CSRF-gated (no token pair ⇒ 401)
//   - DTO validation rejects unknown fields (forbidNonWhitelisted),
//     blocking IDOR attempts to inject userId / email / role / status /
//     reputation columns
//   - upgrade endpoint is idempotent at the service layer (the mock
//     enforces the contract; the controller forwards intact)
//   - error bodies never carry Prisma / SQL strings

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
import { ProviderController } from '../../src/modules/provider/provider.controller';
import { ProviderOnboardingService } from '../../src/modules/provider/onboarding/provider-onboarding.service';
import { ProviderService } from '../../src/modules/provider/provider.service';
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

const providerService = {
  upgrade: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  updateAvailability: jest.fn(),
};

const onboardingService = {
  getStatus: jest.fn(),
  submitForReview: jest.fn(),
  withdrawFromReview: jest.fn(),
  assertEditable: jest.fn(),
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
    controllers: [ProviderController],
    providers: [
      Reflector,
      { provide: ProviderService, useValue: providerService },
      // Phase 4: the controller also exposes the onboarding routes
      // (GET /onboarding, POST /submit-for-review, POST /withdraw-review).
      // Their behaviour is covered by
      // src/modules/provider/onboarding/*.spec.ts; here the double just
      // satisfies the constructor so the pre-existing route assertions run.
      { provide: ProviderOnboardingService, useValue: onboardingService },
      { provide: AppConfigService, useValue: config },
      { provide: ProviderCapabilityService, useValue: capabilityService },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
    .overrideGuard(CsrfGuard)
    .useClass(FakeCsrfGuard)
    // RolesGuard is left as the real implementation — it reads the
    // session role from req.user (set by FakeJwtAuthGuard) and consults
    // the @Roles metadata. This is exactly what the production stack
    // does, just without a real JWT.
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
  id: 'pp-1',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  avatarUrl: null,
  bio: null,
  headline: null,
  phoneNumber: null,
  ratingAvg: 0,
  reviewCount: 0,
  completedJobs: 0,
  verified: false,
  topPro: false,
  availability: 'OFFLINE' as const,
  status: 'ACTIVE' as const,
  serviceAreaCity: null,
  serviceAreaCountry: null,
  serviceAreaLat: null,
  serviceAreaLng: null,
  serviceAreaRadiusKm: null,
  serviceCategories: [],
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

// Sprint 9B.8 — the capability guard's dependency, as a controllable double.
//
// A SET, not a blanket allow: a guard stubbed to always pass would make every
// authorization assertion in this file vacuous. These are the capabilities the
// routes under test declare, so a controller that started asking for something
// else would 403 here rather than pass silently.
const HELD = new Set<string>([
  'VIEW_OWN_PROFILE',
  'EDIT_OWN_PROFILE',
  'COMPLETE_ONBOARDING',
  'SUBMIT_FOR_REVIEW',
]);
const capabilityService = { can: async (_u: string, c: string) => HELD.has(c) };

describe('ProviderController (e2e)', () => {
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

  // ─── auth gating ────────────────────────────────────────────────────────
  describe('auth gating', () => {
    it('GET /v1/me/provider/profile → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/provider/profile');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(providerService.get).not.toHaveBeenCalled();
    });

    it('POST /v1/me/provider/upgrade → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/provider/upgrade');
      expect(res.status).toBe(401);
      expect(providerService.upgrade).not.toHaveBeenCalled();
    });

    it('PATCH /v1/me/provider/profile → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .send({ displayName: 'X' });
      expect(res.status).toBe(401);
    });

    it('PATCH /v1/me/provider/availability → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/availability')
        .send({ availability: 'ONLINE' });
      expect(res.status).toBe(401);
    });
  });

  // ─── role gating ────────────────────────────────────────────────────────
  describe('role gating', () => {
    it('GET profile → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/me/provider/profile');
      expect(res.status).toBe(403);
      expect(providerService.get).not.toHaveBeenCalled();
    });

    it('PATCH profile → 403 for a non-provider session (CSRF passes first)', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ displayName: 'Ada' });
      expect(res.status).toBe(403);
      expect(providerService.update).not.toHaveBeenCalled();
    });

    it('PATCH availability → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/availability')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ availability: 'ONLINE' });
      expect(res.status).toBe(403);
    });

    it('upgrade does NOT require the provider role (this is how seekers become providers)', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      providerService.upgrade.mockResolvedValue({ profile: PROFILE_FIXTURE });
      const res = await request(app.getHttpServer())
        .post('/v1/me/provider/upgrade')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(providerService.upgrade).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── upgrade ────────────────────────────────────────────────────────────
  describe('POST /upgrade', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/provider/upgrade');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(providerService.upgrade).not.toHaveBeenCalled();
    });

    it('returns the provider profile envelope', async () => {
      providerService.upgrade.mockResolvedValue({ profile: PROFILE_FIXTURE });
      const res = await request(app.getHttpServer())
        .post('/v1/me/provider/upgrade')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body.profile.id).toBe('pp-1');
      expect(res.body.profile).not.toHaveProperty('userId');
    });

    // Sprint security audit: the upgrade endpoint takes ZERO client-supplied
    // fields. The empty-body DTO + forbidNonWhitelisted pipe must reject any
    // attempt to inject userId / role / status / admin flags before the
    // service is reached. Without this layer, a malicious client could not
    // gain admin access (the service ignores the body), but a future
    // refactor that reads from `@Body()` would silently re-open the door.
    it('rejects every forbidden field a client could try to inject', async () => {
      providerService.upgrade.mockResolvedValue({ profile: PROFILE_FIXTURE });
      for (const payload of [
        { userId: 'user-victim' },
        { email: 'attacker@example.com' },
        { role: 'admin' },
        { roles: ['admin'] },
        { isAdmin: true },
        { admin: true },
        { status: 'ACTIVE' },
        { providerProfile: { status: 'ACTIVE' } },
        { availability: 'ONLINE' },
      ]) {
        const res = await request(app.getHttpServer())
          .post('/v1/me/provider/upgrade')
          .set('Cookie', 'hsm_csrf=tok')
          .set('X-CSRF-Token', 'tok')
          .send(payload);
        expect(res.status).toBe(400);
        expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(providerService.upgrade).not.toHaveBeenCalled();
      }
    });
  });

  // ─── GET ────────────────────────────────────────────────────────────────
  describe('GET /profile', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('returns the profile envelope and forwards userId from the session', async () => {
      providerService.get.mockResolvedValue({ profile: PROFILE_FIXTURE });
      const res = await request(app.getHttpServer()).get('/v1/me/provider/profile');
      expect(res.status).toBe(200);
      expect(res.body.profile.displayName).toBe('Ada Lovelace');
      expect(providerService.get).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── PATCH /profile ─────────────────────────────────────────────────────
  describe('PATCH /profile', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('rejects without CSRF (CsrfGuard fires before service)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .send({ displayName: 'New Name' });
      expect(res.status).toBe(401);
      expect(providerService.update).not.toHaveBeenCalled();
    });

    it('forwards a valid PATCH with service area + categoryIds', async () => {
      providerService.update.mockResolvedValue({
        profile: { ...PROFILE_FIXTURE, displayName: 'Grace Hopper', serviceAreaCity: 'Riyadh' },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({
          displayName: 'Grace Hopper',
          bio: 'Compiler pioneer',
          serviceAreaCity: 'Riyadh',
          serviceAreaCountry: 'Saudi Arabia',
          serviceAreaLat: 24.7136,
          serviceAreaLng: 46.6753,
          serviceAreaRadiusKm: 25,
          categoryIds: ['cat-plumbing', 'cat-electrical'],
        });
      expect(res.status).toBe(200);
      expect(res.body.profile.serviceAreaCity).toBe('Riyadh');
      expect(providerService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          displayName: 'Grace Hopper',
          serviceAreaCity: 'Riyadh',
          serviceAreaLat: 24.7136,
          categoryIds: ['cat-plumbing', 'cat-electrical'],
        }),
      );
    });

    it('rejects forbidden fields (forbidNonWhitelisted blocks userId / email / role / status)', async () => {
      for (const payload of [
        { userId: 'user-victim' },
        { email: 'attacker@example.com' },
        { role: 'admin' },
        { status: 'SUSPENDED' },
        { ratingAvg: 5 },
        { completedJobs: 9999 },
        { verified: true },
        { topPro: true },
        { availability: 'ONLINE' },
      ]) {
        const res = await request(app.getHttpServer())
          .patch('/v1/me/provider/profile')
          .set('Cookie', 'hsm_csrf=tok')
          .set('X-CSRF-Token', 'tok')
          .send(payload);
        expect(res.status).toBe(400);
        expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(providerService.update).not.toHaveBeenCalled();
      }
    });

    it('rejects oversize bio (MaxLength 500)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ bio: 'x'.repeat(501) });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects categoryIds with non-string entries', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ categoryIds: ['cat-plumbing', 42] });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects out-of-range latitude', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ serviceAreaLat: 999 });
      expect(res.status).toBe(400);
    });

    it('error bodies do not leak Prisma / SQL strings', async () => {
      providerService.update.mockRejectedValue(
        Object.assign(new Error('PrismaClientKnownRequestError: column "x" does not exist'), {
          name: 'PrismaClientKnownRequestError',
        }),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/profile')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ displayName: 'Grace' });
      expect(JSON.stringify(res.body)).not.toMatch(
        /prisma|column .* does not exist|SELECT |INSERT |UPDATE /i,
      );
    });
  });

  // ─── PATCH /availability ────────────────────────────────────────────────
  describe('PATCH /availability', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('rejects without CSRF', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/availability')
        .send({ availability: 'ONLINE' });
      expect(res.status).toBe(401);
    });

    it('persists the new availability and returns the fresh summary', async () => {
      providerService.updateAvailability.mockResolvedValue({
        profile: { ...PROFILE_FIXTURE, availability: 'ONLINE' as const },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/availability')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ availability: 'ONLINE' });
      expect(res.status).toBe(200);
      expect(res.body.profile.availability).toBe('ONLINE');
      expect(providerService.updateAvailability).toHaveBeenCalledWith('user-1', {
        availability: 'ONLINE',
      });
    });

    it('rejects unknown availability values', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me/provider/availability')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ availability: 'INVISIBLE' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
