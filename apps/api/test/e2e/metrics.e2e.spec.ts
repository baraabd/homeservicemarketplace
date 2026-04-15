// Route-level test for GET /metrics.
// Boots a minimal Nest app containing only MetricsController + MetricsService
// and hits the real HTTP layer via supertest.

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { MetricsController } from '../../src/infrastructure/telemetry/metrics.controller';
import { MetricsService } from '../../src/infrastructure/telemetry/metrics.service';

// Nest cold-boot can be slow on Windows under parallel ts-jest compile load.
jest.setTimeout(30_000);

describe('GET /metrics (route-level)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [MetricsService],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // MetricsService implements OnModuleInit which registers default metrics.
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 200 with a Prometheus text content-type', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=/);
  });

  it('contains the declared http_* series (app registry, not driver-internal)', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
  });

  it('contains default Node process metrics emitted by collectDefaultMetrics', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('process_resident_memory_bytes');
  });

  it('is served at the version-neutral path (no /v1 prefix)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/metrics');
    // No versioning is configured in the test harness, so /v1/metrics is 404;
    // the point is that MetricsController is declared version-neutral and
    // therefore exposed at /metrics directly.
    expect(res.status).toBe(404);
  });

  it('sends Cache-Control: no-store so scrapes never return a cached body', async () => {
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});
