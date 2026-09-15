import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIdentityPdf, MAX_IDENTITY_PDF_PAGES } from '../evidence/identity-pdf';

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => undefined),
  GlobalWorkerOptions: { workerSrc: '' },
}));
vi.mock('pdfjs-dist', () => ({
  getDocument: pdf.getDocument,
  GlobalWorkerOptions: pdf.GlobalWorkerOptions,
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
beforeEach(() => {
  vi.clearAllMocks();
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2 }),
    destroy: pdf.destroy,
  });
});
describe('restricted PDF rasterization boundary', () => {
  it('passes bytes rather than a URL and disables active content and remote resource loading', async () => {
    const controller = new AbortController();
    const result = await loadIdentityPdf(new Blob(['%PDF fixture']), controller.signal);
    expect(result.numPages).toBe(2);
    const options = pdf.getDocument.mock.calls[0][0];
    expect(options).toMatchObject({
      data: expect.any(Uint8Array),
      isEvalSupported: false,
      enableXfa: false,
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      stopAtErrors: true,
      maxImageSize: 16_000_000,
    });
    for (const key of ['url', 'httpHeaders', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl']) {
      expect(options[key]).toBeUndefined();
    }
    expect(pdf.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.mjs');
    controller.abort();
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });
  it('does not parse bytes after the viewer has closed', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadIdentityPdf(new Blob(['%PDF fixture']), controller.signal)).rejects.toThrow();
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });
  it('destroys the parser on failure and refuses excessive page counts', async () => {
    pdf.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: MAX_IDENTITY_PDF_PAGES + 1 }),
      destroy: pdf.destroy,
    });
    await expect(
      loadIdentityPdf(new Blob(['%PDF fixture']), new AbortController().signal),
    ).rejects.toThrow();
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
