import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FinancialOperationsSummaryV1,
  FinancialOperationsCapabilitiesV1,
  FinancialRecordV1,
  FinancialRecordsPageV1,
  FinancialReconciliationPageV1,
  MoneyWire,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { FinancialOperationsView } from './FinancialOperationsView';
import { financialOperationsKeys } from './financial-operations.api';

// Presentation/transport contract doubles only. The dedicated real-API browser
// suite supplies route, cookie, database and changed-permission evidence.
const auth = vi.hoisted(() => ({ user: { id: 'finance-admin-one' } }));
vi.mock('../../../lib/auth-provider', () => ({ useAuth: () => auth }));
const stamp = '2026-10-23T04:11:34.000Z';
const provenance = {
  readAt: stamp,
  source: 'AUTHORITATIVE_PERSISTENCE',
  cache: 'NO_STORE',
} as const;
const money = (amountMinor: string, currency = 'USD') => ({ amountMinor, currency }) as MoneyWire;
const availability = (reason: string) => ({ available: false, reason, href: null });
const capabilities: FinancialOperationsCapabilitiesV1 = {
  refund: availability('R32_INTEGRATION_PENDING'),
  receiptReview: availability('R30_INTEGRATION_PENDING'),
  myPlan: availability('R31_INTEGRATION_PENDING'),
  reconciliationActions: availability('R34_INTEGRATION_PENDING'),
};
const unrun = {
  state: 'UNAVAILABLE',
  lastSuccessAt: null,
  runId: null,
  reason: 'R34_INTEGRATION_PENDING',
} as const;
const baseSummary: FinancialOperationsSummaryV1 = {
  contractVersion: 'hsm.money.v1',
  reportVersion: 'hsm.finance-operations.v1',
  provenance,
  capabilities,
  ledger: {
    contractVersion: 'hsm.money.v1',
    source: 'LEDGER',
    asOf: stamp,
    totals: [
      { currency: 'USD', captured: money('9007199254740993'), refunded: money('5') },
      { currency: 'EUR', captured: money('100', 'EUR'), refunded: money('0', 'EUR') },
    ],
  },
  pendingTotals: [
    { currency: 'USD', pending: money('123'), unknown: money('99'), refundsRequested: money('45') },
  ],
  pendingAsOf: stamp,
  reconciliation: unrun,
};
const baseRecord: FinancialRecordV1 = {
  id: 'payment-large-one',
  kind: 'PAYMENT',
  status: 'PENDING',
  amount: money('9223372036854775807'),
  amountMeaning: 'INTENT_TOTAL',
  createdAt: stamp,
  providerProfileId: 'provider-one',
  paymentIntentId: 'payment-large-one',
  paymentConfirmationId: null,
  ledgerTransactionId: null,
  confirmationState: 'UNCONFIRMED',
  dispatchStatus: 'UNKNOWN',
  period: null,
  publicReasonCode: null,
};
const records = (
  items: FinancialRecordV1[] = [baseRecord],
  nextCursor: string | null = null,
): FinancialRecordsPageV1 => ({
  contractVersion: 'hsm.money.v1',
  reportVersion: 'hsm.finance-operations.v1',
  kind: 'PAYMENT',
  items,
  nextCursor,
  provenance,
  availability: { state: 'AVAILABLE', reason: null },
});
const exceptions = (): FinancialReconciliationPageV1 => ({
  contractVersion: 'hsm.money.v1',
  reportVersion: 'hsm.finance-operations.v1',
  status: unrun,
  items: [],
  nextCursor: null,
  provenance,
  capabilities,
});

