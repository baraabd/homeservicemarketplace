// R18 (D-19) — the operator inputs of the work-access readiness routine. The
// SQL itself runs against PostgreSQL in
// test/integration/r18-work-access-readiness.integration.spec.ts.
import {
  assertBackfillNotProductionUnsafe,
  backfillMissingGrantsWithTx,
  DEFAULT_BACKFILL_LIMIT,
  MAX_BACKFILL_LIMIT,
  resolveBackfillLimit,
} from '@homeservicemarketplace/database';

describe('work-access readiness inputs', () => {
  it('bounds every backfill run', () => {
    expect(resolveBackfillLimit([])).toBe(DEFAULT_BACKFILL_LIMIT);
    expect(resolveBackfillLimit(['--apply', '--limit=25'])).toBe(25);
    expect(resolveBackfillLimit([`--limit=${MAX_BACKFILL_LIMIT}`])).toBe(MAX_BACKFILL_LIMIT);
    for (const bad of ['0', '-1', '2.5', 'all', `${MAX_BACKFILL_LIMIT + 1}`, '']) {
      expect(() => resolveBackfillLimit([`--limit=${bad}`])).toThrow(/--limit/);
    }
  });

  it('refuses an unbounded limit before touching the database', async () => {
    const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };
    await expect(
      backfillMissingGrantsWithTx(tx as never, MAX_BACKFILL_LIMIT + 1),
    ).rejects.toThrow();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('writes grants in production only with an explicit opt-in', () => {
    expect(() =>
      assertBackfillNotProductionUnsafe({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/ALLOW_PROD_WORK_ACCESS_BACKFILL/);
    expect(() =>
      assertBackfillNotProductionUnsafe({
        NODE_ENV: 'production',
        ALLOW_PROD_WORK_ACCESS_BACKFILL: 'yes',
      } as NodeJS.ProcessEnv),
    ).toThrow();
    expect(() =>
      assertBackfillNotProductionUnsafe({
        NODE_ENV: 'production',
        ALLOW_PROD_WORK_ACCESS_BACKFILL: 'true',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertBackfillNotProductionUnsafe({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
