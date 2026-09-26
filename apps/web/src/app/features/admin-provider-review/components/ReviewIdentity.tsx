import type { ComponentProps } from 'react';
import { ReviewIdentity as IdentityReviewContent } from './IdentityReviewContent';
import { ReviewEvidenceCorrection } from './ReviewEvidenceCorrection';

/** Keep protected inspection and case decisions separate from provider-visible correction messages. */
export function ReviewIdentity(props: ComponentProps<typeof IdentityReviewContent>) {
  return (
    <div className="ar-stack">
      <IdentityReviewContent {...props} />
      {!props.review.verification && (
        <p className="ar-muted">
          {props.lang === 'ar'
            ? 'يبدأ رفع الهوية من حساب المهني. يمكنك طلبها برسالة أدناه؛ لا تُمنح الموافقة قبل وصول الوثائق وفحصها.'
            : 'Identity upload starts in the provider account. Request it with a message below; approval still requires submitted, checked evidence.'}
        </p>
      )}
      <ReviewEvidenceCorrection key={`${props.review.provider.id}:${props.review.submission?.id}`} {...props} kind="identity" />
    </div>
  );
}