describe('financial operations states and interactions', () => {
  let mock: MockAdapter;
  let client: QueryClient;
  beforeEach(() => {
    auth.user = { id: 'finance-admin-one' };
    mock = new MockAdapter(api);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mock.onGet('/v1/money/operations/summary').reply(200, structuredClone(baseSummary));
    mock.onGet('/v1/money/operations/records').reply(200, records());
    mock.onGet('/v1/money/operations/reconciliation').reply(200, exceptions());
  });
  afterEach(() => {
    cleanup();
    client.clear();
    mock.restore();
    vi.restoreAllMocks();
    onlineManager.setOnline(true);
  });
  function surface() {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LanguageProvider>
            <FinancialOperationsView audience="admin" />
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  async function mount() {
    const result = render(surface());
    await screen.findByTestId('ledger-total-USD');
    await screen.findByTestId('financial-records-table');
    return result;
  }
  const detailButton = (id = baseRecord.id) =>
    within(screen.getByTestId('financial-records-table')).getByRole('button', {
      name: 'View details: ' + id,
    });

  it('shows exact large values and independent currency totals without a mixed total', async () => {
    await mount();
    expect(screen.getByTestId('ledger-total-USD')).toHaveTextContent(
      '9,007,199,254,740,993 USD · minor units',
    );
    expect(screen.getByTestId('ledger-total-EUR')).toHaveTextContent('100 EUR · minor units');
    expect(screen.getByTestId('financial-records-table')).toHaveTextContent(
      '9,223,372,036,854,775,807 USD · minor units',
    );
    expect(screen.getByTestId('financial-records-table')).toHaveTextContent('Not confirmed');
    expect(screen.getByTestId('financial-records-table')).toHaveTextContent(
      'Dispatch outcome: Unknown',
    );
    expect(screen.queryByText(/9,007,199,254,741,093/)).toBeNull();
    expect(screen.getByText(/currency display scale has not been approved/)).toBeVisible();
  });

  it('does not promote a successful attempt or an unconfirmed subscription to confirmed collections', async () => {
    mock.onGet('/v1/money/operations/records').reply(
      200,
      records([
        {
          ...baseRecord,
          id: 'attempt-one',
          kind: 'ATTEMPT',
          status: 'SUCCEEDED',
          amountMeaning: 'ATTEMPT_TOTAL',
        },
        {
          ...baseRecord,
          id: 'period-one',
          kind: 'SUBSCRIPTION',
          amount: null,
          amountMeaning: 'UNAVAILABLE',
          status: 'ACTIVE',
        },
      ]),
    );
    await mount();
    const table = screen.getByTestId('financial-records-table');
    expect(table).toHaveTextContent('Succeeded');
    expect(table).toHaveTextContent('Not confirmed');
    expect(table).toHaveTextContent('Amount unavailable');
    expect(table).not.toHaveTextContent('Confirmed with ledger posting');
  });

  it('requests stable pages and resets the cursor when a currency filter changes', async () => {
    mock
      .onGet('/v1/money/operations/records')
      .reply((config) => [
        200,
        config.params.cursor
          ? records([{ ...baseRecord, id: 'payment-page-two' }])
          : records([baseRecord], 'snapshot.cursor'),
      ]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Next page', exact: true }));
    await waitFor(() =>
      expect(screen.getByTestId('financial-records-table')).toHaveTextContent('payment-page-two'),
    );
    expect(
      mock.history.get.filter((request) => request.url?.endsWith('/records')).at(-1)?.params.cursor,
    ).toBe('snapshot.cursor');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    await waitFor(() =>
      expect(
        mock.history.get.filter((request) => request.url?.endsWith('/records')).at(-1)?.params,
      ).toEqual({ kind: 'PAYMENT', limit: 20, currency: 'EUR' }),
    );
    expect(screen.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  });

  it('preserves the selected record type when switching between Arabic and English', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'REFUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Arabic' }));
    expect(screen.getByLabelText('نوع السجل')).toHaveValue('REFUND');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    fireEvent.click(screen.getByRole('button', { name: 'التغيير إلى الإنجليزية' }));
    expect(screen.getByLabelText('Record type')).toHaveValue('REFUND');
  });

  it('loads fresh details and displays only controlled provider-visible reasons', async () => {
    mock.onGet('/v1/money/operations/records/PAYMENT/' + baseRecord.id).reply(200, {
      contractVersion: 'hsm.money.v1',
      reportVersion: 'hsm.finance-operations.v1',
      provenance,
      capabilities,
      record: {
        ...baseRecord,
        amount: money('75'),
        publicReasonCode: 'DUPLICATE_REQUEST',
        confirmationState: 'INCONSISTENT',
      },
    });
    await mount();
    fireEvent.click(detailButton());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('75 USD · minor units'));
    expect(dialog).toHaveTextContent('Requires reconciliation');
    expect(dialog).toHaveTextContent('Reason visible to the provider');
    expect(dialog).toHaveTextContent('DUPLICATE_REQUEST');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(mock.history.post).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders permission changes immediately instead of continuing to show cached finance', async () => {
    await mount();
    mock
      .onGet('/v1/money/operations/summary')
      .reply(403, { error: { message: 'internal SQL secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh financial records' }));
    expect(
      await screen.findByText('You do not have permission to read these financial records.'),
    ).toBeVisible();
    expect(screen.queryByTestId('ledger-total-USD')).toBeNull();
    expect(screen.queryByTestId('financial-records-table')).toBeNull();
    expect(screen.queryByText('internal SQL secret')).toBeNull();
  });

  it('labels failed refreshes as stale and keeps them distinct from an empty successful result', async () => {
    await mount();
    mock.onGet('/v1/money/operations/records').reply(500, { error: { message: 'private detail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh financial records' }));
    expect(await screen.findByText(/Values below are from the last successful read/)).toBeVisible();
    expect(screen.getByTestId('financial-records-table')).toHaveTextContent(baseRecord.id);
    expect(screen.queryByText('No records match this view.')).toBeNull();
    expect(screen.queryByText('private detail')).toBeNull();
  });

  it('shows an explicit error when the first records read fails', async () => {
    mock.onGet('/v1/money/operations/records').reply(500, {});
    render(surface());
    expect(await screen.findByText('Financial records could not be loaded.')).toBeVisible();
    expect(screen.queryByText('No records match this view.')).toBeNull();
    expect(screen.queryByTestId('financial-records-table')).toBeNull();
  });

  it('distinguishes a successful empty read from an unavailable settlement integration', async () => {
    mock.onGet('/v1/money/operations/records').reply((config) => [
      200,
      config.params.kind === 'SETTLEMENT'
        ? {
            ...records([]),
            kind: 'SETTLEMENT',
            availability: { state: 'UNAVAILABLE', reason: 'NO_SETTLEMENT_FEED' },
          }
        : records([]),
    ]);
    render(surface());
    expect(await screen.findByText('No records match this view.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'SETTLEMENT' } });
    expect(
      await screen.findByText(
        'Settlement reporting is unavailable. No settlement feed has been integrated.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('No records match this view.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export this page' })).toBeDisabled();
  });

  it.each(['UNAVAILABLE', 'NOT_RUN', 'FAILED'] as const)(
    'does not turn reconciliation %s into measured zero differences',
    async (state) => {
      mock
        .onGet('/v1/money/operations/reconciliation')
        .reply(200, { ...exceptions(), status: { ...unrun, state } });
      await mount();
      const region = screen.getByRole('region', { name: 'Reconciliation exceptions' });
      await waitFor(() =>
        expect(region).toHaveTextContent(
          state === 'NOT_RUN'
            ? 'has not run'
            : state === 'FAILED'
              ? 'latest reconciliation failed'
              : 'Reconciliation is unavailable',
        ),
      );
      expect(within(region).queryByText('No exceptions appear on this reported page.')).toBeNull();
      expect(region).toHaveTextContent('No successful run is recorded.');
    },
  );

  it('renders server reconciliation provenance and protected exception details', async () => {
    const entry = {
      contractVersion: 'hsm.money.v1',
      id: 'exception-one',
      kind: 'AMOUNT_MISMATCH',
      subjectType: 'PaymentConfirmation',
      subjectId: 'confirmation-one',
      detectedAt: stamp,
      resolvedAt: null,
    };
    mock.onGet('/v1/money/operations/reconciliation').reply(200, {
      ...exceptions(),
      status: { state: 'AVAILABLE', lastSuccessAt: stamp, runId: 'run-one', reason: null },
      items: [entry],
    });
    mock.onGet('/v1/money/operations/reconciliation/exceptions/exception-one').reply(200, {
      contractVersion: 'hsm.money.v1',
      reportVersion: 'hsm.finance-operations.v1',
      exception: entry,
      allowedActions: [],
      provenance,
    });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /Amount mismatch exception-one/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('PaymentConfirmation: confirmation-one'));
    expect(within(dialog).queryByRole('button', { name: /balance|acknowledge/i })).toBeNull();
    expect(mock.history.post).toHaveLength(0);
  });

  it('keeps unavailable peer actions honest and rejects unsafe route values', async () => {
    mock.onGet('/v1/money/operations/summary').reply(200, {
      ...baseSummary,
      capabilities: {
        ...capabilities,
        receiptReview: { available: true, reason: null, href: 'javascript:alert(1)' },
        refund: { available: true, reason: null, href: '//unapproved.invalid/refunds' },
      },
    });
    await mount();
    expect(screen.getByText('Receipt review is not configured on this surface.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open receipt review' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open refund workspace' })).toBeNull();
  });

  it('confirms a bounded CSV export and reports additional pages without claiming a global export', async () => {
    mock
      .onGet('/v1/money/operations/export')
      .reply(200, 'id,currency\r\nrow,USD', { 'x-export-has-more': 'true' });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-export');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Export this page' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('up to 50 records');
    expect(mock.history.get.some((request) => request.url?.endsWith('/export'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByText(/This download contains one bounded page/)).toBeVisible();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-export');
    expect(mock.history.post).toHaveLength(0);
  });

  it('marks paused offline reads as potentially stale and resumes authoritative reads on reconnection', async () => {
    await mount();
    const reads = mock.history.get.length;
    await act(async () => {
      onlineManager.setOnline(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh financial records' }));
    expect(
      await screen.findByText(
        'The network is unavailable. Displayed values may be out of date. Reads resume when you reconnect.',
      ),
    ).toBeVisible();
    expect(screen.getByTestId('ledger-total-USD')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export this page' })).toBeDisabled();
    expect(mock.history.get).toHaveLength(reads);
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() =>
      expect(
        screen.queryByText(
          'The network is unavailable. Displayed values may be out of date. Reads resume when you reconnect.',
        ),
      ).toBeNull(),
    );
    expect(mock.history.get.length).toBeGreaterThan(reads);
  });

  it('clears a prior identity selection and never displays its cached finance after a new login', async () => {
    const mounted = await mount();
    expect(
      client.getQueriesData({
        queryKey: financialOperationsKeys.actor('admin', 'finance-admin-one'),
      }).length,
    ).toBeGreaterThan(0);
    mock.onGet('/v1/money/operations/summary').reply(403, {});
    mock.onGet('/v1/money/operations/records').reply(403, {});
    await act(async () => {
      auth.user = { id: 'finance-admin-two' };
      mounted.rerender(surface());
    });
    expect(
      await screen.findByText('You do not have permission to read these financial records.'),
    ).toBeVisible();
    expect(screen.queryByTestId('ledger-total-USD')).toBeNull();
    expect(screen.queryByText(baseRecord.id)).toBeNull();
  });

  it.each(['identity change', 'unmount'] as const)(
    'cancels an in-flight export after %s and never downloads the previous actor CSV',
    async (change) => {
      let finish!: (response: [number, string]) => void;
      mock.onGet('/v1/money/operations/export').reply(
        () =>
          new Promise<[number, string]>((resolve) => {
            finish = resolve;
          }),
      );
      const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:old-actor');
      const download = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const mounted = await mount();
      fireEvent.click(screen.getByRole('button', { name: 'Export this page' }));
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Download CSV' }),
      );
      await waitFor(() =>
        expect(mock.history.get.some((request) => request.url?.endsWith('/export'))).toBe(true),
      );
      const request = mock.history.get.find((value) => value.url?.endsWith('/export'))!;
      expect(request.signal?.aborted).toBe(false);
      await act(async () => {
        if (change === 'unmount') mounted.unmount();
        else {
          auth.user = { id: 'finance-admin-two' };
          mounted.rerender(surface());
        }
      });
      expect(request.signal?.aborted).toBe(true);
      await act(async () => {
        finish([200, 'id,currency\r\nold-private-record,USD']);
      });
      expect(createUrl).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(screen.queryByText('The selected financial page was downloaded.')).toBeNull();
    },
  );
});
