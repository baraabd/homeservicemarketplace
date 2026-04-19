// Route-level e2e for the /v1/profiles and /v1/addresses surface. Mirrors
// the auth.e2e pattern: real ValidationPipe, real exception filter, real
// cookie parser; services and the JwtAuthGuard are substituted with
// in-test fakes so the HTTP layer is exercised without Prisma/Mongo/Redis.
//
// What these tests pin:
//   - authentication gate: no token → 401 via the same normalized code the
//     real JwtAuthGuard uses
//   - profile: GET/PATCH /me route the userId from req.user, not the body
//   - address ownership: cannot read/write another user's address through
//     ID guessing (404, no existence leak)
//   - latitude/longitude validation path through ValidationPipe → 400

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
import { AddressController } from '../../src/modules/address/controllers/address.controller';
import { AddressService } from '../../src/modules/address/services/address.service';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { ProfileController } from '../../src/modules/profile/controllers/profile.controller';
import { ProfileService } from '../../src/modules/profile/services/profile.service';

jest.setTimeout(30_000);

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return false;
    },
  } as unknown as AppConfigService;
}

let authedUserId: string | null = null;
class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!authedUserId) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: authedUserId, sessionId: 's1', jti: 'j1', roles: ['customer'] };
    return true;
  }
}

const profileService = {
  getOrCreate: jest.fn(),
  update: jest.fn(),
};

