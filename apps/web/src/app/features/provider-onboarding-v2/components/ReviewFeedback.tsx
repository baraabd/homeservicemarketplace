import { TriangleAlert } from 'lucide-react';
import type { ProviderOnboardingFeedback } from '@homeservicemarketplace/contracts';

import { ProviderButton } from '../../provider-ui';
import { LIFECYCLE_COPY, type Lang } from '../copy/onboarding-hub-copy';
import { REVIEW_FEEDBACK_COPY } from '../copy/review-feedback-copy';
import { OnboardingAlert } from './OnboardingAlert';
import { feedbackTaskPath } from '../feedback-task-path';
import { reviewCorrectionFieldLabel } from '../copy/review-correction-fields';

export function ReviewFeedback({
  feedback,
  lang,
  taskId,
  onOpen,
  onResubmit,
}: {
  feedback: ProviderOnboardingFeedback | null | undefined;
  lang: Lang;
  taskId?: string;
  onOpen?: (path: string) => void;
  onResubmit?: () => void;
}) {
  const items = feedback?.items.filter((item) => !taskId || item.taskId === taskId) ?? [];
  if (items.length === 0) return null;
  const copy = REVIEW_FEEDBACK_COPY[lang];
  return (
    <section className="flex flex-col gap-4" aria-label={copy.title} data-testid="review-feedback">
      <h2 className="text-pv-input font-semibold text-pv-text">{copy.title}</h2>
      <ul className="flex list-none flex-col gap-4 p-0">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2">
            <OnboardingAlert
              tone="warning"
              icon={TriangleAlert}
              title={LIFECYCLE_COPY[lang].returnedTaskLabel[item.taskId] ?? copy.title}
              body={
                <div className="flex flex-col gap-1">
                  {item.field && <strong>{reviewCorrectionFieldLabel(item.field, lang)}</strong>}
                  <bdi className="whitespace-pre-wrap">{item.providerMessage}</bdi>
                </div>
              }
              density="compact"
            />
            {onOpen &&
            (!taskId || !!item.field || feedbackTaskPath(item) === '/provider/verification') ? (
              <ProviderButton
                tone="secondary"
                shape="onboarding"
                size="block"
                onClick={() => onOpen(feedbackTaskPath(item))}
              >
                {copy.open}: {LIFECYCLE_COPY[lang].returnedTaskLabel[item.taskId]}
              </ProviderButton>
            ) : null}
            {onOpen &&
            item.taskId === 'BASICS_IDENTITY' &&
            feedbackTaskPath(item) !== '/provider/verification' ? (
              <ProviderButton
                tone="secondary"
                shape="onboarding"
                size="block"
                onClick={() => onOpen('/provider/verification')}
              >
                {copy.viewVerification}
              </ProviderButton>
            ) : null}
          </li>
        ))}
      </ul>
      {onResubmit ? (
        <ProviderButton tone="primary" shape="onboarding" size="block" onClick={onResubmit}>
          {copy.submit}
        </ProviderButton>
      ) : null}
    </section>
  );
}
