import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { IDENTITY_PREVIEW_COPY } from './identity-preview-copy';
import { loadIdentityPdf, MAX_IDENTITY_CANVAS_PIXELS } from './identity-pdf';

export function IdentityPdfCanvas({
  blob,
  zoom,
  rotation,
  width,
  height,
  lang,
  onFailure,
}: {
  blob: Blob;
  zoom: number;
  rotation: number;
  width: number;
  height: number;
  lang: ReviewLanguage;
  onFailure: () => void;
}) {
  const t = IDENTITY_PREVIEW_COPY[lang];
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const renderKey = [page, zoom, rotation, width, height].join(':');
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const loading = !pdf || renderedKey !== renderKey;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadIdentityPdf(blob, controller.signal)
      .then((document) => {
        if (!controller.signal.aborted) setPdf(document);
      })
      .catch(() => {
        if (!controller.signal.aborted) onFailure();
      });
    return () => controller.abort();
  }, [blob, onFailure]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let renderedPage: PDFPageProxy | undefined;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (cancelled) return;
        renderedPage = documentPage;
        const pageRotation = (documentPage.rotate + rotation) % 360;
        const natural = documentPage.getViewport({ scale: 1, rotation: pageRotation });
        if (
          !Number.isFinite(natural.width) ||
          !Number.isFinite(natural.height) ||
          natural.width <= 0 ||
          natural.height <= 0
        ) {
          throw new Error('Invalid page dimensions');
        }
        const fit = Math.min(width / natural.width, height / natural.height);
        const scale = Math.min(
          fit * zoom * Math.min(window.devicePixelRatio || 1, 2),
          Math.sqrt(MAX_IDENTITY_CANVAS_PIXELS / (natural.width * natural.height)),
        );
        const viewport = documentPage.getViewport({ scale, rotation: pageRotation });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${natural.width * fit * zoom}px`;
        canvas.style.height = `${natural.height * fit * zoom}px`;
        task = documentPage.render({ canvas, viewport, annotationMode: 0 });
        await task.promise;
        if (!cancelled) setRenderedKey(renderKey);
      })
      .catch(() => {
        if (!cancelled) onFailure();
      });
    return () => {
      cancelled = true;
      task?.cancel();
      if (task && renderedPage) {
        const pageToRelease = renderedPage;
        void task.promise.then(
          () => pageToRelease.cleanup(),
          () => pageToRelease.cleanup(),
        );
      }
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdf, page, zoom, rotation, width, height, renderKey, onFailure]);
  return (
    <>
      {loading && <p role="status">{REVIEW_COPY[lang].loading}</p>}
      {pdf && (
        <nav className="ar-evidence-pages" aria-label={t.pdf}>
          <button
            type="button"
            className="ar-button"
            aria-label={t.previous}
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {lang === 'ar' ? (
              <ChevronRight aria-hidden size={18} />
            ) : (
              <ChevronLeft aria-hidden size={18} />
            )}
          </button>
          <span role="status">{t.page(page, pdf.numPages)}</span>
          <button
            type="button"
            className="ar-button"
            aria-label={t.next}
            disabled={page >= pdf.numPages}
            onClick={() => setPage((value) => value + 1)}
          >
            {lang === 'ar' ? (
              <ChevronLeft aria-hidden size={18} />
            ) : (
              <ChevronRight aria-hidden size={18} />
            )}
          </button>
        </nav>
      )}
      <div
        className="ar-evidence-scroll"
        tabIndex={0}
        role="region"
        aria-label={t.pan}
        aria-busy={loading}
      >
        <canvas
          ref={canvasRef}
          className="ar-evidence-canvas"
          role="img"
          aria-label={pdf ? t.page(page, pdf.numPages) : t.pdf}
          data-testid="identity-evidence-pdf"
        />
      </div>
    </>
  );
}
