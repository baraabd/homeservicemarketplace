import { formatReviewDate } from '../format-review-date';
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  AdminProviderReview,
  VerificationCaseActionCode,
} from '@homeservicemarketplace/contracts';
import { useEvidenceDownload } from '../../admin-verification/evidence/useEvidenceDownload';
import { DOCUMENT_KIND_LABELS, UI } from '../../admin-verification/copy/verification-copy';
import { runCaseCommand } from '../../admin-verification/queue/verification-queue-api';
import { Download, FileText, LockKeyhole, ScanSearch } from 'lucide-react';
import { REVIEW_COPY, type ReviewLanguage } from '../copy';
import { requestStatus } from '../api';
import { ReviewBadge, ReviewBanner, StatusBadge } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';
import { IdentityEvidenceViewer } from '../evidence/IdentityEvidenceViewer';
import { IDENTITY_PREVIEW_COPY } from '../evidence/identity-preview-copy';
import { verificationReasonLabel } from '../evidence/verification-reason-labels';

const ACTION_LABEL: Record<VerificationCaseActionCode, string> = {
  assign: 'actionAssign',
  requestAction: 'actionRequestAction',
  approve: 'actionApprove',
  reject: 'actionReject',
  reverify: 'actionReverify',
  revoke: 'actionRevoke',
};
const REASONS: Partial<Record<VerificationCaseActionCode, string[]>> = {
  approve: ['DOCUMENTS_COMPLETE_AND_LEGIBLE'],
  requestAction: ['DOCUMENT_MISSING', 'DOCUMENT_ILLEGIBLE', 'DOCUMENT_EXPIRED', 'OTHER'],
  reject: ['DOCUMENT_MISMATCH', 'SUSPECTED_FORGERY', 'DUPLICATE_IDENTITY', 'OTHER'],
  reverify: ['POLICY_PERIOD_ELAPSED', 'OTHER'],
  revoke: ['TRUST_AND_SAFETY_ACTION', 'PROVIDER_REQUESTED', 'OTHER'],
};

