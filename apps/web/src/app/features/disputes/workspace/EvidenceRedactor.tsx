import { useEffect, useRef, useState } from 'react';
import { CaseNotice } from '../../case-ui/CasePrimitives';
import { WORKSPACE_COPY } from './copy';
/** A separate raster is produced. Masking edits its pixels, never the original or a CSS overlay. */
export function EvidenceRedactor({
  blob,
  lang,
  pending,
  onExport,
}: {
  blob: Blob;
  lang: 'en' | 'ar';
  pending: boolean;
  onExport: (file: File) => Promise<void>;
}) {
  const t = WORKSPACE_COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [maskCount, setMaskCount] = useState(0);
  const [region, setRegion] = useState({ x: 0, y: 0, width: 20, height: 10 });
  const [accepted, setAccepted] = useState(false);
  const output = useRef<File | null>(null);
  function paint() {
    const c = canvas.current,
      i = image.current;
    if (!c || !i) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(i, 0, 0, c.width, c.height);
    setMaskCount(0);
    output.current = null;
    setAccepted(false);
  }
  useEffect(() => {
    let disposed = false;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const c = canvas.current;
      if (!c || img.naturalWidth * img.naturalHeight > 40_000_000) {
        setFailed(true);
        return;
      }
      const scale = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      image.current = img;
      paint();
      setReady(true);
    };
    img.onerror = () => {
      if (!disposed) setFailed(true);
    };
    img.src = url;
    return () => {
      disposed = true;
      URL.revokeObjectURL(url);
      image.current = null;
    };
  }, [blob]);
  function cover() {
    const c = canvas.current;
    if (!c || !ready || pending) return;
    const { x, y, width, height } = region;
    if (
      !Object.values(region).every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 100 ||
      y + height > 100
    ) {
      setFailed(true);
      return;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(
      Math.floor((c.width * x) / 100),
      Math.floor((c.height * y) / 100),
      Math.ceil((c.width * width) / 100),
      Math.ceil((c.height * height) / 100),
    );
    output.current = null;
    setAccepted(false);
    setMaskCount((n) => n + 1);
    setFailed(false);
  }
  async function submit() {
    if (!accepted || maskCount < 1 || pending) return;
    if (!output.current) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.current?.toBlob(resolve, 'image/png'),
      );
      if (!blob) {
        setFailed(true);
        return;
      }
      output.current = new File([blob], 'redacted-case-evidence.png', { type: 'image/png' });
    }
    await onExport(output.current);
  }
  return (
    <div className="case-stack">
      <CaseNotice>{t.redactHint}</CaseNotice>
      <canvas ref={canvas} className="cw-redaction-canvas" aria-label={t.redact}>
        {t.redactHint}
      </canvas>
      {failed && <CaseNotice alert>{t.imageFailed}</CaseNotice>}
      <fieldset className="cw-fieldset case-stack" disabled={pending || !ready}>
        <legend>{t.mask}</legend>
        <p className="cw-meta">{t.maskHint}</p>
        <div className="cw-two">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <label className="case-field" key={key}>
              {t[key]}
              <input
                type="number"
                min={key === 'x' || key === 'y' ? 0 : 1}
                max={100}
                value={region[key]}
                onChange={(e) => setRegion((r) => ({ ...r, [key]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>
        <div className="case-actions">
          <button className="case-button" type="button" onClick={cover}>
            {t.applyMask}
          </button>
          <button className="case-button" type="button" onClick={paint}>
            {t.resetImage}
          </button>
        </div>
        <label className="cw-check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>{t.publishAck}</span>
        </label>
      </fieldset>
      <button
        className="case-button case-button-primary"
        type="button"
        disabled={pending || !ready || maskCount < 1 || !accepted}
        onClick={() => void submit()}
      >
        {pending ? t.uploading : t.exportRedacted}
      </button>
    </div>
  );
}
