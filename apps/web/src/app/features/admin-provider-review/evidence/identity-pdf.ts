import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_IDENTITY_PDF_PAGES = 100;
export const MAX_IDENTITY_CANVAS_PIXELS = 16_000_000;

/** Rasterization only: no viewer, annotation links, forms, scripting or remote document URL. */
export async function loadIdentityPdf(blob: Blob, signal: AbortSignal): Promise<PDFDocumentProxy> {
  const [{ getDocument, GlobalWorkerOptions }, bytes] = await Promise.all([
    import('pdfjs-dist'),
    blob.arrayBuffer(),
  ]);
  if (signal.aborted) throw new Error('Preview closed');
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    enableXfa: false,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: true,
    maxImageSize: MAX_IDENTITY_CANVAS_PIXELS,
    canvasMaxAreaInBytes: MAX_IDENTITY_CANVAS_PIXELS * 4,
    verbosity: 0,
    // No CMap/font/WASM base URLs: the worker cannot fetch auxiliary resources.
  });
  const destroy = () => {
    void task.destroy().catch(() => undefined);
  };
  signal.addEventListener('abort', destroy, { once: true });
  try {
    const pdf = await task.promise;
    if (signal.aborted || pdf.numPages > MAX_IDENTITY_PDF_PAGES) {
      destroy();
      throw new Error('Preview unavailable');
    }
    return pdf;
  } catch (failure) {
    signal.removeEventListener('abort', destroy);
    destroy();
    throw failure;
  }
}
