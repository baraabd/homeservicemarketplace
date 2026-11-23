import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { toMoneyWire, type ManualPaymentDetailV1 } from '@homeservicemarketplace/contracts';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ManualPaymentScreen } from './ManualPaymentScreen';
import { getManualPayment, submitManualReceipt, uploadManualReceipt } from './manual-payments.api';

vi.mock('./manual-payments.api', async (original) => ({
  ...(await original<typeof import('./manual-payments.api')>()),
  getManualPayment: vi.fn(),
  uploadManualReceipt: vi.fn(),
  submitManualReceipt: vi.fn(),
}));

const receipt = {
  id: 'receipt-one',
  mediaAssetId: 'asset-one',
  revision: 1,
  contentType: 'image/png',
  scanStatus: 'CLEAN',
  createdAt: '2026-10-23T08:00:00Z',
  submittedAt: '2026-10-23T08:01:00Z',
  canRead: true,
};
function payment(extra: Partial<ManualPaymentDetailV1> = {}): ManualPaymentDetailV1 {
  return {
    contractVersion: 'hsm.money.v1',
    paymentIntentId: 'intent-one',
    mode: 'SANDBOX',
    method: 'SHAM_CASH',
    status: 'AWAITING_RECEIPT',
    amount: toMoneyWire({ amountMinor: 12500n, currency: 'SYP' }),
    minorUnitScale: 2,
    expiresAt: '2026-10-23T20:00:00Z',
    version: 1,
    availability: 'ENABLED',
    disabledReason: null,
    instructions: {
      version: 'sandbox-v1',
      text: {
        en: 'Synthetic sandbox recipient instructions.',
        ar: 'تعليمات مستلم محاكى للاختبار.',
      },
    },
    currentReceiptVersionId: null,
    receipts: [],
    history: [],
    availableActions: ['UPLOAD_RECEIPT'],
    uploadPolicy: { maxBytes: 1024, allowedContentTypes: ['image/png'] },
    ...extra,
  };
}
function mount(id = 'intent-one') {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ManualPaymentScreen paymentIntentId={id} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('R30 provider UI (API contract doubles, not runtime acceptance)', () => {
  it('shows disabled methods honestly without invented recipient instructions or an upload action', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(
      payment({ availability: 'METHOD_DISABLED', instructions: null, availableActions: [] }),
    );
    mount();
    expect(
      await screen.findByText('This payment method is currently unavailable.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Receipt file')).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic sandbox recipient instructions.')).not.toBeInTheDocument();
  });
  it('renders the server-owned scale and labels sandbox operation', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(payment({ minorUnitScale: 0 }));
    mount();
    expect(await screen.findByText('12,500 SYP')).toBeInTheDocument();
    expect(screen.getByText('Sandbox operator simulation')).toBeInTheDocument();
    expect(
      screen.getByText('Uploading a receipt does not confirm payment or activate your plan.'),
    ).toBeInTheDocument();
  });
  it('refuses an unsupported file before any reservation or upload request', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(payment());
    mount();
    const control = await screen.findByLabelText('Receipt file');
    fireEvent.change(control, {
      target: { files: [new File(['<svg/>'], 'receipt.svg', { type: 'image/svg+xml' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload a receipt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a supported');
    expect(uploadManualReceipt).not.toHaveBeenCalled();
  });
  it('preserves prior immutable receipts, correction reason and exact revision through replacement and resubmission', async () => {
    const corrected = payment({
      status: 'ACTION_REQUIRED',
      version: 4,
      currentReceiptVersionId: receipt.id,
      receipts: [receipt],
      history: [
        {
          id: 'decision1',
          action: 'REQUEST_REPLACEMENT',
          providerMessage: 'Include the full deposit reference.',
          createdAt: '2026-10-23T08:05:00Z',
        },
        {
          id: 'older-decision',
          action: 'REQUEST_REPLACEMENT',
          providerMessage: 'Earlier correction already addressed.',
          createdAt: '2026-10-23T08:03:00Z',
        },
      ],
    });
    const replacement = {
      ...receipt,
      id: 'receipt-two',
      mediaAssetId: 'asset-two',
      revision: 2,
      submittedAt: null,
    };
    const uploaded = {
      ...corrected,
      status: 'READY',
      version: 5,
      currentReceiptVersionId: replacement.id,
      receipts: [receipt, replacement],
      availableActions: ['SUBMIT' as const],
    };
    vi.mocked(getManualPayment).mockResolvedValue(corrected);
    vi.mocked(uploadManualReceipt).mockResolvedValue(uploaded);
    vi.mocked(submitManualReceipt).mockResolvedValue({
      ...uploaded,
      status: 'SUBMITTED',
      version: 6,
      availableActions: [],
    });
    mount();
    const control = await screen.findByLabelText('Receipt file');
    expect(screen.getByRole('heading', { name: 'Replacement required' })).toBeInTheDocument();
    expect(screen.getAllByText('Include the full deposit reference.')).toHaveLength(2);
    expect(screen.getAllByText('Earlier correction already addressed.')).toHaveLength(1);
    const file = new File(['synthetic'], 'replacement.png', { type: 'image/png' });
    fireEvent.change(control, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload a replacement receipt' }));
    await waitFor(() =>
      expect(uploadManualReceipt).toHaveBeenCalledWith('intent-one', file, 4, expect.any(String)),
    );
    expect(
      await screen.findByRole('heading', { name: 'Receipt version 2 · Current' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Receipt version 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() =>
      expect(submitManualReceipt).toHaveBeenCalledWith('intent-one', 5, expect.any(String)),
    );
    expect(
      await screen.findByText('Submitted for review. Payment has not yet been confirmed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
  });
  it('keeps a selected file when the language changes and uses Arabic RTL', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(payment());
    vi.mocked(uploadManualReceipt).mockResolvedValue(payment({ availableActions: [] }));
    mount();
    const file = new File(['synthetic'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('Receipt file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    fireEvent.click(screen.getByRole('button', { name: 'رفع إيصال' }));
    await waitFor(() =>
      expect(uploadManualReceipt).toHaveBeenCalledWith('intent-one', file, 1, expect.any(String)),
    );
  });
  it('does not manufacture actions from a familiar state', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(
      payment({
        status: 'READY',
        receipts: [receipt],
        currentReceiptVersionId: receipt.id,
        availableActions: [],
      }),
    );
    mount();
    await screen.findByText('Ready to submit');
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });
  it('shows a pending activation without declaring a completed payment', async () => {
    vi.mocked(getManualPayment).mockResolvedValue(
      payment({ status: 'CONFIRMING', availableActions: [] }),
    );
    mount();
    expect(
      await screen.findByText(
        'Payment confirmation and plan activation are still in progress. The payment is not yet complete.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'The server has confirmed this payment. Identity verification and work access remain separate.',
      ),
    ).not.toBeInTheDocument();
  });
});