export function ReviewIdentity({
  review,
  lang,
  onChanged,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
}) {
  const t = REVIEW_COPY[lang];
  const actionLabel = (action: VerificationCaseActionCode) =>
    action === 'reverify'
      ? lang === 'ar'
        ? 'طلب ملف توثيق جديد'
        : 'Request fresh verification'
      : UI[lang][ACTION_LABEL[action]];
  const kase = review.verification;
  const evidence = useEvidenceDownload();
  const previewOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewDocument = kase?.documents.find((document) => document.id === previewId);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [chosen, setChosen] = useState<{
    action: VerificationCaseActionCode;
    expectedState: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({ mutationFn: runCaseCommand });
  async function confirm() {
    if (!chosen || !kase) return;
    if (chosen.action !== 'assign' && !reason) {
      setInvalid(true);
      return;
    }
    try {
      await mutation.mutateAsync({
        caseId: kase.id,
        ...chosen,
        reasonCode: reason || undefined,
        note: note.trim() || undefined,
      });
      setChosen(null);
      setError(null);
      setNote('');
      setReason('');
      await onChanged();
    } catch (failure) {
      setError(requestStatus(failure) ?? 500);
    }
  }
  return (
    <div className="ar-stack" data-testid="review-identity">
      <div className="ar-divider" />
      <div className="ar-subheader">
        <h3 className="ar-subheading">{t.evidence}</h3>
        <ReviewBadge>
          <LockKeyhole size={14} aria-hidden />
          {t.protected}
        </ReviewBadge>
      </div>
      <p className="ar-muted">{t.evidenceHint}</p>
      {!kase ? (
        <ReviewBanner>{t.noEvidence}</ReviewBanner>
      ) : (
        <>
          <div className="ar-meta">
            <StatusBadge value={kase.state} lang={lang} />
            <span>
              {t.policyVersion}: <bdi dir="ltr">{kase.policyVersion}</bdi>
            </span>
            <span>{formatReviewDate(kase.submittedAt, lang, t.notProvided)}</span>
          </div>
          {!!kase.requirements.length && (
            <div>
              <h4 className="ar-subheading">{t.requirements}</h4>
              <ul className="ar-list">
                {kase.requirements.map((requirement, i) => (
                  <li
                    className="ar-list-row"
                    key={`${requirement.kind}-${requirement.serviceCategoryId}-${i}`}
                  >
                    <div>
                      {DOCUMENT_KIND_LABELS[lang][requirement.kind]}
                      {requirement.serviceCategoryId && (
                        <p className="ar-muted">
                          {lang === 'ar'
                            ? requirement.serviceCategoryLabelAr
                            : requirement.serviceCategoryLabelEn}
                        </p>
                      )}
                    </div>
                    <ReviewBadge tone={requirement.satisfied ? 'success' : 'warning'}>
                      {requirement.satisfied ? t.satisfied : t.outstanding}
                    </ReviewBadge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!review.permissions.canViewEvidence && (
            <ReviewBanner tone="warning">{t.evidenceDenied}</ReviewBanner>
          )}
          <ul className="ar-list">
            {kase.documents.map((document) => (
              <li className="ar-list-row" key={document.id}>
                <div className="ar-document">
                  <FileText size={22} aria-hidden />
                  <div>
                    <strong>{DOCUMENT_KIND_LABELS[lang][document.kind]}</strong>
                    <p className="ar-muted">{document.displayFilename || t.notProvided}</p>
                    <StatusBadge value={document.scanState} lang={lang} />
                    {document.supersededAt && (
                      <p className="ar-muted">
                        {lang === 'ar' ? 'وثيقة سابقة تم استبدالها' : 'Previous document, replaced'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="ar-actions">
                  <button
                    type="button"
                    data-testid={`review-evidence-${document.id}`}
                    className="ar-button"
                    disabled={!review.permissions.canViewEvidence || !document.viewable}
                    onClick={(event) => {
                      previewOpenerRef.current = event.currentTarget;
                      setPreviewId(document.id);
                    }}
                  >
                    <ScanSearch size={16} aria-hidden />
                    {document.viewable && review.permissions.canViewEvidence
                      ? IDENTITY_PREVIEW_COPY[lang].open
                      : t.unavailable}
                  </button>
                  <button
                    type="button"
                    data-testid={`review-evidence-download-${document.id}`}
                    className="ar-button"
                    disabled={!review.permissions.canViewEvidence || !document.viewable}
                    onClick={() => evidence.open(document.id)}
                  >
                    <Download size={16} aria-hidden />
                    {document.viewable && review.permissions.canViewEvidence
                      ? t.download
                      : t.unavailable}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {evidence.failed && (
            <ReviewBanner tone="danger" role="alert">
              {t.evidenceFailed}
            </ReviewBanner>
          )}
          {review.permissions.canDecide && !!kase.availableActions.length && (
            <details>
              <summary className="ar-disclosure">{t.caseAction}</summary>
              <p className="ar-muted">{UI[lang].axisNote}</p>
              <div className="ar-actions">
                {kase.availableActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="ar-button"
                    data-testid={`review-case-${action}`}
                    onClick={(event) => {
                      openerRef.current = event.currentTarget;
                      setChosen({ action, expectedState: kase.state });
                      setReason('');
                      setError(null);
                      setInvalid(false);
                    }}
                  >
                    {actionLabel(action)}
                  </button>
                ))}
              </div>
            </details>
          )}
          <details>
            <summary className="ar-disclosure">{t.verifiedEvidence}</summary>
            {kase.decisions.length ? (
              <ul className="ar-timeline">
                {kase.decisions.map((decision) => (
                  <li key={decision.id} className="ar-timeline-item">
                    <StatusBadge value={decision.toState} lang={lang} />
                    <p>{verificationReasonLabel(decision.reasonCode, lang)}</p>
                    <small className="ar-muted">
                      {formatReviewDate(decision.decidedAt, lang, t.notProvided)} ·{' '}
                      <bdi dir="ltr">{decision.policyVersion}</bdi>
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ar-muted">{t.noDocumentHistory}</p>
            )}
          </details>
        </>
      )}
      {previewDocument && (
        <IdentityEvidenceViewer
          key={`${review.provider.id}:${previewDocument.id}`}
          document={previewDocument}
          allowed={review.permissions.canViewEvidence && previewDocument.viewable}
          lang={lang}
          onClose={() => setPreviewId(null)}
          openerRef={previewOpenerRef}
        />
      )}
      <ReviewDialog
        open={!!chosen}
        onClose={() => {
          if (!mutation.isPending) setChosen(null);
        }}
        title={chosen ? actionLabel(chosen.action) : t.caseAction}
        description={UI[lang].axisNote}
        openerRef={openerRef}
      >
        {chosen?.action !== 'assign' && (
          <label className="ar-label">
            {t.caseReason}
            <select
              className="ar-input"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setInvalid(false);
              }}
            >
              <option value="">{t.reasonRequired}</option>
              {(REASONS[chosen?.action ?? 'assign'] ?? []).map((code) => (
                <option key={code} value={code}>
                  {verificationReasonLabel(code, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ar-label">
          {t.privateNote}
          <textarea
            className="ar-input"
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <small>{t.privateHint}</small>
        </label>
        {invalid && (
          <ReviewBanner role="alert" tone="danger">
            {t.requiresReason}
          </ReviewBanner>
        )}
        {error && (
          <ReviewBanner role="alert" tone="danger">
            {error === 409 ? t.conflict : error === 403 ? t.noActions : t.mutationFailed}
          </ReviewBanner>
        )}
        <div className="ar-actions">
          {error === 409 ? (
            <button
              className="ar-button"
              type="button"
              onClick={async () => {
                try {
                  await onChanged();
                  setChosen(null);
                } catch {
                  /* Preserve the conflict and private note. */
                }
              }}
            >
              {t.refresh}
            </button>
          ) : (
            <button
              className="ar-button ar-button-primary"
              type="button"
              disabled={mutation.isPending || error === 403}
              onClick={() => void confirm()}
            >
              {mutation.isPending ? t.saving : t.confirm}
            </button>
          )}
          <button
            className="ar-button"
            type="button"
            disabled={mutation.isPending}
            onClick={() => setChosen(null)}
          >
            {t.cancel}
          </button>
        </div>
      </ReviewDialog>
    </div>
  );
}
