import { HealthService } from './health.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { MongoService } from '../mongo/mongo.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

function mkDep(ready: boolean, pingOk = ready) {
  return {
    isReady: () => ready,
    ping: async () => pingOk,
  };
}

// Sprint 4 — readiness now consults MONGODB_ENABLED. Most cases below assert
// the historical behaviour, so they opt Mongo IN explicitly; the new
// disabled-path tests at the bottom are the ones that turn it off.
function mkConfig(mongoEnabled: boolean): AppConfigService {
  return {
    get: (k: string) => (k === 'MONGODB_ENABLED' ? mongoEnabled : undefined),
  } as unknown as AppConfigService;
}

function mkService(
  prisma: unknown,
  mongo: unknown,
  redis: unknown,
  mongoEnabled = true,
): HealthService {
  return new HealthService(
    prisma as PrismaService,
    mongo as MongoService,
    redis as RedisService,
    mkConfig(mongoEnabled),
  );
}

describe('HealthService', () => {
  it('liveness returns ok regardless of deps', () => {
    const svc = mkService(mkDep(false), mkDep(false), mkDep(false));
    const l = svc.liveness();
    expect(l.status).toBe('ok');
    expect(typeof l.uptimeSeconds).toBe('number');
    expect(typeof l.timestamp).toBe('string');
  });

  it('readiness is true when all deps report up', async () => {
    const svc = mkService(mkDep(true), mkDep(true), mkDep(true));
    const r = await svc.readiness();
    expect(r.ready).toBe(true);
    expect(r.dependencies.every((d) => d.status === 'up')).toBe(true);
  });

  it('readiness is false when any dep is down', async () => {
    const svc = mkService(mkDep(true), mkDep(false), mkDep(true));
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
    const svc = mkService(throwing, mkDep(true), mkDep(true));
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.dependencies.find((d) => d.name === 'postgres')?.status).toBe('down');
  });

  it('readiness is false when isReady is false even if ping would succeed', async () => {
    const svc = mkService(
      { isReady: () => false, ping: async () => true },
      mkDep(true),
      mkDep(true),
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
    const svc = mkService(hung, mkDep(true), mkDep(true));
    const started = Date.now();
    const r = await svc.readiness();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.ready).toBe(false);
    expect(r.dependencies.find((d) => d.name === 'postgres')?.status).toBe('down');
  }, 10_000);

  // ── Sprint 4: Mongo is optional (docs/adr/0002-mongodb.md) ───────────────

  it('omits mongo from readiness when MONGODB_ENABLED=false', async () => {
    const svc = mkService(mkDep(true), mkDep(false), mkDep(true), false);
    const r = await svc.readiness();
    expect(r.dependencies.map((d) => d.name)).toEqual(['postgres', 'redis']);
  });

  it('stays READY with a dead Mongo when MONGODB_ENABLED=false', async () => {
    // The whole point of the change: a store with no domain consumer must not
    // be able to pull the instance out of the load-balancer pool.
    const svc = mkService(mkDep(true), mkDep(false), mkDep(true), false);
    const r = await svc.readiness();
    expect(r.ready).toBe(true);
  });

  it('never pings Mongo when MONGODB_ENABLED=false', async () => {
    // Not merely "excluded from the report" — the disabled dependency must not
    // be dialled at all, or a hung driver still costs the probe its timeout.
    const ping = jest.fn().mockResolvedValue(true);
    const isReady = jest.fn().mockReturnValue(true);
    const svc = mkService(mkDep(true), { isReady, ping }, mkDep(true), false);
    await svc.readiness();
    expect(isReady).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });

  it('still fails readiness for a down Mongo when MONGODB_ENABLED=true', async () => {
    // The escape hatch must not become a way to ignore a dependency that a
    // deployment genuinely opted into.
    const svc = mkService(mkDep(true), mkDep(false), mkDep(true), true);
    const r = await svc.readiness();
    expect(r.ready).toBe(false);
    expect(r.dependencies.map((d) => d.name)).toContain('mongo');
  });
});
