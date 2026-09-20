import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CaseModal } from '../../case-ui/CaseModal';
import { CaseNotice } from '../../case-ui/CasePrimitives';
import { disputeKeys } from '../api';
import { fetchCaseEvidence, uploadCaseEvidence } from './api';
import { EvidenceRedactor } from './EvidenceRedactor';
import { EvidenceUpload } from './EvidenceUpload';
import { WORKSPACE_COPY } from './copy';
export function EvidenceViewer({
  caseId,
  evidenceId,
  admin,
  lang,
  redact,
  onClose,
}: {
  caseId: string;
  evidenceId: string;
  admin: boolean;
  lang: 'en' | 'ar';
  redact: boolean;
  onClose: () => void;
}) {
  const t = WORKSPACE_COPY[lang],
    qc = useQueryClient();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const key = useRef<string | null>(null);
  const savedFile = useRef<File | null>(null);
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    void fetchCaseEvidence(caseId, evidenceId, admin)
      .then((data) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(data);
        setBlob(data);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [caseId, evidenceId, admin]);
  async function exportRedacted(file: File) {
    if (busy) return;
    if (savedFile.current !== file) {
      key.current = crypto.randomUUID();
      savedFile.current = file;
    }
    setBusy(true);
    setError(false);
    try {
      const result = await uploadCaseEvidence(caseId, admin, file, key.current!, evidenceId);
      setUploaded(result.state !== 'PREPARED');
      await qc.invalidateQueries({ queryKey: disputeKeys.root });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CaseModal
      title={redact ? t.redact : t.view}
      description={redact ? t.redactHint : t.privateReplies}
      closeLabel={t.cancel}
      admin={admin}
      pending={busy}
      onClose={onClose}
    >
      {error && <CaseNotice alert>{t.failed}</CaseNotice>}
      {!blob && !error && <p role="status">{t.loading}</p>}
      {uploaded ? (
        <CaseNotice>{t.uploaded}</CaseNotice>
      ) : (
        blob &&
        url && (
          <>
            {redact && blob.type.startsWith('image/') ? (
              <EvidenceRedactor blob={blob} lang={lang} pending={busy} onExport={exportRedacted} />
            ) : (
              <>
                {blob.type.startsWith('image/') && (
                  <img
                    src={url}
                    className="cw-image"
                    alt={t.evidence}
                    referrerPolicy="no-referrer"
                  />
                )}
                <a
                  className="case-button"
                  href={url}
                  download={`case-evidence.${blob.type === 'application/pdf' ? 'pdf' : blob.type === 'image/png' ? 'png' : 'jpg'}`}
                >
                  {t.download}
                </a>
                {redact && (
                  <EvidenceUpload
                    caseId={caseId}
                    admin={admin}
                    lang={lang}
                    disabled={busy}
                    sourceId={evidenceId}
                  />
                )}
              </>
            )}
          </>
        )
      )}
    </CaseModal>
  );
}
