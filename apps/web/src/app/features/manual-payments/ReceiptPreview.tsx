import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ManualReceiptVersionV1 } from '@homeservicemarketplace/contracts';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { AUTH_BOUNDARY_KEY } from '../../../lib/auth-session-boundary';
import { useLang } from '../../i18n/LanguageContext';
import { ProviderButton } from '../provider-ui';
import {
  loadIdentityPdf,
  MAX_IDENTITY_CANVAS_PIXELS,
} from '../admin-provider-review/evidence/identity-pdf';
import { readManualReceipt } from './manual-payments.api';
import { MANUAL_PAYMENT_COPY } from './manual-payments.copy';

type Preview =
  | { identity: string; kind: 'image'; url: string; inspectionId: string | null }
  | { identity: string; kind: 'pdf'; blob: Blob; inspectionId: string | null }
  | { identity: string; kind: 'error' | 'expired' | 'unsupported' };

/** Explicit authenticated reads only. No receipt bytes enter caches, localStorage or external URLs. */
export function ReceiptPreview({
  receipt,
  onClose,
  onInspected,
  onInvalidated,
}: {
  receipt: ManualReceiptVersionV1;
  onClose: () => void;
  onInspected?: (inspectionId: string, receiptVersionId: string) => void;
  onInvalidated?: () => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const identity = `${receipt.id}:${receipt.mediaAssetId}:${receipt.revision}:${receipt.canRead}`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readyIdentity, setReadyIdentity] = useState<string | null>(null);
  const invalidated = useRef(onInvalidated);
  useLayoutEffect(() => {
    invalidated.current = onInvalidated;
  }, [onInvalidated]);
  useEffect(() => {
    invalidated.current?.();
    if (!receipt.canRead) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    const release = () => {
      controller.abort();
      if (expiry) clearTimeout(expiry);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const expire = () => {
      release();
      setPreview({ identity, kind: 'expired' });
      invalidated.current?.();
    };
    const boundary = (event: StorageEvent) => {
      if (event.key === AUTH_BOUNDARY_KEY) expire();
    };
    window.addEventListener('auth:session-expired', expire);
    window.addEventListener('storage', boundary);
    void readManualReceipt(receipt.mediaAssetId, controller.signal)
      .then(({ blob, inspectionId }) => {
        if (controller.signal.aborted) return;
        const mime = blob instanceof Blob ? blob.type.split(';')[0].trim().toLowerCase() : '';
        if (
          !(blob instanceof Blob) ||
          blob.size === 0 ||
          blob.size > 20 * 1024 * 1024 ||
          (receipt.contentType !== null && mime !== receipt.contentType)
        ) {
          setPreview({ identity, kind: 'unsupported' });
          return;
        }
        if (mime === 'image/jpeg' || mime === 'image/png') {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ identity, kind: 'image', url: objectUrl, inspectionId });
        } else if (mime === 'application/pdf') {
          setPreview({ identity, kind: 'pdf', blob, inspectionId });
        } else {
          setPreview({ identity, kind: 'unsupported' });
          return;
        }
        expiry = setTimeout(expire, 5 * 60 * 1000);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ identity, kind: 'error' });
      });
    return () => {
      release();
      window.removeEventListener('auth:session-expired', expire);
      window.removeEventListener('storage', boundary);
      invalidated.current?.();
    };
  }, [identity, receipt.canRead, receipt.contentType, receipt.mediaAssetId]);
  const fail = useCallback(() => {
    setPreview({ identity, kind: 'error' });
    invalidated.current?.();
  }, [identity]);
  const ready = useCallback(() => setReadyIdentity(identity), [identity]);
  const current = receipt.canRead && preview?.identity === identity ? preview : null;
  const inspectionId =
    current && (current.kind === 'image' || current.kind === 'pdf') ? current.inspectionId : null;
  return (
    <section className="mp-preview mp-stack" aria-label={t.preview}>
      <div className="mp-header">
        <h3>{t.preview}</h3>
        <ProviderButton tone="secondary" onClick={onClose}>
          {t.close}
        </ProviderButton>
      </div>
      <p className="mp-muted">{t.previewHint}</p>
      {!receipt.canRead ? (
        <p role="alert">{t.previewUnavailable}</p>
      ) : !current ? (
        <p role="status">{t.loading}</p>
      ) : current.kind === 'image' ? (
        <div className="mp-preview-scroll" tabIndex={0} role="region" aria-label={t.receiptArea}>
          <img src={current.url} alt={t.image} onLoad={ready} onError={fail} />
        </div>
      ) : current.kind === 'pdf' ? (
        <ReceiptPdf key={identity} blob={current.blob} onReady={ready} onFailure={fail} />
      ) : (
        <p role="alert">
          {current.kind === 'expired'
            ? t.previewExpired
            : current.kind === 'unsupported'
              ? t.previewUnsupported
              : t.previewUnavailable}
        </p>
      )}
      {onInspected && inspectionId && readyIdentity === identity && (
        <ProviderButton tone="secondary" onClick={() => onInspected(inspectionId, receipt.id)}>
          {t.inspected}
        </ProviderButton>
      )}
    </section>
  );
}

