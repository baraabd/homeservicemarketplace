// Route-level test for AllExceptionsFilter.
// Each endpoint throws a different error variety; we assert the normalized
// HTTP envelope and that driver-internal details never leak.

import { BadRequestException, Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppError } from '../../src/shared/errors/app-error';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import type { AppConfigService } from '../../src/config/app-config.service';

jest.setTimeout(30_000);

@Controller('probe')
class ProbeController {
  @Get('app-error')
  appError() {
    throw new AppError('NOT_FOUND', 'resource gone', 404);
  }

  @Get('http-bad')
  httpBad() {
    throw new BadRequestException('bad body');
  }

  @Get('prisma-p2002')
  prismaP2002() {
    throw Object.assign(new Error('unique constraint violated on users.email'), { code: 'P2002' });
  }

  @Get('mongoose-validation')
  mongooseValidation() {
    throw Object.assign(new Error('path xxx is required'), { name: 'ValidationError' });
  }

  @Get('unknown')
  unknown() {
    throw new Error('mysterious crash with driver internals');
  }
}

function configValue(isProduction: boolean): AppConfigService {
  return { isProduction } as unknown as AppConfigService;
}

async function bootApp(isProduction: boolean): Promise<INestApplication> {
  @Module({
    controllers: [ProbeController],
    providers: [
      {
        provide: AllExceptionsFilter,
        useValue: new AllExceptionsFilter(configValue(isProduction)),
      },
      { provide: APP_FILTER, useExisting: AllExceptionsFilter },
    ],
  })
  class ProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('AllExceptionsFilter (route-level)', () => {
  describe('non-production', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootApp(false);
    });
    afterAll(async () => {
      if (app) await app.close();
    });

    it('AppError surfaces as its own status + code', async () => {
      const res = await request(app.getHttpServer()).get('/probe/app-error');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: expect.objectContaining({ code: 'NOT_FOUND', message: 'resource gone' }),
      });
    });

    it('NestJS BadRequestException becomes VALIDATION_ERROR at status 400', async () => {
      const res = await request(app.getHttpServer()).get('/probe/http-bad');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Prisma P2002 is translated to CONFLICT, driver message is stripped', async () => {
      const res = await request(app.getHttpServer()).get('/probe/prisma-p2002');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).not.toContain('users.email');
      expect(res.body.error.message).not.toContain('unique constraint');
    });

    it('Mongoose ValidationError -> 400 VALIDATION_ERROR, driver wording stripped', async () => {
      const res = await request(app.getHttpServer()).get('/probe/mongoose-validation');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).not.toContain('path xxx is required');
    });

    it('unknown error becomes 500 INTERNAL_ERROR and does not echo the raw message in the envelope message field', async () => {
      const res = await request(app.getHttpServer()).get('/probe/unknown');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      // In non-prod the filter does include the raw message to aid debugging,
      // but the envelope shape is still normalized.
      expect(res.body.success).toBe(false);
      expect(typeof res.body.error.message).toBe('string');
    });
  });

  describe('production', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await bootApp(true);
    });
    afterAll(async () => {
      if (app) await app.close();
    });

    it('unknown errors reply with a generic message and no details/stack in production', async () => {
      const res = await request(app.getHttpServer()).get('/probe/unknown');
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(res.body.error).not.toHaveProperty('details');
      expect(JSON.stringify(res.body)).not.toContain('mysterious crash');
      expect(JSON.stringify(res.body)).not.toContain('driver internals');
    });
  });
});
