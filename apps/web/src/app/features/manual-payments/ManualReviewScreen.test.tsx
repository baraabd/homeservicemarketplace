import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { toMoneyWire, type ManualReviewDetailV1 } from '@homeservicemarketplace/contracts';
import { LanguageProvider, useLang } from '../../i18n/LanguageContext';
import { ManualReviewScreen } from './ManualReviewScreen';
import {
  decideManualPayment,
  getManualReview,
  listManualReviews,
  recordManualSettlement,
  retryManualConfirmation,
} from './manual-payments.api';

vi.mock('./manual-payments.api', async (original) => ({
  ...(await original<typeof import('./manual-payments.api')>()),
  getManualReview: vi.fn(),
  listManualReviews: vi.fn(),
  decideManualPayment: vi.fn(),
  recordManualSettlement: vi.fn(),
  retryManualConfirmation: vi.fn(),
}));
vi.mock('./ReceiptPreview', () => ({
  ReceiptPreview: ({
    onInspected,
    receipt,
  }: {
    onInspected: (id: string, version: string) => void;
    receipt: { id: string };
  }) => (
    <button onClick={() => onInspected('inspection-proof', receipt.id)}>
      Acknowledge rendered test receipt
    </button>
  ),
}));

function detail(extra: Partial<ManualReviewDetailV1> = {}): ManualReviewDetailV1 {
  return {
    contractVersion: 'hsm.money.v1',
    paymentIntentId: 'intent-one',
    mode: 'SANDBOX',
    method: 'SHAM_CASH',
    status: 'SUBMITTED',
    amount: toMoneyWire({ amountMinor: 12500n, currency: 'SYP' }),
    minorUnitScale: 2,
    expiresAt: '2026-10-23T20:00:00Z',
    version: 8,
    availability: 'ENABLED',
    disabledReason: null,
    instructions: {
      version: 'sandbox-v1',
      text: { en: 'Synthetic instructions.', ar: 'تعليمات محاكية.' },
    },
    currentReceiptVersionId: 'receipt-one',
    receipts: [
      {
        id: 'receipt-one',
        mediaAssetId: 'asset-one',
        revision: 1,
        contentType: 'image/png',
        scanStatus: 'CLEAN',
        createdAt: '2026-10-23T08:00:00Z',
        submittedAt: '2026-10-23T08:01:00Z',
        canRead: true,
      },
    ],
    history: [],
    reviewHistory: [],
    availableActions: ['APPROVE', 'REJECT', 'REQUEST_REPLACEMENT'],
    uploadPolicy: null,
    settlements: [
      {
        id: 'independent-deposit',
        reference: 'SIMULATED-DEPOSIT-01',
        amount: toMoneyWire({ amountMinor: 12500n, currency: 'SYP' }),
        occurredAt: '2026-10-23T08:00:00Z',
        recordedByUserId: 'separate-recorder',
        evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
        canApprove: true,
      },
    ],
    ...extra,
  };
}
function LanguageControl() {
  const { toggleLang } = useLang();
  return <button onClick={toggleLang}>Change test language</button>;
}
function mount(id: string | undefined = 'intent-one') {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <LanguageControl />
        <ManualReviewScreen paymentIntentId={id} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}
