import { useRef, useState } from 'react';
import {
  useAdminProviderDetail,
  useAdminProviderDecision,
  useUpdateAdminProviderReviewNotes,
} from '../../../hooks/admin/useAdminProviders';
import { ReviewBanner, ReviewSection } from './ReviewPrimitives';
import { ReviewDialog } from './ReviewDialog';
import type { ReviewLanguage } from '../copy';

/** Account conduct controls remain distinct from submitted-application approval. */
export function ReviewAccountActions({
  providerProfileId,
  lang,
  onChanged,
}: {
  providerProfileId: string;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
}) {
  const isAr = lang === 'ar';
  const detail = useAdminProviderDetail(providerProfileId);
  const decision = useAdminProviderDecision();
  const notes = useUpdateAdminProviderReviewNotes();
  const [action, setAction] = useState<'suspend' | 'reactivate' | null>(null);
  const [reason, setReason] = useState('');
  const [editedNotes, setEditedNotes] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const draft = editedNotes ?? detail.data?.reviewNotes ?? '';
  const actions = detail.isError ? [] : (detail.data?.availableActions ?? []);
  const suspendLabel = isAr ? 'تعليق المهني' : 'Suspend provider';
  const reactivateLabel = isAr ? 'رفع تعليق المهني' : 'Reactivate provider';
  async function reload() {
    const result = await detail.refetch();
    if (result.isError) throw result.error;
    await onChanged();
    setRefreshFailed(false);
  }
  async function confirm() {
    if (!action || !actions.includes(action)) return;
    try {
      await decision.mutateAsync({ providerProfileId, action, reason: reason.trim() || null });
      setAction(null);
      setReason('');
      setNotice(isAr ? 'تم حفظ قرار حالة المهني.' : 'Provider status decision saved.');
      await reload().catch(() => setRefreshFailed(true));
    } catch {
      // The mutation error is rendered below; the entered reason remains available.
    }
  }
  async function saveNotes() {
    const submitted = draft;
    try {
      await notes.mutateAsync({ providerProfileId, notes: submitted });
      const result = await detail.refetch();
      if (result.isError) setRefreshFailed(true);
      else setEditedNotes((current) => (current === submitted ? null : current));
      setNotice(isAr ? 'تم حفظ الملاحظات الداخلية.' : 'Internal notes saved.');
    } catch {
      // Retain the author's text so a failed save never loses work.
    }
  }
  return (
    <ReviewSection
      id="review-account-controls"
      title={isAr ? 'إدارة حالة المهني' : 'Provider status controls'}
    >
      <div className="ar-stack">
        <p className="ar-muted">
          {isAr
            ? 'التعليق ورفعه يخصان حالة المهني. حالة حساب المستخدم تُدار من إدارة المستخدمين، والسماح بالعمل يعتمد على جميع المتطلبات.'
            : 'Suspension and reactivation concern the provider profile. The user account is managed under User Control; work access depends on all requirements.'}
        </p>
        {notice && (
          <ReviewBanner role="status" tone="success">
            {notice}
          </ReviewBanner>
        )}
        {(detail.isError || refreshFailed) && (
          <ReviewBanner role="alert" tone="warning">
            {isAr
              ? 'تعذر تحديث حالة الحساب. أعد التحميل لرؤية أحدث نتيجة.'
              : 'Could not refresh account state. Reload to see the latest result.'}
            <div>
              <button
                type="button"
                className="ar-button"
                onClick={() => void reload().catch(() => setRefreshFailed(true))}
              >
                {isAr ? 'إعادة التحميل' : 'Reload'}
              </button>
            </div>
          </ReviewBanner>
        )}
        {detail.isPending && (
          <p role="status">{isAr ? 'جارٍ تحميل الحساب…' : 'Loading account…'}</p>
        )}
        {detail.data && !detail.isError && (
          <>
            <div className="ar-stack">
              <label htmlFor="review-private-notes">
                {isAr ? 'ملاحظات داخلية' : 'Internal notes'}
              </label>
              <p id="review-private-notes-hint" className="ar-muted">
                {isAr
                  ? 'للمراجعين فقط؛ لا تُرسل إلى المهني.'
                  : 'For reviewers only; never sent to the provider.'}
              </p>
              <textarea
                id="review-private-notes"
                aria-describedby="review-private-notes-hint"
                className="ar-input"
                rows={3}
                maxLength={4000}
                value={draft}
                onChange={(event) => {
                  setEditedNotes(event.target.value);
                  setNotice(null);
                }}
              />
              <div>
                <button
                  type="button"
                  className="ar-button"
                  disabled={notes.isPending || draft === (detail.data.reviewNotes ?? '')}
                  onClick={() => void saveNotes()}
                >
                  {notes.isPending
                    ? isAr
                      ? 'جارٍ الحفظ…'
                      : 'Saving…'
                    : isAr
                      ? 'حفظ الملاحظات'
                      : 'Save notes'}
                </button>
              </div>
              {notes.isError && (
                <ReviewBanner role="alert" tone="danger">
                  {isAr
                    ? 'تعذر حفظ الملاحظات. النص محفوظ في هذه الشاشة؛ حاول مجددًا.'
                    : 'Could not save notes. Your text remains on this screen; try again.'}
                </ReviewBanner>
              )}
            </div>
            <div className="ar-subheader">
              {(['suspend', 'reactivate'] as const)
                .filter((value) => actions.includes(value))
                .map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`ar-button${value === 'suspend' ? ' ar-button-danger' : ''}`}
                    disabled={decision.isPending || refreshFailed}
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      decision.reset();
                      setAction(value);
                      setReason('');
                      setNotice(null);
                    }}
                  >
                    {value === 'suspend' ? suspendLabel : reactivateLabel}
                  </button>
                ))}
            </div>
          </>
        )}
      </div>
      <ReviewDialog
        open={action !== null}
        onClose={() => {
          if (!decision.isPending) setAction(null);
        }}
        openerRef={opener}
        title={action === 'suspend' ? suspendLabel : reactivateLabel}
        description={
          action === 'suspend'
            ? isAr
              ? 'سيمنع هذا القرار المهني من العمل ويُحفظ في سجل المراجعة.'
              : 'This prevents the provider from working and records the decision in review history.'
            : isAr
              ? 'تُرفع حالة التعليق عن المهني. تبقى شروط التوثيق والمنح وبقية متطلبات العمل سارية.'
              : 'The provider profile returns to active. Verification, grants and all other work requirements still apply.'
        }
      >
        <div className="ar-stack">
          {action === 'suspend' && (
            <>
              <label htmlFor="account-decision-reason">
                {isAr ? 'سبب التعليق' : 'Reason for suspension'}
              </label>
              <textarea
                id="account-decision-reason"
                className="ar-input"
                rows={3}
                required
                maxLength={1024}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          )}
          {decision.isError && (
            <ReviewBanner role="alert" tone="danger">
              {isAr
                ? 'تعذر تنفيذ القرار. راجع الحالة والصلاحيات ثم حاول مجددًا.'
                : 'Could not apply the decision. Check current state and permissions, then retry.'}
            </ReviewBanner>
          )}
          <div className="ar-subheader">
            <button
              type="button"
              className="ar-button"
              disabled={decision.isPending}
              onClick={() => setAction(null)}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              className="ar-button ar-button-primary"
              disabled={
                decision.isPending ||
                !action ||
                !actions.includes(action) ||
                (action === 'suspend' && !reason.trim())
              }
              onClick={() => void confirm()}
            >
              {decision.isPending
                ? isAr
                  ? 'جارٍ الحفظ…'
                  : 'Saving…'
                : isAr
                  ? 'تأكيد القرار'
                  : 'Confirm decision'}
            </button>
          </div>
        </div>
      </ReviewDialog>
    </ReviewSection>
  );
}
