import type { MoneyManualInstructionVersion, PrismaTx } from '@homeservicemarketplace/database';
import {
  ManualRailConfiguration,
  MANUAL_ADAPTER_ID,
  usableInstruction,
} from './manual-rail.config';
import type { MoneyTransportBinding } from '../../ports/collection.port';

const now = new Date('2026-07-20T12:00:00.000Z');
function instruction(
  extra: Partial<MoneyManualInstructionVersion> = {},
): MoneyManualInstructionVersion {
  return {
    id: 'instruction',
    planVersionId: 'plan',
    method: 'CASH_OFFICE',
    mode: 'SANDBOX',
    adapterId: MANUAL_ADAPTER_ID,
    accountReference: 'sandbox-only',
    currency: 'XTS',
    debitAccountId: 'clearing',
    creditAccountId: 'revenue',
    configVersion: 'test-v1',
    instructions: { en: 'Synthetic operator exercise only', ar: 'محاكاة تدريبية فقط' },
    market: 'TEST',
    minorUnitScale: 0,
    policyVersion: 'test-policy-v1',
    referencePolicy: 'EXACT_TRIM',
    maxAmountMinor: 2000n,
    receiptMaxBytes: 1000,
    uploadTtlSeconds: 300,
    quoteTtlSeconds: 3600,
    retentionDays: 30,
    validFrom: new Date('2026-07-01'),
    validUntil: new Date('2026-08-01'),
    enabled: true,
    approvedAt: new Date('2026-07-01'),
    createdAt: new Date('2026-07-01'),
    ...extra,
  };
}

describe('R30 explicit manual method policy', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    { enabled: false },
    { approvedAt: null },
    { mode: 'LIVE' as const },
    { validUntil: now },
    { validFrom: new Date(now.getTime() + 1) },
    { maxAmountMinor: 0n },
    { receiptMaxBytes: 11 * 1024 * 1024 },
    { market: ' ' },
    { instructions: { en: 'English only' } },
    { referencePolicy: 'FUZZY' },
    { minorUnitScale: -1 },
    { adapterId: 'unowned-adapter' },
  ])('refuses an unapproved or incomplete policy %j', (extra) => {
    expect(usableInstruction(instruction(extra), now)).toBe(false);
  });

  it('accepts explicit zero minor-unit scale without inventing a two-decimal convention', () => {
    expect(usableInstruction(instruction(), now)).toBe(true);
  });

  it('keeps an older pinned version usable while rejecting changed scope or disabled policy', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const row = instruction();
    const read = jest.fn().mockResolvedValue(row);
    const tx = { moneyManualInstructionVersion: { findUnique: read } } as unknown as PrismaTx;
    const binding: MoneyTransportBinding = {
      planVersionId: row.planVersionId,
      method: row.method,
      mode: row.mode,
      adapterId: row.adapterId,
      accountReference: row.accountReference,
      configVersion: row.configVersion,
      currency: row.currency,
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
    };
    const configuration = new ManualRailConfiguration();
    await expect(configuration.resolveBinding(binding, tx)).resolves.toMatchObject(binding);
    await expect(
      configuration.resolveBinding({ ...binding, accountReference: 'different' }, tx),
    ).resolves.toBeNull();
    read.mockResolvedValue({ ...row, enabled: false });
    await expect(configuration.resolveBinding(binding, tx)).resolves.toBeNull();
  });

  it('returns no manual binding for a card rail and does not query unrelated policy', async () => {
    const findMany = jest.fn();
    const tx = { moneyManualInstructionVersion: { findMany } } as unknown as PrismaTx;
    await expect(
      new ManualRailConfiguration().resolve({ planVersionId: 'plan', method: 'STRIPE' }, tx),
    ).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
