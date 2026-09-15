import type {
  PublishVerificationPolicyRequest,
  VerificationPolicyOptionsResponse,
  VerificationPolicySummary,
} from '@homeservicemarketplace/contracts';
import { DOCUMENT_KIND_LABELS } from '../copy/verification-copy';
import { ReviewBadge, ReviewField } from '../../admin-provider-review/components/ReviewPrimitives';
import { formatReviewDate } from '../../admin-provider-review/format-review-date';
import { POLICY_COPY, policyCountryName, type PolicyLanguage } from './policy-copy';

export function PolicyScope({
  policy,
  options,
  lang,
}: {
  policy: PublishVerificationPolicyRequest;
  options?: VerificationPolicyOptionsResponse;
  lang: PolicyLanguage;
}) {
  const t = POLICY_COPY[lang];
  const category = options?.categories.find((item) => item.id === policy.categoryId);
  return (
    <dl className="ar-fields">
      <ReviewField label={t.country}>{policyCountryName(policy.country ?? null, lang)}</ReviewField>
      <ReviewField label={t.providerType}>
        {policy.providerType ? t[policy.providerType] : t.allTypes}
      </ReviewField>
      <ReviewField label={t.category}>
        {policy.categoryId
          ? category
            ? lang === 'ar'
              ? category.labelAr
              : category.labelEn
            : t.unknownCategory
          : t.allCategories}
      </ReviewField>
      <ReviewField label={t.documents}>
        {policy.requirements.verificationRequired
          ? policy.requirements.documents
              .map((kind) => DOCUMENT_KIND_LABELS[lang][kind])
              .join(lang === 'ar' ? '، ' : ', ')
          : t.verificationOptional}
      </ReviewField>
    </dl>
  );
}

export function PolicyVersionCard({
  policy,
  options,
  lang,
  pending,
  onRetire,
}: {
  policy: VerificationPolicySummary;
  options?: VerificationPolicyOptionsResponse;
  lang: PolicyLanguage;
  pending: boolean;
  onRetire: () => void;
}) {
  const t = POLICY_COPY[lang];
  return (
    <article className="ar-card ar-stack" data-testid={`policy-row-${policy.version}`}>
      <header className="ar-subheader">
        <h3 className="ar-subheading ar-wrap">
          <bdi dir="ltr">{policy.version}</bdi>
        </h3>
        <span data-testid={`policy-live-${policy.version}`} data-live={String(policy.isLive)}>
          <ReviewBadge tone={policy.isLive ? 'success' : 'neutral'}>{t[policy.state]}</ReviewBadge>
        </span>
      </header>
      <PolicyScope policy={policy} options={options} lang={lang} />
      <div className="ar-divider" />
      <div className="ar-subheader">
        <div className="ar-stack ap-dates">
          <p className="ar-muted">
            {t.published}:{' '}
            <time dateTime={policy.publishedAt}>
              {formatReviewDate(policy.publishedAt, lang, '—')}
            </time>
          </p>
          {policy.retiredAt && (
            <p className="ar-muted">
              {t.retired}:{' '}
              <time dateTime={policy.retiredAt}>
                {formatReviewDate(policy.retiredAt, lang, '—')}
              </time>
            </p>
          )}
        </div>
        {policy.isLive && (
          <button
            type="button"
            className="ar-button"
            data-testid={`policy-retire-${policy.version}`}
            onClick={onRetire}
            disabled={pending}
          >
            {t.stop}
          </button>
        )}
      </div>
    </article>
  );
}
