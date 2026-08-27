import { useCallback, useState } from 'react';

import { downloadEvidenceDocument } from './evidence-download';

// Sprint 9B.12 — one place that knows how to open a restricted document, used
// by both surfaces that show evidence (the case workspace and the provider
// drawer). Two copies of this would eventually disagree about what a failure
// means, and the failure is the part that has to be worded carefully: the
// server answers a denial and a missing document identically on purpose, so
// neither surface may claim to know which happened.

export interface EvidenceDownload {
  /** Opens one document. Never throws — the failure lands in `failed`. */
  open: (documentId: string) => void;
  /** True after a failed attempt, until the next one starts. */
  failed: boolean;
}

export function useEvidenceDownload(): EvidenceDownload {
  const [failed, setFailed] = useState(false);

  const open = useCallback((documentId: string) => {
    setFailed(false);
    void downloadEvidenceDocument(documentId).catch(() => setFailed(true));
  }, []);

  return { open, failed };
}
