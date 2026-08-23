import type {
  PlatformSettingRepository,
  PlatformSettingRow,
} from '../../../infrastructure/persistence/settings/platform-setting.repository';
import type {
  PlatformSettingHistoryRepository,
  PlatformSettingHistoryRow,
} from '../../../infrastructure/persistence/settings/platform-setting-history.repository';
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
  history: PlatformSettingHistoryRepository;
  audit: AdminAuditService;
}

function makeMocks(initialRows: PlatformSettingRow[] = []): Mocks {
  let rows = [...initialRows];
  const historyRows: PlatformSettingHistoryRow[] = [];
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
    // Sprint 8 — the append-only trail. Recorded here so the tests can assert
    // WHAT was written to it, not merely that a write happened.
    history: {
      append: jest.fn().mockImplementation((input: Partial<PlatformSettingHistoryRow>) => {
        // Mirrors what the real repository stores: the caller supplies the
        // change, the database supplies the identity and the clock. Newest
        // first, so unshift.
        const row = {
          id: `hist-${historyRows.length + 1}`,
          changedAt: new Date(`2026-08-24T00:0${historyRows.length}:00Z`),
          reason: null,
          ...input,
        } as PlatformSettingHistoryRow;
        historyRows.unshift(row);
        return Promise.resolve(row);
      }),
      listByKey: jest
        .fn()
        .mockImplementation((args: { key: string; take: number }) =>
          Promise.resolve(historyRows.filter((r) => r.key === args.key).slice(0, args.take)),
        ),
    } as unknown as PlatformSettingHistoryRepository,
    audit: { record: jest.fn().mockResolvedValue(undefined) } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminSettingsService {
  return new AdminSettingsService(m.settings, m.history, m.audit, tx);
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

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 8 — the append-only change trail.
//
// The current-value row cannot answer "what was this threshold when that
// decision was made?", because it is overwritten by the next write — and the
// next write is usually the one someone is disputing.
// ─────────────────────────────────────────────────────────────────────────────
describe('AdminSettingsService — setting history', () => {
  it('records the before and after of a change', async () => {
    const m = makeMocks([makeRow({ key: 'platform_fee_bps', value: 1000 })]);
    await makeService(m).updateBulk('admin-9', { platform_fee_bps: 750 });

    expect(m.history.append).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'platform_fee_bps',
        previousValue: 1000,
        newValue: 750,
        changedBy: 'admin-9',
      }),
      undefined,
    );
  });

  it('records null as the previous value for a key that had no row', async () => {
    // Not "0", not the schema default. The distinction between "was unset" and
    // "was explicitly the default" is the whole point of keeping a trail.
    const m = makeMocks([]);
    await makeService(m).updateBulk('admin-9', { platform_fee_bps: 750 });

    expect(m.history.append).toHaveBeenCalledWith(
      expect.objectContaining({ previousValue: null, newValue: 750 }),
      undefined,
    );
  });

  it('does NOT record a same-value write', async () => {
    // An idempotent write still gets an audit row — the operator's intent is
    // worth recording — but not a history row. A history of non-changes buries
    // the changes it exists to surface.
    const m = makeMocks([makeRow({ key: 'platform_fee_bps', value: 1000 })]);
    await makeService(m).updateBulk('admin-9', { platform_fee_bps: 1000 });

    expect(m.history.append).not.toHaveBeenCalled();
    expect(m.audit.record).toHaveBeenCalled();
  });

  it('writes the trail entry inside the SAME transaction as the value', async () => {
    // A history that commits separately from the value it describes grows
    // holes exactly where someone had a reason to want one.
    const m = makeMocks([]);
    await makeService(m).updateBulk('admin-9', { platform_fee_bps: 750 });

    const settingTx = (m.settings.upsert as jest.Mock).mock.calls[0][1];
    const historyTx = (m.history.append as jest.Mock).mock.calls[0][1];
    expect(historyTx).toBe(settingTx);
  });

  it('records a deletion as a change to null', async () => {
    // Deleting the row reverts the read path to the schema default, so the
    // trail says so rather than going silent at the moment of a real change.
    const m = makeMocks([makeRow({ key: 'platform_fee_bps', value: 1000 })]);
    await makeService(m).remove('admin-9', 'platform_fee_bps');

    expect(m.history.append).toHaveBeenCalledWith(
      expect.objectContaining({ previousValue: 1000, newValue: null, reason: 'deleted' }),
      undefined,
    );
  });

  it('reads a key history newest-first and reports no next page when exhausted', async () => {
    const m = makeMocks([]);
    const service = makeService(m);
    await service.updateBulk('admin-9', { platform_fee_bps: 750 });
    await service.updateBulk('admin-9', { platform_fee_bps: 800 });

    const out = await service.historyForKey('platform_fee_bps', { limit: 20 });

    expect(out.key).toBe('platform_fee_bps');
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
  });

  it('reads history for a key that is NOT in the whitelist', async () => {
    // The trail of a key since removed from the schema is exactly the trail
    // most worth keeping readable.
    const m = makeMocks([]);
    const out = await makeService(m).historyForKey('retired_key', { limit: 20 });

    expect(out.key).toBe('retired_key');
    expect(out.items).toEqual([]);
  });
});
