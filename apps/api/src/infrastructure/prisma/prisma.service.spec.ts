// Mocks the @homeservicemarketplace/database package before importing
// PrismaService so the service binds to a controlled PrismaClient double.

const fakeClient = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
};

jest.mock('@homeservicemarketplace/database', () => ({
  __esModule: true,
  prisma: fakeClient,
  PrismaClient: class {},
}));

import { PrismaService } from './prisma.service';
import type { AppConfigService } from '../../config/app-config.service';

function mkConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const defaults: Record<string, unknown> = {
    STARTUP_MAX_RETRIES: 3,
    STARTUP_RETRY_BASE_MS: 1,
    STARTUP_RETRY_CAP_MS: 2,
    DATABASE_CONNECT_TIMEOUT_MS: 50,
  };
  const values = { ...defaults, ...overrides };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

describe('PrismaService', () => {
  beforeEach(() => {
    fakeClient.$connect.mockReset();
    fakeClient.$disconnect.mockReset();
    fakeClient.$queryRaw.mockReset();
  });

  it('connects successfully on the first attempt and reports ready', async () => {
    fakeClient.$connect.mockResolvedValueOnce(undefined);
    const svc = new PrismaService(mkConfig());
    await svc.onModuleInit();
    expect(svc.isReady()).toBe(true);
    expect(fakeClient.$connect).toHaveBeenCalledTimes(1);
  });

  it('retries on transient connect failure and eventually reports ready', async () => {
    fakeClient.$connect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);
    const svc = new PrismaService(mkConfig());
    await svc.onModuleInit();
    expect(svc.isReady()).toBe(true);
    expect(fakeClient.$connect).toHaveBeenCalledTimes(3);
  });

  it('throws and stays not-ready when all connect attempts fail', async () => {
    fakeClient.$connect.mockRejectedValue(new Error('boom'));
    const svc = new PrismaService(mkConfig());
    await expect(svc.onModuleInit()).rejects.toThrow('boom');
    expect(svc.isReady()).toBe(false);
  });

  it('fails fast when $connect hangs past DATABASE_CONNECT_TIMEOUT_MS', async () => {
    fakeClient.$connect.mockImplementation(() => new Promise(() => undefined));
    const svc = new PrismaService(
      mkConfig({ DATABASE_CONNECT_TIMEOUT_MS: 5, STARTUP_MAX_RETRIES: 1 }),
    );
    await expect(svc.onModuleInit()).rejects.toThrow(/timeout/i);
    expect(svc.isReady()).toBe(false);
  });

  it('ping returns true when query succeeds, false on failure', async () => {
    fakeClient.$connect.mockResolvedValueOnce(undefined);
    const svc = new PrismaService(mkConfig());
    await svc.onModuleInit();

    fakeClient.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    await expect(svc.ping()).resolves.toBe(true);

    fakeClient.$queryRaw.mockRejectedValueOnce(new Error('down'));
    await expect(svc.ping()).resolves.toBe(false);
  });

  it('onModuleDestroy disconnects and flips ready to false', async () => {
    fakeClient.$connect.mockResolvedValueOnce(undefined);
    fakeClient.$disconnect.mockResolvedValueOnce(undefined);
    const svc = new PrismaService(mkConfig());
    await svc.onModuleInit();
    await svc.onModuleDestroy();
    expect(svc.isReady()).toBe(false);
    expect(fakeClient.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy swallows disconnect errors so shutdown never crashes', async () => {
    fakeClient.$connect.mockResolvedValueOnce(undefined);
    fakeClient.$disconnect.mockRejectedValueOnce(new Error('already closed'));
    const svc = new PrismaService(mkConfig());
    await svc.onModuleInit();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });
});
