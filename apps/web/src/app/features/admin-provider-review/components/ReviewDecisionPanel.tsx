import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  AdminProviderReview,
  AdminProviderReviewFeedbackInput,
  AdminProviderReviewMutationResponse,
} from '@homeservicemarketplace/contracts';
import { approveProviderReview, requestProviderReviewChanges, requestStatus } from '../api';
import { BLOCKER_LABELS, REVIEW_COPY, TASK_LABELS, type ReviewLanguage } from '../copy';
import { ReviewBadge, ReviewBanner } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';
import { reviewCorrectionFieldLabel } from '../../provider-onboarding-v2/copy/review-correction-fields';
import {
  WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS,
  WEB_PROVIDER_REVIEW_CORRECTION_FIELDS,
} from '../runtime-constants';

const blankCorrection = (): AdminProviderReviewFeedbackInput => ({
  taskId: 'BASICS_IDENTITY',
  reasonCode: 'INFORMATION_INCORRECT',
  providerMessage: '',
});

export function ReviewDecisionPanel({
  review,
  lang,
  onChanged,
  onDecided,
  readOnly = false,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  /** A failed/pending dossier refresh must not discard unsent notes or allow decisions. */
  readOnly?: boolean;
  onChanged: () => Promise<unknown>;
  onDecided: (response: AdminProviderReviewMutationResponse) => void;
}) {
  const t = REVIEW_COPY[lang];
  const pausedMessage = lang === 'ar'
    ? 'القرارات متوقفة حتى نجاح تحديث الملف. النصوص غير المرسلة باقية في هذه الصفحة.'
    : 'Decisions are paused until the file refresh succeeds. Unsent text remains on this page.';
  const [note, setNote] = useState('');
  const [corrections, setCorrections] = useState<AdminProviderReviewFeedbackInput[]>([
    blankCorrection(),
  ]);
  // The exact content version visible when the reviewer opened confirmation.
  // Refreshing a background query must never silently change a pending command.
  const [selection, setSelection] = useState<{
    action: 'approve' | 'requestChanges';
    revision: string;
    submissionId: string;
  } | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [success, setSuccess] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('No review command selected');
      const base = {
        submissionId: selection.submissionId,
        expectedRevision: selection.revision,
        note: note.trim() || undefined,
      };
      const feedback = corrections.map((item) => ({
        ...item,
        providerMessage: item.providerMessage.trim(),
      }));
      const signature = JSON.stringify({
        ...base,
        action: selection.action,
        ...(selection.action === 'requestChanges' ? { feedback } : {}),
      });
      // A lost response may be retried safely. Changed content gets a new intent key.
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const command = { ...base, idempotencyKey: attempt.current.key };
      return selection.action === 'approve'
        ? approveProviderReview(review.provider.id, {
            ...command,
            reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
          })
        : requestProviderReviewChanges(review.provider.id, { ...command, feedback });
    },
  });
  const reasonOptions = [
    ['INFORMATION_MISSING', t.reasonMissing],
    ['INFORMATION_INCORRECT', t.reasonIncorrect],
    ['INFORMATION_UNCLEAR', t.reasonUnclear],
    ['OTHER', t.reasonOther],
  ];
  function updateCorrection(index: number, patch: Partial<AdminProviderReviewFeedbackInput>) {
    setCorrections((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setInvalid(false);
  }
  function targetItems(item: AdminProviderReviewFeedbackInput) {
    if (item.field === 'portfolio')
      return review.current.portfolio.map((row, index) => ({
        id: row.id,
        label: row.title || (lang === 'ar' ? `الصورة ${index + 1}` : `Image ${index + 1}`),
      }));
    if (item.field === 'specialties')
      return review.current.services.specialties.map((row) => ({
        id: row.id,
        label: lang === 'ar' ? row.labelAr : row.labelEn,
      }));
    if (['verificationDocuments', 'identityDocument', 'categoryLicense'].includes(item.field ?? ''))
      return (review.verification?.documents ?? [])
        .filter(
          (row) =>
            !row.supersededAt &&
            (item.field !== 'categoryLicense' || row.kind === 'CATEGORY_LICENSE') &&
            (item.field !== 'identityDocument' ||
              ['INDIVIDUAL_IDENTITY', 'AUTHORIZED_REPRESENTATIVE_IDENTITY'].includes(row.kind)),
        )
        .map((row, index) => ({
          id: row.id,
          label: row.displayFilename || `${lang === 'ar' ? 'الوثيقة' : 'Document'} ${index + 1}`,
        }));
    return [];
  }
  async function confirm() {
    if (!selection || readOnly) return;
    if (
      selection.action === 'requestChanges' &&
      corrections.some((item) => !item.providerMessage.trim())
    ) {
      setInvalid(true);
      return;
    }
    if (selection.action === 'approve' && !accepted) {
      setInvalid(true);
      return;
    }
    try {
      const response = await mutation.mutateAsync();
      onDecided(response);
      setSelection(null);
      setNote('');
      setCorrections([blankCorrection()]);
      setError(null);
      setSuccess(true);
      attempt.current = null;
    } catch (failure) {
      setError(requestStatus(failure) ?? 500);
    }
  }
  const capabilityLabels: Record<string, string> = {
    VIEW_MARKETPLACE: t.viewMarketplace,
    SUBMIT_BID: t.submitBid,
    MANAGE_BOOKINGS: t.manageBookings,
    VIEW_EARNINGS: t.viewEarnings,
  };
  return (
    <aside id="review-decision-panel" className="ar-stack ar-decision" aria-label={t.reviewPanel}>
      <section className="ar-card ar-stack">
        <div className="ar-subheader">
          <h2 className="ar-heading">{t.reviewPanel}</h2>
          <ShieldCheck size={22} aria-hidden className="ar-muted" />
        </div>
        <p className="ar-muted">{t.decisionHint}</p>
        {readOnly && (
          <ReviewBanner role="status" tone="warning">
            {pausedMessage}
          </ReviewBanner>
        )}
        {success && (
          <ReviewBanner role="status" tone="success">
            {t.decisionSuccess}
          </ReviewBanner>
        )}
        {review.blockers.length ? (
          <div>
            <h3 className="ar-subheading">{t.blockers}</h3>
            <ul className="ar-blockers">
              {review.blockers.map((blocker, index) => (
                <li key={`${blocker.code}-${index}`}>
                  {BLOCKER_LABELS[lang][blocker.code] ?? t.blocked}
                  {blocker.taskId && (
                    <a href={`#review-section-${blocker.taskId}`}>
                      {TASK_LABELS[lang][blocker.taskId]}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          !!review.availableActions.length && (
            <ReviewBadge tone="success">
              <Check size={15} aria-hidden />
              {t.ready}
            </ReviewBadge>
          )
        )}
        {!!review.availableActions.length && (
          <label className="ar-label">
            {t.privateNote}
            <textarea
              data-testid="review-private-note"
              rows={4}
              maxLength={2000}
              className="ar-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.privatePlaceholder}
            />
            <small>{t.privateHint}</small>
          </label>
        )}
        {!review.availableActions.length && <p className="ar-muted">{t.noActions}</p>}
        {review.availableActions.map((action) => (
          <button
            key={action}
            type="button"
            data-testid={action === 'approve' ? 'review-approve' : 'review-request-changes'}
            className={`ar-button${action === 'approve' ? ' ar-button-primary' : ''}`}
            disabled={readOnly || mutation.isPending || !review.submission}
            onClick={(event) => {
              if (!review.submission) return;
              openerRef.current = event.currentTarget;
              setSelection({
                action,
                revision: review.revision,
                submissionId: review.submission.id,
              });
              setError(null);
              setInvalid(false);
              setAccepted(false);
              setSuccess(false);
            }}
          >
            {action === 'approve' ? (
              <>
                <Check size={18} aria-hidden />
                {t.approve}
              </>
            ) : (
              <>
                <Send size={17} aria-hidden />
                {t.requestChanges}
              </>
            )}
          </button>
        ))}
      </section>
      <section className="ar-card ar-stack">
        <h2 className="ar-heading">{t.capabilities}</h2>
        <p className="ar-muted">{t.capabilityHint}</p>
        <ul className="ar-list">
          {review.capabilities.capabilities
            .filter((entry) => capabilityLabels[entry.capability])
            .map((entry) => (
              <li key={entry.capability} className="ar-capability">
                <span>{capabilityLabels[entry.capability]}</span>
                <ReviewBadge tone={entry.allowed ? 'success' : 'neutral'}>
                  {entry.allowed ? t.allowedCapability : t.deniedCapability}
                </ReviewBadge>
              </li>
            ))}
        </ul>
      </section>
      <ReviewDialog
        open={!!selection}
        onClose={() => {
          if (!mutation.isPending) setSelection(null);
        }}
        title={selection?.action === 'approve' ? t.confirmApproval : t.confirmChanges}
        description={selection?.action === 'approve' ? t.confirmApprovalHint : t.confirmChangesHint}
        openerRef={openerRef}
      >
        {readOnly && <ReviewBanner tone="warning" role="status">{pausedMessage}</ReviewBanner>}
        {selection?.action === 'approve' ? (
          <label className="ar-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => {
                setAccepted(event.target.checked);
                setInvalid(false);
              }}
              data-testid="review-approval-ack"
            />
            <span>
              {lang === 'ar'
                ? 'راجعت بيانات الطلب ووثائق الهوية والخدمات المطلوبة.'
                : 'I reviewed the application, identity evidence and requested services.'}
            </span>
          </label>
        ) : (
          <div className="ar-stack">
            <p className="ar-muted">{t.requestChangesSummary}</p>
            {corrections.map((item, index) => (
              <fieldset className="ar-correction ar-stack" key={index}>
                <legend>
                  {lang === 'ar' ? `التعديل ${index + 1}` : `Correction ${index + 1}`}
                </legend>
                <label className="ar-label">
                  {t.task}
                  <select
                    data-testid={`review-correction-task-${index}`}
                    className="ar-input"
                    value={item.taskId}
                    onChange={(event) =>
                      updateCorrection(index, {
                        taskId: event.target.value as AdminProviderReviewFeedbackInput['taskId'],
                        field: undefined,
                        itemId: undefined,
                      })
                    }
                  >
                    {WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.map((task) => (
                      <option value={task} key={task}>
                        {TASK_LABELS[lang][task]}
                      </option>
                    ))}
                  </select>
                </label>
                {
                  <label className="ar-label">
                    {lang === 'ar' ? 'البيانات المطلوب تعديلها' : 'Information to update'}
                    <select
                      className="ar-input"
                      data-testid={`review-correction-field-${index}`}
                      value={item.field ?? ''}
                      onChange={(event) =>
                        updateCorrection(index, {
                          field: event.target.value || undefined,
                          itemId: undefined,
                        })
                      }
                    >
                      <option value="">{reviewCorrectionFieldLabel(undefined, lang)}</option>
                      {WEB_PROVIDER_REVIEW_CORRECTION_FIELDS[item.taskId].map((field) => (
                        <option key={field} value={field}>
                          {reviewCorrectionFieldLabel(field, lang)}
                        </option>
                      ))}
                    </select>
                  </label>
                }
                {targetItems(item).length > 0 && (
                  <label className="ar-label">
                    {lang === 'ar' ? 'العنصر المقصود' : 'Specific item'}
                    <select
                      className="ar-input"
                      data-testid={`review-correction-item-${index}`}
                      value={item.itemId ?? ''}
                      onChange={(event) =>
                        updateCorrection(index, { itemId: event.target.value || undefined })
                      }
                    >
                      <option value="">
                        {lang === 'ar' ? 'كل العناصر في هذا الحقل' : 'All items in this field'}
                      </option>
                      {targetItems(item).map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="ar-label">
                  {t.reason}
                  <select
                    className="ar-input"
                    value={item.reasonCode}
                    onChange={(event) =>
                      updateCorrection(index, { reasonCode: event.target.value })
                    }
                  >
                    {reasonOptions.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ar-label">
                  {t.providerMessage}
                  <textarea
                    data-testid={`review-correction-message-${index}`}
                    className="ar-input"
                    rows={3}
                    maxLength={2000}
                    required
                    aria-invalid={invalid && !item.providerMessage.trim()}
                    value={item.providerMessage}
                    onChange={(event) =>
                      updateCorrection(index, { providerMessage: event.target.value })
                    }
                    placeholder={t.messagePlaceholder}
                  />
                  <small>{t.messageHint}</small>
                </label>
                {corrections.length > 1 && (
                  <button
                    className="ar-button"
                    type="button"
                    onClick={() => setCorrections((items) => items.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={16} aria-hidden />
                    {t.remove}
                  </button>
                )}
              </fieldset>
            ))}
            <button
              className="ar-button"
              type="button"
              disabled={corrections.length >= 20}
              onClick={() => setCorrections((items) => [...items, blankCorrection()])}
            >
              <Plus size={17} aria-hidden />
              {t.addCorrection}
            </button>
          </div>
        )}
        {note.trim() && (
          <div className="ar-private-preview">
            <strong>{t.privateNote}</strong>
            <p>{note}</p>
            <small className="ar-muted">{t.privateHint}</small>
          </div>
        )}
        {invalid && (
          <ReviewBanner tone="danger" role="alert">
            {selection?.action === 'approve'
              ? lang === 'ar'
                ? 'أكد أنك راجعت المعلومات قبل الموافقة.'
                : 'Confirm you have reviewed the information before approving.'
              : t.messageRequired}
          </ReviewBanner>
        )}
        {error && (
          <div data-testid={error === 409 ? 'review-conflict' : 'review-command-error'}>
            <ReviewBanner tone="danger" role="alert">
              {error === 409 ? t.conflict : error === 403 ? t.noActions : t.mutationFailed}
            </ReviewBanner>
          </div>
        )}
        <div className="ar-actions">
          {error === 409 ? (
            <button
              className="ar-button"
              type="button"
              data-testid="review-conflict-refresh"
              onClick={async () => {
                try {
                  await onChanged();
                  setSelection(null);
                  setError(null);
                } catch {
                  /* Keep the conflict and unsent input until refresh succeeds. */
                }
              }}
            >
              {t.refresh}
            </button>
          ) : (
            <button
              className="ar-button ar-button-primary"
              type="button"
              data-testid="review-confirm"
              disabled={readOnly || mutation.isPending || error === 403}
              onClick={() => void confirm()}
            >
              {mutation.isPending ? t.saving : t.confirm}
            </button>
          )}
          <button
            className="ar-button"
            type="button"
            disabled={mutation.isPending}
            onClick={() => setSelection(null)}
          >
            {t.cancel}
          </button>
        </div>
      </ReviewDialog>
    </aside>
  );
}
