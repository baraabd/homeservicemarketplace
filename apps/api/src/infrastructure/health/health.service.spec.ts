import { HealthService } from './health.service';
import type { MongoService } from '../mongo/mongo.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

function mkDep(ready: boolean, pingOk = ready) {
  return {
    isReady: () => ready,
    ping: async () => pingOk,
  };
}

describe('HealthService', () => {
  it('liveness returns ok regardless of deps', () => {
    const svc = new HealthService(
      mkDep(false) as unknown as PrismaService,
      mkDep(false) as unknown as MongoService,
      mkDep(false) as unknown as RedisService,
    );
    const l = svc.liveness();
    expect(l.status).toBe('ok');
    expect(typeof l.uptimeSeconds).toBe('number');
    expect(typeof l.timestamp).toBe('string');
  });

  it('readiness is true when all deps report up', async () => {
    const svc = new HealthService(
      mkDep(true) as unknown as PrismaService,
      mkDep(true) as unknown as MongoService,
      mkDep(true) as unknown as RedisService,
    );
    const r = await svc.readiness();
    expect(r.ready).toBe(true);
    expect(r.dependencies.every((d) => d.status === 'up')).toBe(true);
  });

  it('readiness is false when any dep is down', async () => {
    const svc = new HealthService(
      mkDep(true) as unknown as PrismaService,
      mkDep(false) as unknown as MongoService,
      mkDep(true) as unknown as RedisService,
    );
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.dependencies.find((d) => d.name === 'mongo')?.status).toBe('down');
  });

  it('readiness treats thrown ping as down', async () => {
    const throwing = {
      isReady: () => true,
      ping: async () => {
        throw new Error('boom');
      },
    };
    const svc = new HealthService(
      throwing as unknown as PrismaService,
      mkDep(true) as unknown as MongoService,
      mkDep(true) as unknown as RedisService,
    );
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.dependencies.find((d) => d.name === 'postgres')?.status).toBe('down');
  });

  it('readiness is false when isReady is false even if ping would succeed', async () => {
    const svc = new HealthService(
      { isReady: () => false, ping: async () => true } as unknown as PrismaService,
      mkDep(true) as unknown as MongoService,
      mkDep(true) as unknown as RedisService,
    );
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
  });

  it('readiness treats a hung ping as down (per-dep timeout, no indefinite hang)', async () => {
    // Regression: without an internal timeout, a stalled driver would make
    // /health/ready hang past the orchestrator's probe deadline instead of
    // cleanly reporting 503.
    const hung = {
      isReady: () => true,
      ping: () => new Promise<boolean>(() => undefined), // never resolves
    };
    const svc = new HealthService(
      hung as unknown as PrismaService,
      mkDep(true) as unknown as MongoService,
      mkDep(true) as unknown as RedisService,
    );
    const started = Date.now();
    const r = await svc.readiness();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.ready).toBe(false);
    expect(r.dependencies.find((d) => d.name === 'postgres')?.status).toBe('down');
  }, 10_000);
});
