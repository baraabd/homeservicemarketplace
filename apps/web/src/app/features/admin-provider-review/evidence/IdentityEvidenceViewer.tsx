import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Download, Expand, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { AdminVerificationDocument } from '@homeservicemarketplace/contracts';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { ReviewDialog } from '../components/ReviewDialog';
import { ReviewBanner } from '../components/ReviewPrimitives';
import { useEvidenceDownload } from '../../admin-verification/evidence/useEvidenceDownload';
import { IDENTITY_PREVIEW_COPY } from './identity-preview-copy';
import { useIdentityPreview } from './useIdentityPreview';
import { IdentityPdfCanvas } from './IdentityPdfCanvas';
import './identity-preview.css';

export function IdentityEvidenceViewer({
  document,
  allowed,
  lang,
  onClose,
  openerRef,
}: {
  document: AdminVerificationDocument;
  allowed: boolean;
  lang: ReviewLanguage;
  onClose: () => void;
  openerRef: RefObject<HTMLButtonElement>;
}) {
  const t = IDENTITY_PREVIEW_COPY[lang];
  const common = REVIEW_COPY[lang];
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const fail = useCallback(() => setRenderFailed(true), []);
  const preview = useIdentityPreview(document.id, allowed && !renderFailed, attempt);
  const download = useEvidenceDownload();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 640, height: 420 });
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({
        width: Math.max(1, element.clientWidth - 24),
        height: Math.max(1, Math.min(window.innerHeight * 0.5, 600) - 24),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const rotated = rotation % 180 !== 0;
  const bounding = rotated ? { width: natural.height, height: natural.width } : natural;
  const scale =
    Math.min(viewport.width / bounding.width, viewport.height / bounding.height, 1) * zoom;
  const ready = preview.status === 'image' || preview.status === 'pdf';
  const error = renderFailed
    ? t.unsupported
    : preview.status === 'expired'
      ? t.expired
      : preview.status === 'sessionExpired'
        ? t.sessionExpired
        : preview.status === 'unsupported'
          ? t.unsupported
          : t.unavailable;
  return (
    <ReviewDialog
      open
      onClose={onClose}
      title={document.displayFilename || t.image}
      description={t.description}
      openerRef={openerRef}
      className="ar-evidence-dialog"
    >
      <div className="ar-evidence-viewer" data-testid="identity-evidence-viewer" ref={viewportRef}>
        <div className="ar-evidence-toolbar" role="group" aria-label={t.controls}>
          <button
            className="ar-button"
            type="button"
            disabled={!ready || zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
            aria-label={t.zoomIn}
            data-testid="identity-evidence-zoom-in"
          >
            <ZoomIn size={18} aria-hidden />
          </button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button
            className="ar-button"
            type="button"
            disabled={!ready || zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.25))}
            aria-label={t.zoomOut}
            data-testid="identity-evidence-zoom-out"
          >
            <ZoomOut size={18} aria-hidden />
          </button>
          <button
            className="ar-button"
            type="button"
            disabled={!ready}
            onClick={() => {
              setZoom(1);
              setRotation(0);
            }}
            data-testid="identity-evidence-fit"
          >
            <Expand size={18} aria-hidden />
            {t.fit}
          </button>
          <button
            className="ar-button"
            type="button"
            disabled={!ready}
            onClick={() => setRotation((value) => (value + 90) % 360)}
            aria-label={t.rotate}
          >
            <RotateCw size={18} aria-hidden />
          </button>
        </div>
        {preview.status === 'loading' ? (
          <div className="ar-evidence-placeholder" role="status">
            {common.loading}
          </div>
        ) : preview.status === 'image' ? (
          <div className="ar-evidence-scroll" role="region" aria-label={t.pan} tabIndex={0}>
            <div
              className="ar-evidence-image-stage"
              style={{ width: bounding.width * scale, height: bounding.height * scale }}
            >
              <img
                src={preview.url}
                alt={t.image}
                data-testid="identity-evidence-image"
                draggable={false}
                onLoad={(event) =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={fail}
                style={{
                  width: natural.width * scale,
                  height: natural.height * scale,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              />
            </div>
          </div>
        ) : preview.status === 'pdf' ? (
          <IdentityPdfCanvas
            key={attempt}
            blob={preview.blob}
            zoom={zoom}
            rotation={rotation}
            width={viewport.width}
            height={viewport.height}
            lang={lang}
            onFailure={fail}
          />
        ) : (
          <ReviewBanner tone="warning" role="alert">
            {error}
          </ReviewBanner>
        )}
        <div className="ar-actions">
          {!ready &&
            preview.status !== 'loading' &&
            preview.status !== 'sessionExpired' &&
            allowed && (
              <button
                type="button"
                className="ar-button"
                onClick={() => {
                  setRenderFailed(false);
                  setAttempt((value) => value + 1);
                  setZoom(1);
                  setRotation(0);
                }}
              >
                {t.reopen}
              </button>
            )}
          <button
            type="button"
            className="ar-button"
            disabled={!allowed || preview.status === 'sessionExpired'}
            onClick={() => download.open(document.id)}
          >
            <Download size={16} aria-hidden />
            {common.download}
          </button>
        </div>
        {download.failed && (
          <ReviewBanner tone="danger" role="alert">
            {common.evidenceFailed}
          </ReviewBanner>
        )}
      </div>
    </ReviewDialog>
  );
}
