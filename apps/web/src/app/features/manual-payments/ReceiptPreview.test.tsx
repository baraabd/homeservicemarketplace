import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManualReceiptVersionV1 } from '@homeservicemarketplace/contracts';
import { ReceiptPreview } from './ReceiptPreview';
import { readManualReceipt } from './manual-payments.api';

vi.mock('./manual-payments.api', () => ({ readManualReceipt: vi.fn() }));
vi.mock('../admin-provider-review/evidence/identity-pdf', () => ({
  loadIdentityPdf: vi.fn(),
  MAX_IDENTITY_CANVAS_PIXELS: 16_000_000,
}));
const receipt: ManualReceiptVersionV1 = {
  id: 'revision1',
  mediaAssetId: 'private-asset',
  revision: 1,
  contentType: 'image/png',
  scanStatus: 'CLEAN',
  createdAt: '2026-10-23T08:00:00Z',
  submittedAt: '2026-10-23T08:01:00Z',
  canRead: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:private-receipt');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('R30 receipt preview (byte transport doubles)', () => {
  it('does not acknowledge inspection before the private image renders and the reviewer explicitly confirms', async () => {
    vi.mocked(readManualReceipt).mockResolvedValue({
      blob: new Blob(['synthetic'], { type: 'image/png' }),
      inspectionId: 'inspection1',
    });
    const inspected = vi.fn();
    render(<ReceiptPreview receipt={receipt} onClose={vi.fn()} onInspected={inspected} />);
    const image = await screen.findByRole('img');
    expect(inspected).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Use this inspected receipt' }),
    ).not.toBeInTheDocument();
    fireEvent.load(image);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this inspected receipt' }));
    expect(inspected).toHaveBeenCalledWith('inspection1', 'revision1');
  });
  it.each(['text/html', 'image/svg+xml', 'application/json'])(
    'refuses active or unexpected response type %s',
    async (type) => {
      vi.mocked(readManualReceipt).mockResolvedValue({
        blob: new Blob(['fixture'], { type }),
        inspectionId: 'not-proof',
      });
      render(<ReceiptPreview receipt={receipt} onClose={vi.fn()} />);
      expect(await screen.findByRole('alert')).toHaveTextContent('cannot be displayed safely');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );
  it('does not fetch a denied receipt', () => {
    render(<ReceiptPreview receipt={{ ...receipt, canRead: false }} onClose={vi.fn()} />);
    expect(readManualReceipt).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be displayed');
  });
  it('revokes bytes and clears inspection on session expiration', async () => {
    vi.mocked(readManualReceipt).mockResolvedValue({
      blob: new Blob(['synthetic'], { type: 'image/png' }),
      inspectionId: 'inspection1',
    });
    const invalidate = vi.fn();
    render(<ReceiptPreview receipt={receipt} onClose={vi.fn()} onInvalidated={invalidate} />);
    await screen.findByRole('img');
    const before = invalidate.mock.calls.length;
    act(() => window.dispatchEvent(new Event('auth:session-expired')));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-receipt');
    expect(invalidate.mock.calls.length).toBeGreaterThan(before);
  });
  it('discards content arriving after closing the preview', async () => {
    let finish!: (value: { blob: Blob; inspectionId: string | null }) => void;
    vi.mocked(readManualReceipt).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<ReceiptPreview receipt={receipt} onClose={vi.fn()} />);
    await waitFor(() => expect(readManualReceipt).toHaveBeenCalled());
    view.unmount();
    await act(async () =>
      finish({ blob: new Blob(['fixture'], { type: 'image/png' }), inspectionId: 'old' }),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('hides a historical preview immediately when the receipt changes', async () => {
    vi.mocked(readManualReceipt).mockResolvedValueOnce({
      blob: new Blob(['synthetic'], { type: 'image/png' }),
      inspectionId: 'inspection1',
    });
    const view = render(<ReceiptPreview receipt={receipt} onClose={vi.fn()} />);
    await screen.findByRole('img');
    vi.mocked(readManualReceipt).mockImplementation(() => new Promise(() => {}));
    view.rerender(
      <ReceiptPreview
        receipt={{ ...receipt, id: 'new', mediaAssetId: 'new-asset', revision: 2 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-receipt');
  });
});