/** Reuses the accepted restricted-document parser; no PDF forms, scripting or remote fetches. */
function ReceiptPdf({
  blob,
  onReady,
  onFailure,
}: {
  blob: Blob;
  onReady: () => void;
  onFailure: () => void;
}) {
  const { lang } = useLang();
  const t = MANUAL_PAYMENT_COPY[lang];
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [rendered, setRendered] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadIdentityPdf(blob, controller.signal)
      .then((pdf) => {
        if (!controller.signal.aborted) setDocument(pdf);
      })
      .catch(() => {
        if (!controller.signal.aborted) onFailure();
      });
    return () => controller.abort();
  }, [blob, onFailure]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    const target = canvas.current;
    let stopped = false;
    let task: RenderTask | null = null;
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (stopped) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        if (
          !Number.isFinite(natural.width) ||
          !Number.isFinite(natural.height) ||
          natural.width <= 0 ||
          natural.height <= 0
        )
          throw new Error('Invalid receipt page');
        const scale = Math.min(
          1.5,
          Math.sqrt(MAX_IDENTITY_CANVAS_PIXELS / (natural.width * natural.height)),
        );
        const viewport = pdfPage.getViewport({ scale });
        target.width = Math.max(1, Math.floor(viewport.width));
        target.height = Math.max(1, Math.floor(viewport.height));
        task = pdfPage.render({ canvas: target, viewport, annotationMode: 0 });
        try {
          await task.promise;
          if (!stopped) {
            setRendered(page);
            onReady();
          }
        } finally {
          pdfPage.cleanup();
        }
      })
      .catch(() => {
        if (!stopped) onFailure();
      });
    return () => {
      stopped = true;
      task?.cancel();
      target.width = 0;
      target.height = 0;
    };
  }, [document, page, onFailure, onReady]);
  return (
    <div className="mp-stack">
      {(!document || rendered !== page) && <p role="status">{t.loading}</p>}
      {document && (
        <nav className="mp-actions" aria-label={t.preview}>
          <ProviderButton
            tone="secondary"
            onClick={() => setPage((value) => value - 1)}
            disabled={page <= 1}
          >
            {t.previousPage}
          </ProviderButton>
          <span aria-live="polite">
            {page} / {document.numPages}
          </span>
          <ProviderButton
            tone="secondary"
            onClick={() => setPage((value) => value + 1)}
            disabled={page >= document.numPages}
          >
            {t.nextPage}
          </ProviderButton>
        </nav>
      )}
      <div className="mp-preview-scroll" tabIndex={0} role="region" aria-label={t.receiptArea}>
        <canvas ref={canvas} role="img" aria-label={t.image} />
      </div>
    </div>
  );
}
