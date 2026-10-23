import { csvCell, FinancialExportService } from './financial-export.service';

function fixture() {
  const reports = {
    records: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'record',
          kind: 'PAYMENT',
          status: 'PROCESSING',
          confirmationState: 'UNCONFIRMED',
          amountMeaning: 'INTENT_TOTAL',
          amount: { amountMinor: '9007199254740993', currency: 'XTS' },
          createdAt: '2026-01-01T00:00:00.000Z',
          publicReasonCode: null,
          receiptMediaAssetId: 'private-receipt',
          internalNote: 'private-note',
          email: 'private-email',
          providerProfileId: 'private-profile',
        },
      ],
      nextCursor: 'next',
      availability: { state: 'AVAILABLE', reason: null },
    }),
  };
  return { reports, service: new FinancialExportService(reports as never) };
}

describe('R33 bounded redacted CSV', () => {
  it.each([
    '=1+1',
    '+SUM(A1)',
    '-1+2',
    '@SUM(A1)',
    '  =WEBSERVICE("https://example.invalid")',
    '\t=CMD()',
    '\r\n+SUM(A1)',
  ])('neutralizes formula injection %p', (value) => {
    expect(csvCell(value)).toMatch(/^"'/u);
    expect(csvCell(value)).not.toMatch(/[\r\n\t]/u);
  });
  it('escapes commas and quotes without creating additional cells', () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it('keeps large integer strings textual without rounding or scientific notation', () => {
    expect(csvCell('9223372036854775807')).toBe('"\'9223372036854775807"');
  });
  it('exports only the requested bounded page under fresh admin authority', async () => {
    const f = fixture();
    const result = await f.service.export('reviewer', {
      kind: 'PAYMENT',
      limit: 5,
      cursor: 'prior',
    });
    expect(f.reports.records).toHaveBeenCalledTimes(1);
    expect(f.reports.records).toHaveBeenCalledWith('reviewer', 'ADMIN', {
      kind: 'PAYMENT',
      limit: 5,
      cursor: 'prior',
    });
    expect(result).toMatchObject({ count: 1, hasMore: true });
    const text = result.bytes.toString('utf8');
    expect(text).toContain("'9007199254740993");
    expect(text).not.toMatch(/private-|receipt|internalNote|email|providerProfile/u);
  });
  it('preserves an authorized empty export as header only', async () => {
    const f = fixture();
    f.reports.records.mockResolvedValue({
      items: [],
      nextCursor: null,
      availability: { state: 'AVAILABLE' },
    });
    const result = await f.service.export('reviewer');
    expect(result).toMatchObject({ count: 0, hasMore: false });
    expect(result.bytes.toString('utf8').split('\r\n')).toHaveLength(2);
  });
  it('does not turn unavailable settlement into a successful empty CSV', async () => {
    const f = fixture();
    f.reports.records.mockResolvedValue({
      items: [],
      nextCursor: null,
      availability: { state: 'UNAVAILABLE', reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
    });
    await expect(f.service.export('reviewer', { kind: 'SETTLEMENT' })).rejects.toMatchObject({
      status: 503,
      details: { reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
    });
  });
  it.each([403, 500])(
    'propagates failed reads (%s) instead of producing a success CSV',
    async (status) => {
      const f = fixture();
      f.reports.records.mockRejectedValue({ status });
      await expect(f.service.export('reviewer')).rejects.toMatchObject({ status });
    },
  );
});
