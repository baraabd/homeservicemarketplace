import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { requestProviderReviewChanges, requestStatus } from '../api';
import type { ReviewLanguage } from '../copy';
import { ReviewDialog } from './ReviewDialog';
import { ReviewBanner } from './ReviewPrimitives';

const COPY = {
  en: {
    identity: 'Request identity photo with a message',
    portfolio: 'Request replacement with a message',
    hint: 'This returns the application for correction. It does not approve, reject or publish an image. The provider receives the message below and can resubmit.',
    label: 'Message to the provider',
    help: 'Describe the replacement needed. Do not include document numbers or private reviewer notes.',
    send: 'Send correction request', saving: 'Sending…', cancel: 'Cancel',
    required: 'Write a message for the provider.',
    stale: 'The application changed or is unavailable. Your message has been kept. Close this dialog, refresh the application and review it again before sending.',
    failed: 'The request could not be confirmed. Your message has been kept; retry when the connection is restored.',
    sent: 'Correction request recorded. The provider can read your message and resubmit.',
    refresh: 'The request was recorded, but the application could not be refreshed. Refresh the page; do not send a second request.',
  },
  ar: {
    identity: 'طلب صورة هوية برسالة للمهني',
    portfolio: 'طلب صورة بديلة برسالة للمهني',
    hint: 'يُعاد الطلب للتصحيح دون قبول صورة أو رفضها أو نشرها. تصل الرسالة أدناه إلى المهني ليتمكن من التصحيح وإعادة الإرسال.',
    label: 'رسالة إلى المهني',
    help: 'وضح الصورة البديلة المطلوبة دون كتابة أرقام الوثائق أو ملاحظات المراجعة الداخلية.',
    send: 'إرسال طلب التصحيح', saving: 'جارٍ الإرسال…', cancel: 'إلغاء',
    required: 'اكتب رسالة توضح المطلوب من المهني.',
    stale: 'تغيّر الطلب أو تعذر الوصول إليه. احتفظنا برسالتك. أغلق النافذة وحدّث الطلب وراجعه مجددًا قبل الإرسال.',
    failed: 'تعذر تأكيد الإرسال. احتفظنا برسالتك؛ أعد المحاولة بعد عودة الاتصال.',
    sent: 'تم تسجيل طلب التصحيح. يستطيع المهني قراءة الرسالة والتصحيح وإعادة الإرسال.',
    refresh: 'تم تسجيل الطلب لكن تعذر تحديث الصفحة. حدّثها دون إرسال طلب ثانٍ.',
  },
} as const;

/** Uses the existing atomic return/feedback/notification workflow, not a second decision API. */
export function ReviewEvidenceCorrection({
  review, lang, onChanged, readOnly = false, kind, itemId,
}: {
  review: AdminProviderReview;
  lang: ReviewLanguage;
  onChanged: () => Promise<unknown>;
  readOnly?: boolean;
  kind: 'identity' | 'portfolio';
  itemId?: string;
}) {
  const t = COPY[lang];
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [selection, setSelection] = useState<{
    providerId: string; submissionId: string; revision: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [result, setResult] = useState<'sent' | 'refresh' | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: requestProviderReviewChanges.bind(null, review.provider.id),
  });
  const allowed = !!review.submission && review.permissions.canDecide &&
    review.availableActions.includes('requestChanges');
  const current = !!selection && allowed &&
    selection.providerId === review.provider.id &&
    selection.submissionId === review.submission?.id &&
    selection.revision === review.revision;

  async function send() {
    if (!selection || !current || readOnly || result || mutation.isPending || error === 403 || error === 409) return;
    const providerMessage = message.trim();
    if (!providerMessage || providerMessage.length > 2000) { setInvalid(true); return; }
    const feedback = [{
      taskId: kind === 'identity' ? 'BASICS_IDENTITY' as const : 'PORTFOLIO' as const,
      field: kind === 'identity' ? 'identityDocument' : 'portfolio',
      ...(itemId ? { itemId } : {}),
      reasonCode: 'INFORMATION_UNCLEAR',
      providerMessage,
    }];
    const signature = JSON.stringify({ ...selection, feedback });
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID() };
    }
    try {
      await mutation.mutateAsync({
        submissionId: selection.submissionId,
        expectedRevision: selection.revision,
        idempotencyKey: attempt.current.key,
        feedback,
      });
    } catch (failure) {
      setError(requestStatus(failure) ?? 500);
      return;
    }
    // A refresh error must not turn an acknowledged command into a retryable failure.
    setSelection(null);
    setMessage('');
    setError(null);
    setResult('sent');
    attempt.current = null;
    try { await onChanged(); } catch { setResult('refresh'); }
  }

  return (
    <div className="ar-stack">
      {result && <ReviewBanner role="status" tone={result === 'sent' ? 'success' : 'warning'}>{t[result]}</ReviewBanner>}
      {allowed && (
        <button
          className="ar-button" type="button"
          data-testid={`review-${kind}-request-replacement${itemId ? `-${itemId}` : ''}`}
          disabled={readOnly || mutation.isPending || result !== null}
          onClick={(event) => {
            if (readOnly || result || !review.submission) return;
            openerRef.current = event.currentTarget;
            setSelection({ providerId: review.provider.id, submissionId: review.submission.id, revision: review.revision });
            setError(null); setInvalid(false); setResult(null);
          }}
        >{t[kind]}</button>
      )}
      <ReviewDialog
        open={!!selection}
        onClose={() => { if (!mutation.isPending) setSelection(null); }}
        title={t[kind]} description={t.hint} openerRef={openerRef}
      >
        <label className="ar-label">
          {t.label}
          <textarea
            className="ar-input" rows={4} maxLength={2000} required
            value={message} aria-invalid={invalid}
            onChange={(event) => { setMessage(event.target.value); setInvalid(false); }}
          />
          <small>{t.help}</small>
        </label>
        {invalid && <ReviewBanner role="alert" tone="danger">{t.required}</ReviewBanner>}
        {(readOnly || !current || error === 403 || error === 409) && <ReviewBanner role="alert" tone="warning">{t.stale}</ReviewBanner>}
        {error && error !== 403 && error !== 409 && <ReviewBanner role="alert" tone="danger">{t.failed}</ReviewBanner>}
        <div className="ar-actions">
          <button className="ar-button ar-button-primary" type="button"
            data-testid="review-evidence-correction-send"
            disabled={readOnly || !current || mutation.isPending || error === 403 || error === 409}
            onClick={() => void send()}>{mutation.isPending ? t.saving : t.send}</button>
          <button className="ar-button" type="button" disabled={mutation.isPending}
            onClick={() => setSelection(null)}>{t.cancel}</button>
        </div>
      </ReviewDialog>
    </div>
  );
}