async function inspect() {
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect receipt 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge rendered test receipt' }));
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('R30 review UI (API/inspection contract doubles, not settlement acceptance)', () => {
  it('shows an honest empty queue and loads the server endpoint', async () => {
    vi.mocked(listManualReviews).mockResolvedValue({ items: [], nextCursor: null });
    render(
      <MemoryRouter>
        <LanguageProvider>
          <ManualReviewScreen />
        </LanguageProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('No manual payments are waiting in this list.'),
    ).toBeInTheDocument();
    expect(listManualReviews).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });
  it('requires inspection, a provider message and eligible independent evidence before approval', async () => {
    vi.mocked(getManualReview).mockResolvedValue(detail());
    mount();
    const approve = await screen.findByRole('button', { name: 'Confirm matched deposit' });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message to the provider'), {
      target: { value: 'Deposit matched.' },
    });
    fireEvent.change(screen.getByLabelText('Deposit to match'), {
      target: { value: 'independent-deposit' },
    });
    expect(approve).toBeDisabled();
    await inspect();
    expect(approve).toBeEnabled();
  });
  it('submits the inspected revision, expected version and separate public/internal text only after confirmation', async () => {
    vi.mocked(getManualReview).mockResolvedValue(detail());
    vi.mocked(decideManualPayment).mockResolvedValue(
      detail({ version: 9, status: 'CONFIRMING', availableActions: [] }),
    );
    mount();
    await inspect();
    fireEvent.change(screen.getByLabelText('Message to the provider'), {
      target: { value: 'Deposit matched to your purchase.' },
    });
    fireEvent.change(screen.getByLabelText('Internal reviewer note (optional)'), {
      target: { value: 'Independent statement inspected.' },
    });
    fireEvent.change(screen.getByLabelText('Deposit to match'), {
      target: { value: 'independent-deposit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm matched deposit' }));
    expect(decideManualPayment).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decision' }));
    await waitFor(() =>
      expect(decideManualPayment).toHaveBeenCalledWith(
        'intent-one',
        {
          action: 'APPROVE',
          expectedVersion: 8,
          receiptVersionId: 'receipt-one',
          inspectionId: 'inspection-proof',
          providerMessage: 'Deposit matched to your purchase.',
          internalNote: 'Independent statement inspected.',
          settlementId: 'independent-deposit',
        },
        expect.any(String),
      ),
    );
    expect(
      await screen.findByText(
        'Payment confirmation and plan activation are still in progress. The payment is not yet complete.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
  });
  it('does not offer a self-recorded deposit as eligible for approval', async () => {
    const original = detail();
    original.settlements[0].canApprove = false;
    vi.mocked(getManualReview).mockResolvedValue(original);
    mount();
    await screen.findByLabelText('Deposit to match');
    expect(screen.queryByRole('option', { name: /SIMULATED-DEPOSIT-01/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Requires a separate reviewer/)).toBeInTheDocument();
  });
  it('sends a correction without claiming approval or providing a settlement', async () => {
    vi.mocked(getManualReview).mockResolvedValue(detail());
    vi.mocked(decideManualPayment).mockResolvedValue(
      detail({ version: 9, status: 'REPLACEMENT_REQUESTED', availableActions: [] }),
    );
    mount();
    await inspect();
    fireEvent.change(screen.getByLabelText('Message to the provider'), {
      target: { value: 'Please include the full reference.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request a replacement' }));
    await waitFor(() => expect(decideManualPayment).toHaveBeenCalled());
    expect(vi.mocked(decideManualPayment).mock.calls[0][1]).toEqual({
      action: 'REQUEST_REPLACEMENT',
      expectedVersion: 8,
      receiptVersionId: 'receipt-one',
      inspectionId: 'inspection-proof',
      providerMessage: 'Please include the full reference.',
    });
  });
  it('preserves entered review text when language changes', async () => {
    vi.mocked(getManualReview).mockResolvedValue(detail());
    mount();
    fireEvent.change(await screen.findByLabelText('Message to the provider'), {
      target: { value: 'Please show the date.' },
    });
    fireEvent.change(screen.getByLabelText('Internal reviewer note (optional)'), {
      target: { value: 'Private note.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change test language' }));
    expect(screen.getByLabelText('رسالة إلى المهني')).toHaveValue('Please show the date.');
    expect(screen.getByLabelText('ملاحظة داخلية للمراجع (اختيارية)')).toHaveValue('Private note.');
  });
  it('records exact independently-entered sandbox settlement and does not auto-approve it', async () => {
    vi.mocked(getManualReview).mockResolvedValue(
      detail({ availableActions: ['RECORD_SETTLEMENT'] }),
    );
    vi.mocked(recordManualSettlement).mockResolvedValue(detail({ availableActions: [] }));
    mount();
    fireEvent.change(await screen.findByLabelText('Deposit reference'), {
      target: { value: 'SIMULATED-DEPOSIT-02' },
    });
    fireEvent.change(screen.getByLabelText('Amount recorded by the payment source (SYP)'), {
      target: { value: '125.00' },
    });
    fireEvent.change(screen.getByLabelText('Deposit time (UTC)'), {
      target: { value: '2026-10-23T08:00:35' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record simulated deposit' }));
    await waitFor(() =>
      expect(recordManualSettlement).toHaveBeenCalledWith(
        'intent-one',
        {
          reference: 'SIMULATED-DEPOSIT-02',
          amount: { amountMinor: '12500', currency: 'SYP' },
          occurredAt: '2026-10-23T08:00:35.000Z',
          evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
        },
        expect.any(String),
      ),
    );
    expect(decideManualPayment).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'Independent record saved. A separate reviewer must confirm the payment.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change test language' }));
    expect(
      screen.getByText('حُفظ السجل المستقل. يلزم مراجع آخر لتأكيد الدفع.'),
    ).toBeInTheDocument();
  });
  it('does not show a settlement writer form without the server action', async () => {
    vi.mocked(getManualReview).mockResolvedValue(detail());
    mount();
    await screen.findByText('Recorded deposits');
    expect(screen.queryByLabelText('Deposit reference')).not.toBeInTheDocument();
  });
  it('offers reconciliation recovery only when the server permits it and keeps internal reason codes out of product copy', async () => {
    vi.mocked(getManualReview).mockResolvedValue(
      detail({
        status: 'RECONCILIATION_REQUIRED',
        availableActions: ['RETRY_CONFIRMATION'],
        processing: {
          reason: 'PRIVATE_CONFIGURATION_REASON',
          reconciliationRequired: true,
          attemptCount: 5,
          canRetry: true,
        },
      }),
    );
    vi.mocked(retryManualConfirmation).mockResolvedValue(
      detail({
        status: 'CONFIRMING',
        version: 9,
        availableActions: [],
        processing: {
          reason: null,
          reconciliationRequired: false,
          attemptCount: 0,
          canRetry: false,
        },
      }),
    );
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry payment confirmation' });
    expect(screen.getByRole('heading', { name: 'Finance review needed' })).toBeInTheDocument();
    expect(screen.queryByText('PRIVATE_CONFIGURATION_REASON')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(retryManualConfirmation).toHaveBeenCalledWith('intent-one', 8, expect.any(String)),
    );
    expect(
      await screen.findByRole('heading', { name: 'Awaiting payment activation' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry payment confirmation' }),
    ).not.toBeInTheDocument();
  });
  it('does not infer recovery permission from a reconciliation state', async () => {
    vi.mocked(getManualReview).mockResolvedValue(
      detail({
        status: 'RECONCILIATION_REQUIRED',
        availableActions: [],
        processing: {
          reason: null,
          reconciliationRequired: true,
          attemptCount: 5,
          canRetry: false,
        },
      }),
    );
    mount();
    await screen.findByRole('heading', { name: 'Finance review needed' });
    expect(
      screen.queryByRole('button', { name: 'Retry payment confirmation' }),
    ).not.toBeInTheDocument();
  });
  it('does not expose private review history after a permission-denied refresh', async () => {
    vi.mocked(getManualReview)
      .mockResolvedValueOnce(
        detail({
          reviewHistory: [
            {
              id: 'secret-note',
              action: 'REQUEST_REPLACEMENT',
              providerMessage: 'Please clarify.',
              internalNote: 'Private financial review note.',
              createdAt: '2026-10-23T08:00:00Z',
            },
          ],
        }),
      )
      .mockRejectedValueOnce({ response: { status: 403 } });
    mount();
    await screen.findByText('Private financial review note.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Private financial review note.')).not.toBeInTheDocument();
  });
});
