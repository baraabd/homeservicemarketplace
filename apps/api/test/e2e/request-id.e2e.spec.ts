// Route-level test for RequestIdMiddleware.
// Mounts a trivial probe controller that echoes req.id so we can verify:
//   - a valid incoming x-request-id is preserved and echoed back
//   - an unsafe/oversized incoming id is replaced with a fresh UUID
//   - a missing id triggers generation

import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';

import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
} from '../../src/infrastructure/http/request-id.middleware';

jest.setTimeout(30_000);

@Controller('probe')
class ProbeController {
  @Get('id')
  getId(@Req() req: Request) {
    return { id: (req as Request & { id?: string | number }).id ?? null };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('RequestIdMiddleware (route-level)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('generates a UUID when no x-request-id header is present', async () => {
    const res = await request(app.getHttpServer()).get('/probe/id');
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_RE);
    expect(res.body.id).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it('preserves a safe incoming x-request-id and echoes it back', async () => {
    const id = 'req_ABC-123.xyz_42';
    const res = await request(app.getHttpServer()).get('/probe/id').set(REQUEST_ID_HEADER, id);
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
    expect(res.body.id).toBe(id);
  });

  it('replaces an id containing disallowed characters (log-injection guard)', async () => {
    const res = await request(app.getHttpServer())
      .get('/probe/id')
      .set(REQUEST_ID_HEADER, 'bad id with spaces!');
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).not.toBe('bad id with spaces!');
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_RE);
  });

  it('replaces an oversize id (> 128 characters)', async () => {
    const huge = 'a'.repeat(200);
    const res = await request(app.getHttpServer()).get('/probe/id').set(REQUEST_ID_HEADER, huge);
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).not.toBe(huge);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_RE);
  });

  it('accepts exactly 128 characters of the allowed alphabet', async () => {
    const id = 'a'.repeat(128);
    const res = await request(app.getHttpServer()).get('/probe/id').set(REQUEST_ID_HEADER, id);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
  });
});