const addressService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  setDefault: jest.fn(),
};

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();

  @Module({
    controllers: [ProfileController, AddressController],
    providers: [
      { provide: ProfileService, useValue: profileService },
      { provide: AddressService, useValue: addressService },
      { provide: AppConfigService, useValue: config },
      { provide: JwtAuthGuard, useClass: FakeJwtAuthGuard },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
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

const sampleProfile = {
  id: 'prof-1',
  userId: 'u1',
  avatarUrl: null,
  phoneNumber: null,
  bio: null,
  createdAt: '2026-04-19T00:00:00.000Z',
  updatedAt: '2026-04-19T00:00:00.000Z',
};

const sampleAddress = {
  id: 'a1',
  userId: 'u1',
  label: 'Home',
  street: '1 Main',
  city: 'Cairo',
  state: null,
  zipCode: null,
  country: 'EG',
  latitude: null,
  longitude: null,
  isDefault: true,
  createdAt: '2026-04-19T00:00:00.000Z',
  updatedAt: '2026-04-19T00:00:00.000Z',
};

describe('Profile + Address controllers (e2e)', () => {
  let app: INestApplication;

  beforeEach(() => {
    Object.values(profileService).forEach((m) => (m as jest.Mock).mockReset());
    Object.values(addressService).forEach((m) => (m as jest.Mock).mockReset());
    authedUserId = null;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // --- Profile ------------------------------------------------------------
  describe('GET /v1/profiles/me', () => {
    it('returns 401 AUTH_INVALID_CREDENTIALS without a token', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).get('/v1/profiles/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(profileService.getOrCreate).not.toHaveBeenCalled();
    });

    it('routes the userId from req.user, not the request body', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      profileService.getOrCreate.mockResolvedValueOnce(sampleProfile);
      const res = await request(app.getHttpServer()).get('/v1/profiles/me');
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe('u1');
      expect(profileService.getOrCreate).toHaveBeenCalledWith('u1');
    });
  });

  describe('PATCH /v1/profiles/me', () => {
    it('returns 401 without a token', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).patch('/v1/profiles/me').send({ bio: 'hi' });
      expect(res.status).toBe(401);
    });

    it('updates only whitelisted fields (forbidNonWhitelisted)', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const res = await request(app.getHttpServer())
        .patch('/v1/profiles/me')
        .send({ bio: 'hi', userId: 'u-evil' }); // attempt to override userId
      expect(res.status).toBe(400);
    });

    it('rejects an invalid avatarUrl (not an http(s) URL)', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const res = await request(app.getHttpServer())
        .patch('/v1/profiles/me')
        .send({ avatarUrl: 'ftp://not-allowed/x.png' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts null to clear a field', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      profileService.update.mockResolvedValueOnce({ ...sampleProfile, bio: null });
      const res = await request(app.getHttpServer()).patch('/v1/profiles/me').send({ bio: null });
      expect(res.status).toBe(200);
      expect(profileService.update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ bio: null }),
      );
    });
  });

  // --- Addresses ----------------------------------------------------------
  describe('GET /v1/addresses', () => {
    it('returns 401 without a token', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).get('/v1/addresses');
      expect(res.status).toBe(401);
    });

    it('returns { items } scoped to the caller user', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      addressService.list.mockResolvedValueOnce([sampleAddress]);
      const res = await request(app.getHttpServer()).get('/v1/addresses');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(addressService.list).toHaveBeenCalledWith('u1');
    });
  });

  describe('POST /v1/addresses', () => {
    it('returns 401 without a token', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).post('/v1/addresses').send({
        street: '1 Main',
        city: 'Cairo',
        country: 'EG',
      });
      expect(res.status).toBe(401);
    });

    it('rejects latitude outside [-90, 90] via ValidationPipe', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const res = await request(app.getHttpServer()).post('/v1/addresses').send({
        street: '1 Main',
        city: 'Cairo',
        country: 'EG',
        latitude: 91,
        longitude: 0,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects longitude outside [-180, 180]', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const res = await request(app.getHttpServer()).post('/v1/addresses').send({
        street: '1 Main',
        city: 'Cairo',
        country: 'EG',
        latitude: 0,
        longitude: 181,
      });
      expect(res.status).toBe(400);
    });

    it('accepts valid payload → 201 with the created DTO', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      addressService.create.mockResolvedValueOnce(sampleAddress);
      const res = await request(app.getHttpServer()).post('/v1/addresses').send({
        label: 'Home',
        street: '1 Main',
        city: 'Cairo',
        country: 'EG',
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('a1');
      expect(addressService.create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          street: '1 Main',
        }),
      );
    });
  });

  describe('PATCH /v1/addresses/:addressId', () => {
    it('returns 404 when service throws ADDRESS_NOT_FOUND (ownership leaks are prevented)', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const { NotFoundException } = await import('@nestjs/common');
      addressService.update.mockRejectedValueOnce(
        new NotFoundException({ code: 'ADDRESS_NOT_FOUND' }),
      );
      const res = await request(app.getHttpServer())
        .patch('/v1/addresses/some-id-belonging-to-u2')
        .send({ city: 'Alexandria' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND');
    });
  });

  describe('DELETE /v1/addresses/:addressId', () => {
    it('204 on success', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      addressService.remove.mockResolvedValueOnce(undefined);
      const res = await request(app.getHttpServer()).delete('/v1/addresses/a1');
      expect(res.status).toBe(204);
      expect(addressService.remove).toHaveBeenCalledWith('u1', 'a1');
    });

    it('404 when the address is not owned by the caller', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      const { NotFoundException } = await import('@nestjs/common');
      addressService.remove.mockRejectedValueOnce(
        new NotFoundException({ code: 'ADDRESS_NOT_FOUND' }),
      );
      const res = await request(app.getHttpServer()).delete('/v1/addresses/not-mine');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /v1/addresses/:addressId/set-default', () => {
    it('200 on success', async () => {
      app = await bootApp();
      authedUserId = 'u1';
      addressService.setDefault.mockResolvedValueOnce(sampleAddress);
      const res = await request(app.getHttpServer()).post('/v1/addresses/a1/set-default');
      expect(res.status).toBe(200);
      expect(res.body.isDefault).toBe(true);
    });

    it('returns 401 without a token', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).post('/v1/addresses/a1/set-default');
      expect(res.status).toBe(401);
    });
  });
});
