import { useState } from 'react';
import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseBadge, CaseDate } from '../../case-ui/CasePrimitives';
import { EvidenceUpload } from './EvidenceUpload';
import { EvidenceViewer } from './EvidenceViewer';
import type { CommandSelection } from './command-model';
import { ACTION_LABELS, WORKSPACE_COPY, translatedLabel } from './copy';
export function WorkspaceEvidence({
  view,
  admin,
  lang,
  disabled,
  onAction,
}: {
  view: DisputeWorkspaceView;
  admin: boolean;
  lang: 'en' | 'ar';
  disabled: boolean;
  onAction: (selection: CommandSelection) => void;
}) {
  const t = WORKSPACE_COPY[lang];
  const [viewer, setViewer] = useState<{ id: string; redact: boolean } | null>(null);
  const activeViewer =
    viewer && view.evidence.some((e) => e.id === viewer.id && e.viewable) ? viewer : null;
  return (
    <section className="case-card case-stack cw-section" id="case-evidence">
      <h2>{t.evidence}</h2>
      <p className="case-muted">{t.privateReplies}</p>
      {view.canUploadEvidence && view.role !== 'REVIEWER' && (
        <EvidenceUpload caseId={view.disputeId} admin={admin} lang={lang} disabled={disabled} />
      )}
      {!view.evidence.length ? (
        <p className="case-muted">{t.noEvidence}</p>
      ) : (
        <ul className="cw-items">
          {view.evidence.map((e, i) => (
            <li className="cw-box case-stack" key={e.id}>
              <div className="case-summary">
                <h3>
                  {(i + 1).toLocaleString(lang)}.{' '}
                  {e.shared ? t.shared : e.redactedDerivative ? t.derivative : t.private}
                </h3>
                <CaseBadge>{translatedLabel(t.evidenceStates, e.state, t.event)}</CaseBadge>
              </div>
              <p className="cw-meta">
                {t.fileType}: <bdi dir="ltr">{e.mimeType}</bdi> · {t.fileSize}:{' '}
                {(e.sizeBytes / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} KiB
              </p>
              <p className="cw-meta">
                <CaseDate value={e.createdAt} lang={lang} />
              </p>
              <p className="cw-meta">
                {t.expires}: <CaseDate value={e.retainUntil} lang={lang} />
              </p>
              <div className="case-actions">
                {e.viewable && (
                  <button
                    type="button"
                    className="case-button"
                    disabled={disabled}
                    onClick={() => setViewer({ id: e.id, redact: false })}
                  >
                    {t.view}
                  </button>
                )}
                {e.viewable &&
                  !e.redactedDerivative &&
                  view.canUploadEvidence &&
                  view.role === 'REVIEWER' && (
                    <button
                      type="button"
                      className="case-button"
                      disabled={disabled}
                      onClick={() => setViewer({ id: e.id, redact: true })}
                    >
                      {t.redact}
                    </button>
                  )}
                {e.viewable &&
                  e.redactedDerivative &&
                  !e.shared &&
                  view.availableActions.includes('SHARE_REDACTED_EVIDENCE') && (
                    <button
                      type="button"
                      className="case-button"
                      disabled={disabled}
                      onClick={() =>
                        onAction({ action: 'SHARE_REDACTED_EVIDENCE', entityId: e.id })
                      }
                    >
                      {ACTION_LABELS[lang].SHARE_REDACTED_EVIDENCE}
                    </button>
                  )}
                {!['ERASED', 'ERASING', 'ERASURE_FAILED', 'ERASURE_DEAD'].includes(e.state) &&
                  view.availableActions.includes('HOLD_EVIDENCE') && (
                    <button
                      type="button"
                      className="case-button"
                      disabled={disabled}
                      onClick={() => onAction({ action: 'HOLD_EVIDENCE', entityId: e.id })}
                    >
                      {ACTION_LABELS[lang].HOLD_EVIDENCE}
                    </button>
                  )}
                {['DEAD', 'ERASURE_DEAD'].includes(e.state) &&
                  view.availableActions.includes('REQUEUE_EVIDENCE') && (
                    <button
                      type="button"
                      className="case-button"
                      disabled={disabled}
                      onClick={() => onAction({ action: 'REQUEUE_EVIDENCE', entityId: e.id })}
                    >
                      {ACTION_LABELS[lang].REQUEUE_EVIDENCE}
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {activeViewer && (
        <EvidenceViewer
          key={activeViewer.id}
          caseId={view.disputeId}
          evidenceId={activeViewer.id}
          admin={admin}
          lang={lang}
          redact={activeViewer.redact}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}
