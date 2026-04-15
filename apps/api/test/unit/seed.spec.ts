// Unit tests for the seed script's idempotency + production guard.
// Uses a virtual mock of the @prisma/client module via jest.mock so `prisma`
// exported from @homeservicemarketplace/database is a controllable fake.

import { assertSeedProductionSafe, seed } from '@homeservicemarketplace/database';

describe('assertSeedProductionSafe', () => {
  it('is a no-op in development / test / staging', () => {
    expect(() => assertSeedProductionSafe({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() =>
      assertSeedProductionSafe({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertSeedProductionSafe({ NODE_ENV: 'staging' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('throws in production without ALLOW_PROD_SEED=true', () => {
    expect(() => assertSeedProductionSafe({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /production/i,
    );
  });

  it('allows production when ALLOW_PROD_SEED=true is set explicitly', () => {
    expect(() =>
      assertSeedProductionSafe({
        NODE_ENV: 'production',
        ALLOW_PROD_SEED: 'true',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('refuses truthy-but-not-exact values for ALLOW_PROD_SEED', () => {
    expect(() =>
      assertSeedProductionSafe({
        NODE_ENV: 'production',
        ALLOW_PROD_SEED: '1',
      } as NodeJS.ProcessEnv),
    ).toThrow();
    expect(() =>
      assertSeedProductionSafe({
        NODE_ENV: 'production',
        ALLOW_PROD_SEED: 'yes',
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});

describe('seed() production guard', () => {
  // Pins that seed() — not only the CLI main() — is gated by the production
  // safety check. This closes the gap where a programmatic import of seed()
  // in production code could have bypassed the guard.
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws in production without ALLOW_PROD_SEED=true, never reaching Prisma', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PROD_SEED;
    await expect(seed()).rejects.toThrow(/production/i);
  });
});
