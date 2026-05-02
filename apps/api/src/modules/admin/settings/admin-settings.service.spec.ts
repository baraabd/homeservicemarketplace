import type {
  PlatformSettingRepository,
  PlatformSettingRow,
} from '../../../infrastructure/persistence/settings/platform-setting.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminSettingsService } from './admin-settings.service';

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

function makeRow(over: Partial<PlatformSettingRow> = {}): PlatformSettingRow {
  return {
    key: 'platform_fee_bps',
    value: 1500 as unknown as PlatformSettingRow['value'],
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    updatedBy: 'admin-1',
    ...over,
  };
}

interface Mocks {
  settings: PlatformSettingRepository;
  audit: AdminAuditService;
}

function makeMocks(initialRows: PlatformSettingRow[] = []): Mocks {
  let rows = [...initialRows];
  return {
    settings: {
      list: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      findByKey: jest.fn().mockImplementation((key: string) => {
        return Promise.resolve(rows.find((r) => r.key === key) ?? null);
      }),
      upsert: jest
        .fn()
        .mockImplementation((input: { key: string; value: unknown; updatedBy: string }) => {
          const next: PlatformSettingRow = {
            key: input.key,
            value: input.value as PlatformSettingRow['value'],
            updatedAt: new Date(),
            updatedBy: input.updatedBy,
          };
          rows = rows.filter((r) => r.key !== input.key).concat(next);
          return Promise.resolve(next);
        }),
      delete: jest.fn().mockImplementation((key: string) => {
        const removed = rows.find((r) => r.key === key);
        rows = rows.filter((r) => r.key !== key);
        return Promise.resolve(removed ?? null);
      }),
    } as unknown as PlatformSettingRepository,
    audit: { record: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminSettingsService {
  return new AdminSettingsService(m.settings, m.audit, tx);
}

describe('AdminSettingsService.getBulk', () => {
  it('returns defaults for every whitelisted key when the table is empty', async () => {
    const m = makeMocks([]);
    const out = await makeService(m).getBulk();
    expect(out.values.platform_fee_bps).toBe(1000);
    expect(out.values.default_currency).toBe('USD');
    expect(out.values.support_email).toMatch(/@/);
    expect(out.values.feature_show_hourly_rate).toBe(false);
    expect(out.lastUpdatedAt).toBeNull();
  });

  it('overlays persisted rows on top of defaults', async () => {
    const m = makeMocks([makeRow({ key: 'platform_fee_bps', value: 500 })]);
    const out = await makeService(m).getBulk();
    expect(out.values.platform_fee_bps).toBe(500);
    expect(out.values.default_currency).toBe('USD'); // still default
    expect(out.lastUpdatedAt).toBe('2026-05-02T00:00:00.000Z');
  });

  it('does not surface keys outside the whitelist', async () => {
    const m = makeMocks([
      makeRow({ key: 'platform_fee_bps', value: 500 }),
      makeRow({ key: 'secret_internal_key', value: 'leak' }),
    ]);
    const out = await makeService(m).getBulk();
    expect(out.values.secret_internal_key).toBeUndefined();
    expect(out.values.platform_fee_bps).toBe(500);
  });
});

describe('AdminSettingsService.updateBulk', () => {
  it('persists a valid integer + writes audit row + emits changedKeys', async () => {
    const m = makeMocks([]);
    const out = await makeService(m).updateBulk('admin-1', { platform_fee_bps: 1200 });
    expect(out.changedKeys).toEqual(['platform_fee_bps']);
    expect(out.values.platform_fee_bps).toBe(1200);
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        type: 'ADMIN_SETTING_UPDATED',
        metadata: expect.objectContaining({
          key: 'platform_fee_bps',
          previousValue: null,
          newValue: 1200,
          source: 'bulk',
          changed: true,
        }),
      }),
      undefined,
    );
  });

  it('rejects an unknown setting key at 400', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { JWT_SECRET: 'pwned' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects out-of-range integer (platform_fee_bps > 10000)', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { platform_fee_bps: 12_000 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects negative integer (platform_fee_bps < 0)', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { platform_fee_bps: -1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects non-integer for an integer field', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { platform_fee_bps: 1000.5 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      makeService(m).updateBulk('admin-1', {
        platform_fee_bps: 'not a number' as unknown as number,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed email', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { support_email: 'not-an-email' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('normalises email to trimmed lowercase', async () => {
    const m = makeMocks([]);
    const out = await makeService(m).updateBulk('admin-1', {
      support_email: '  Help@Example.COM  ',
    });
    expect(out.values.support_email).toBe('help@example.com');
  });

  it('rejects bad ISO currency code', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', { default_currency: 'usd' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      makeService(m).updateBulk('admin-1', { default_currency: 'TOO_LONG' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects non-boolean for a boolean field', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', {
        feature_show_hourly_rate: 'true' as unknown as boolean,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an empty body at 400', async () => {
    const m = makeMocks([]);
    await expect(makeService(m).updateBulk('admin-1', {})).rejects.toMatchObject({
      status: 400,
    });
  });

  it('skips the DB write when value is unchanged (idempotent), still audits', async () => {
    const m = makeMocks([makeRow({ key: 'platform_fee_bps', value: 1500 })]);
    const out = await makeService(m).updateBulk('admin-1', { platform_fee_bps: 1500 });
    expect(out.changedKeys).toEqual([]);
    expect(m.settings.upsert).not.toHaveBeenCalled();
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ changed: false }),
      }),
      undefined,
    );
  });

  it('handles a multi-key bulk update transactionally', async () => {
    const m = makeMocks([]);
    const out = await makeService(m).updateBulk('admin-1', {
      platform_fee_bps: 750,
      default_currency: 'EUR',
      feature_show_hourly_rate: true,
    });
    expect(out.changedKeys.sort()).toEqual([
      'default_currency',
      'feature_show_hourly_rate',
      'platform_fee_bps',
    ]);
    expect(m.audit.record).toHaveBeenCalledTimes(3);
  });

  it('rejects-the-whole-batch when any value is invalid (atomicity)', async () => {
    const m = makeMocks([]);
    await expect(
      makeService(m).updateBulk('admin-1', {
        platform_fee_bps: 750,
        support_email: 'not-an-email',
      }),
    ).rejects.toMatchObject({ status: 400 });
    // No upsert should have run because validation aborted before
    // the transaction body executed.
    expect(m.settings.upsert).not.toHaveBeenCalled();
  });
});
