// Route-level tests for /health/live and /health/ready.
// Boots a minimal Nest HTTP app containing only HealthController + HealthService
// and substitutes the three infra dependencies with controllable fakes.

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// The first Nest boot inside jest can be slow on Windows when many ts-jest
// workers are compiling in parallel; bump the per-suite timeout generously
// so this stays deterministic. No runtime impact.
jest.setTimeout(30_000);

import { HealthController } from '../../src/infrastructure/health/health.controller';
import { HealthService } from '../../src/infrastructure/health/health.service';
import { MongoService } from '../../src/infrastructure/mongo/mongo.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';

type DepState = { ready: boolean; ping: boolean | 'throw' };

function makeDep(state: DepState) {
  return {
    isReady: () => state.ready,
    ping: async () => {
      if (state.ping === 'throw') throw new Error('driver-down');
      return state.ping;
    },
  };
}

async function bootApp(states: {
  pg: DepState;
  mongo: DepState;
  redis: DepState;
}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      HealthService,
      { provide: PrismaService, useValue: makeDep(states.pg) },
      { provide: MongoService, useValue: makeDep(states.mongo) },
      { provide: RedisService, useValue: makeDep(states.redis) },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('Health endpoints (route-level)', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('GET /health/live', () => {
    it('returns 200 and the liveness envelope even when every dependency is down', async () => {
      app = await bootApp({
        pg: { ready: false, ping: false },
        mongo: { ready: false, ping: false },
        redis: { ready: false, ping: false },
      });

      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(typeof res.body.timestamp).toBe('string');
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('returns 200 when everything is healthy too', async () => {
      app = await bootApp({
        pg: { ready: true, ping: true },
        mongo: { ready: true, ping: true },
        redis: { ready: true, ping: true },
      });
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 with every dependency reported as "up" when healthy', async () => {
      app = await bootApp({
        pg: { ready: true, ping: true },
        mongo: { ready: true, ping: true },
        redis: { ready: true, ping: true },
      });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.ready).toBe(true);
      const names = (res.body.dependencies as Array<{ name: string; status: string }>)
        .map((d) => d.name)
        .sort();
      expect(names).toEqual(['mongo', 'postgres', 'redis']);
      expect(
        (res.body.dependencies as Array<{ status: string }>).every((d) => d.status === 'up'),
      ).toBe(true);
    });

    it('returns 503 when a single dependency is down and marks only that dep as "down"', async () => {
      app = await bootApp({
        pg: { ready: true, ping: true },
        mongo: { ready: false, ping: false },
        redis: { ready: true, ping: true },
      });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
      const byName = new Map<string, string>(
        (res.body.dependencies as Array<{ name: string; status: string }>).map((d) => [
          d.name,
          d.status,
        ]),
      );
      expect(byName.get('postgres')).toBe('up');
      expect(byName.get('mongo')).toBe('down');
      expect(byName.get('redis')).toBe('up');
    });

    it('returns 503 when postgres is down — postgres is required infra', async () => {
      app = await bootApp({
        pg: { ready: false, ping: false },
        mongo: { ready: true, ping: true },
        redis: { ready: true, ping: true },
      });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.ready).toBe(false);
      const byName = new Map<string, string>(
        (res.body.dependencies as Array<{ name: string; status: string }>).map((d) => [
          d.name,
          d.status,
        ]),
      );
      expect(byName.get('postgres')).toBe('down');
    });

    it('returns 503 when redis is down — current impl has no degraded fallback', async () => {
      app = await bootApp({
        pg: { ready: true, ping: true },
        mongo: { ready: true, ping: true },
        redis: { ready: false, ping: false },
      });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      const byName = new Map<string, string>(
        (res.body.dependencies as Array<{ name: string; status: string }>).map((d) => [
          d.name,
          d.status,
        ]),
      );
      expect(byName.get('redis')).toBe('down');
    });

    it('treats a thrown ping() as "down" without surfacing the driver error to the client', async () => {
      app = await bootApp({
        pg: { ready: true, ping: 'throw' },
        mongo: { ready: true, ping: true },
        redis: { ready: true, ping: true },
      });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain('driver-down');
      const byName = new Map<string, string>(
        (res.body.dependencies as Array<{ name: string; status: string }>).map((d) => [
          d.name,
          d.status,
        ]),
      );
      expect(byName.get('postgres')).toBe('down');
    });

    it('returns 503 when every dependency is down', async () => {
      app = await bootApp({
        pg: { ready: false, ping: false },
        mongo: { ready: false, ping: false },
        redis: { ready: false, ping: false },
      });

      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(res.status).toBe(503);
      expect(
        (res.body.dependencies as Array<{ status: string }>).every((d) => d.status === 'down'),
      ).toBe(true);
    });

    it('response shape is normalized: { ready: boolean, dependencies: [{ name, status }] }', async () => {
      app = await bootApp({
        pg: { ready: true, ping: true },
        mongo: { ready: true, ping: true },
        redis: { ready: true, ping: true },
      });
      const res = await request(app.getHttpServer()).get('/health/ready');
      expect(Object.keys(res.body).sort()).toEqual(['dependencies', 'ready']);
      for (const dep of res.body.dependencies as Array<Record<string, unknown>>) {
        expect(Object.keys(dep).sort()).toEqual(['name', 'status']);
        expect(typeof dep.name).toBe('string');
        expect(typeof dep.status).toBe('string');
      }
    });
  });
});
