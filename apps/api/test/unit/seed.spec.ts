// Unit tests for the seed script's idempotency + production guard.
// Uses a virtual mock of the @prisma/client module via jest.mock so `prisma`
// exported from @homeservicemarketplace/database is a controllable fake.

import {
  assertSeedProductionSafe,
  isProductionSeedTarget,
  seed,
} from '@homeservicemarketplace/database';

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

// ── Sprint 9B.14 — what ALLOW_PROD_SEED must NOT unlock ────────────────────
//
// `ALLOW_PROD_SEED=true` is a legitimate operator action: roles, permissions
// and the category catalogue are reference data production genuinely needs, and
// this file is where they live. But the flag used to be ALL OR NOTHING, and two
// of the blocks it unlocked are not reference data at all:
//
//   - four accounts whose passwords are printed in this repository, two of them
//     ADMIN, created ACTIVE and email-verified — and re-running the seed
//     ROTATES THE PASSWORD BACK, so an operator who noticed and changed it
//     would have it silently restored;
//   - a global verification policy whose own comment says it is NOT LEGAL
//     ADVICE AND NOT A COUNTRY REQUIREMENT, against which real providers would
//     then be judged.
//
// `isProductionSeedTarget` gates both on NODE_ENV alone. There is now no
// combination of environment variables that puts either into production.

describe('isProductionSeedTarget — the second gate', () => {
  it('is true in production even WITH ALLOW_PROD_SEED set', () => {
    // The whole point: the escape hatch that unlocks reference data must not
    // also unlock the dev-only blocks.
    expect(
      isProductionSeedTarget({
        NODE_ENV: 'production',
        ALLOW_PROD_SEED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('is false everywhere the dev data belongs', () => {
    for (const NODE_ENV of ['development', 'test', 'staging', undefined]) {
      expect(isProductionSeedTarget({ NODE_ENV } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it('reads NODE_ENV and nothing else', () => {
    // Not the database URL, not a hostname, not a branch name. One input, so
    // there is one thing to get right when deploying.
    expect(
      isProductionSeedTarget({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/dev',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
