// Route-level e2e for /v1/admin/providers (Sprint 6.2 refined).
// Pins the new PATCH :id/review-notes + GET :id/audit endpoints
// alongside the existing approve/reject/suspend/reactivate set.
//
// Real HTTP stack (cookie-parser, ValidationPipe, exception filter,
// real RolesGuard); JwtAuthGuard + CsrfGuard overridden with fakes.

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
import { AdminVerificationController } from '../../src/modules/admin/verification/admin-verification.controller';
import { AdminVerificationService } from '../../src/modules/admin/verification/admin-verification.service';
import { AdminVerificationCaseService } from '../../src/modules/admin/verification/admin-verification-case.service';
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

const verificationService = {
  list: jest.fn(),
  detail: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  suspend: jest.fn(),
  reactivate: jest.fn(),
  updateReviewNotes: jest.fn(),
  getAuditHistory: jest.fn(),
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
    controllers: [AdminVerificationController],
    providers: [
      Reflector,
      { provide: AdminVerificationService, useValue: verificationService },
      // Sprint 9B — the controller now also resolves the case service, for
      // GET /:providerProfileId/verification. Stubbed to null ("this provider
      // has never submitted"), which is a legitimate state, so these Sprint 6.2
      // assertions keep testing the routes they were written for.
      { provide: AdminVerificationCaseService, useValue: { forProvider: async () => null } },
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
  id: 'pp-1',
  status: 'PENDING_REVIEW' as const,
  userId: 'u-prov-1',
  email: 'p@example.com',
  displayName: 'Ada L.',
  initials: 'AL',
  ratingAvg: 0,
  reviewCount: 0,
  completedJobs: 0,
  verified: false,
  topPro: false,
  serviceAreaCity: null,
  serviceAreaCountry: null,
  reviewNotes: null,
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

const AUDIT_ROW = {
  id: 'ae-1',
  type: 'ADMIN_PROVIDER_APPROVED',
  adminUserId: 'admin-1',
  metadata: { providerProfileId: 'pp-1', previousStatus: 'PENDING_REVIEW', newStatus: 'ACTIVE' },
  createdAt: '2026-05-02T00:00:00.000Z',
};

describe('AdminVerification (e2e) — /v1/admin/providers/* (Sprint 6.2 refined)', () => {
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
    it('GET /v1/admin/providers → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/providers');
      expect(res.status).toBe(401);
    });

    it('PATCH /v1/admin/providers/:id/review-notes → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: 'hi' });
      expect(res.status).toBe(401);
    });

    it('GET /v1/admin/providers/:id/audit → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/providers/pp-1/audit');
      expect(res.status).toBe(401);
    });
  });

  describe('role gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'u-c', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('list → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/providers');
      expect(res.status).toBe(403);
    });

    it('PATCH review-notes → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: 'hi' });
      expect(res.status).toBe(403);
      expect(verificationService.updateReviewNotes).not.toHaveBeenCalled();
    });

    it('GET audit → 403 for non-admin', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/providers/pp-1/audit');
      expect(res.status).toBe(403);
      expect(verificationService.getAuditHistory).not.toHaveBeenCalled();
    });
  });

  describe('list + filter', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the items envelope', async () => {
      verificationService.list.mockResolvedValue({ items: [PROFILE_FIXTURE], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/admin/providers');
      expect(res.status).toBe(200);
      expect(res.body.items[0].reviewNotes).toBeNull();
    });

    it('forwards ?status=PENDING_REVIEW', async () => {
      verificationService.list.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/providers?status=PENDING_REVIEW');
      expect(verificationService.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING_REVIEW' }),
      );
    });

    it('rejects unknown query param (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/providers?providerId=victim');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH review-notes', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the updated provider envelope', async () => {
      verificationService.updateReviewNotes.mockResolvedValue({
        provider: { ...PROFILE_FIXTURE, reviewNotes: 'flagged' },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: 'flagged' });
      expect(res.status).toBe(200);
      expect(res.body.provider.reviewNotes).toBe('flagged');
      expect(verificationService.updateReviewNotes).toHaveBeenCalledWith(
        'admin-1',
        'pp-1',
        'flagged',
      );
    });

    it('accepts an empty string (clears the notes)', async () => {
      verificationService.updateReviewNotes.mockResolvedValue({
        provider: { ...PROFILE_FIXTURE, reviewNotes: '' },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: '' });
      expect(res.status).toBe(200);
    });

    it('rejects extra body fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: 'x', status: 'ACTIVE' });
      expect(res.status).toBe(400);
      expect(verificationService.updateReviewNotes).not.toHaveBeenCalled();
    });

    it('rejects notes longer than 4000 chars', async () => {
      const tooLong = 'x'.repeat(4001);
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/pp-1/review-notes')
        .send({ notes: tooLong });
      expect(res.status).toBe(400);
    });

    it('surfaces NOT_FOUND on missing profile (no Prisma leak)', async () => {
      verificationService.updateReviewNotes.mockRejectedValue(
        new AppError('NOT_FOUND', 'Provider profile not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/providers/missing/review-notes')
        .send({ notes: 'x' });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/PrismaClient|invocation/i);
    });
  });

  describe('GET audit', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'admin-1', sessionId: 's', jti: 'j', roles: ['admin'] };
    });

    it('returns the items envelope', async () => {
      verificationService.getAuditHistory.mockResolvedValue({
        items: [AUDIT_ROW],
        nextCursor: null,
      });
      const res = await request(app.getHttpServer()).get('/v1/admin/providers/pp-1/audit');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe('ADMIN_PROVIDER_APPROVED');
    });

    it('forwards limit + cursor', async () => {
      verificationService.getAuditHistory.mockResolvedValue({ items: [], nextCursor: null });
      await request(app.getHttpServer()).get('/v1/admin/providers/pp-1/audit?limit=10&cursor=abc');
      expect(verificationService.getAuditHistory).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({ limit: 10, cursor: 'abc' }),
      );
    });

    it('rejects unknown query parameter', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/admin/providers/pp-1/audit?type=PROVIDER_APPROVED',
      );
      expect(res.status).toBe(400);
    });

    it('surfaces NOT_FOUND on missing profile', async () => {
      verificationService.getAuditHistory.mockRejectedValue(
        new AppError('NOT_FOUND', 'Provider profile not found.', 404),
      );
      const res = await request(app.getHttpServer()).get('/v1/admin/providers/missing/audit');
      expect(res.status).toBe(404);
    });
  });
});
