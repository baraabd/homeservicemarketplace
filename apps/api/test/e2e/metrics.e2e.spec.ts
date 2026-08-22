// Route-level test for GET /metrics.
// Boots a minimal Nest app containing only MetricsController + MetricsService
// and hits the real HTTP layer via supertest.
//
// Sprint 3 — the endpoint is now gated by MetricsAccessGuard, so the harness
// supplies a config. The scrape-content tests below run with NO token in a
// non-production config, which is the guard's "open" branch; the access-control
// behaviour has its own describe block at the bottom and its own unit suite.

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { MetricsAccessGuard } from '../../src/infrastructure/telemetry/metrics-access.guard';
import { MetricsController } from '../../src/infrastructure/telemetry/metrics.controller';
import { MetricsService } from '../../src/infrastructure/telemetry/metrics.service';

function configStub(over: { token?: string; production?: boolean } = {}): AppConfigService {
  return {
    get: (key: string) => (key === 'METRICS_TOKEN' ? over.token : undefined),
    get isProduction() {
      return over.production ?? false;
    },
  } as unknown as AppConfigService;
}

// Nest cold-boot can be slow on Windows under parallel ts-jest compile load.
jest.setTimeout(30_000);

describe('GET /metrics (route-level)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        MetricsAccessGuard,
        { provide: AppConfigService, useValue: configStub() },
      ],
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

// ── Sprint 3: access control over real HTTP ────────────────────────────────
//
// The unit suite covers the guard's decision logic. This covers the wire: that
// the decision actually reaches a client as a status code, through the real
// Nest HTTP stack rather than a mocked ExecutionContext.
describe('GET /metrics — access control', () => {
  async function bootWith(over: { token?: string; production?: boolean }) {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        MetricsAccessGuard,
        { provide: AppConfigService, useValue: configStub(over) },
      ],
    }).compile();
    const instance = moduleRef.createNestApplication({ logger: false });
    await instance.init();
    return instance;
  }

  it('is 404 in production when no token is configured', async () => {
    const instance = await bootWith({ production: true });
    try {
      await request(instance.getHttpServer()).get('/metrics').expect(404);
    } finally {
      await instance.close();
    }
  });

  it('is open in development when no token is configured', async () => {
    const instance = await bootWith({ production: false });
    try {
      await request(instance.getHttpServer()).get('/metrics').expect(200);
    } finally {
      await instance.close();
    }
  });

  it('requires the bearer token once one is configured', async () => {
    const instance = await bootWith({ token: 'a-metrics-token-at-least-16', production: true });
    try {
      const server = instance.getHttpServer();
      await request(server).get('/metrics').expect(404);
      await request(server)
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-token-x')
        .expect(404);
      await request(server)
        .get('/metrics')
        .set('Authorization', 'Bearer a-metrics-token-at-least-16')
        .expect(200);
    } finally {
      await instance.close();
    }
  });

  it('never reveals that the endpoint exists', async () => {
    // A 401 would confirm "there is something here worth a credential", which
    // is an invitation to keep guessing. The status must match a route that
    // genuinely does not exist.
    //
    // Only the STATUS is compared, not the body. Nest's built-in 404 for an
    // unrouted path carries `Cannot GET /no-such-route`, while a thrown
    // NotFoundException carries `Not Found` — a difference this bare harness
    // exposes and the real app does not, because AllExceptionsFilter
    // normalises both into one envelope. Asserting byte-equality here would
    // be asserting a property of the harness.
    const instance = await bootWith({ token: 'a-metrics-token-at-least-16', production: true });
    try {
      const denied = await request(instance.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer nope-nope-nope-nope');
      const missing = await request(instance.getHttpServer()).get('/no-such-route');

      expect(denied.status).toBe(404);
      expect(denied.status).toBe(missing.status);

      // Whatever the body is, it must not hint at what was refused or why.
      const body = JSON.stringify(denied.body).toLowerCase();
      expect(body).not.toContain('metric');
      expect(body).not.toContain('token');
      expect(body).not.toContain('authoriz');
      expect(body).not.toContain('forbidden');
    } finally {
      await instance.close();
    }
  });
});
