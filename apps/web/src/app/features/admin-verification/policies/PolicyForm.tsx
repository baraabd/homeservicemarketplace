import { useState } from 'react';
import type {
  PublishVerificationPolicyRequest,
  VerificationDocumentKindCode,
  VerificationPolicyOptionsResponse,
} from '@homeservicemarketplace/contracts';
import { DOCUMENT_KIND_LABELS } from '../copy/verification-copy';
import { POLICY_COPY, policyCountryName, type PolicyLanguage } from './policy-copy';

const DOCUMENT_KINDS: VerificationDocumentKindCode[] = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_REGISTRATION',
  'AUTHORIZED_REPRESENTATIVE_IDENTITY',
  'CATEGORY_LICENSE',
];

export function PolicyForm({
  draft,
  onChange,
  onReview,
  onCancel,
  options,
  lang,
  pending,
}: {
  draft: PublishVerificationPolicyRequest;
  onChange: (draft: PublishVerificationPolicyRequest) => void;
  onReview: () => void;
  onCancel: () => void;
  options: VerificationPolicyOptionsResponse;
  lang: PolicyLanguage;
  pending: boolean;
}) {
  const t = POLICY_COPY[lang];
  const [errors, setErrors] = useState<{
    version?: boolean;
    category?: boolean;
    documents?: boolean;
  }>({});
  return (
    <form
      className="ar-card ar-stack"
      data-testid="policy-publish-form"
      aria-labelledby="policy-form-title"
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          version: !draft.version.trim(),
          category: draft.requirements.documents.includes('CATEGORY_LICENSE') && !draft.categoryId,
          documents: draft.requirements.documents.length === 0,
        };
        setErrors(next);
        if (next.version || next.category || next.documents) {
          document
            .getElementById(
              next.version
                ? 'policy-version'
                : next.category
                  ? 'policy-category'
                  : 'policy-documents',
            )
            ?.focus();
          return;
        }
        onReview();
      }}
    >
      <div>
        <h2 className="ar-heading" id="policy-form-title">
          {t.formTitle}
        </h2>
        <p className="ar-muted">{t.formDescription}</p>
      </div>
      <label className="ar-label" htmlFor="policy-version">
        {t.version}
        <input
          id="policy-version"
          data-testid="policy-version"
          className="ar-input"
          dir="ltr"
          maxLength={64}
          value={draft.version}
          disabled={pending}
          onChange={(event) => onChange({ ...draft, version: event.target.value })}
          aria-invalid={!!errors.version}
          aria-describedby={errors.version ? 'policy-version-error' : 'policy-version-hint'}
          placeholder="2026.09-sy-v1"
        />
        <small id="policy-version-hint">{t.versionHint}</small>
        {errors.version && (
          <span role="alert" id="policy-version-error" className="ap-error">
            {t.versionRequired}
          </span>
        )}
      </label>
      <div className="ar-fields">
        <label className="ar-label" htmlFor="policy-country">
          {t.country}
          <select
            id="policy-country"
            data-testid="policy-country"
            className="ar-input"
            value={draft.country ?? ''}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, country: event.target.value || null })}
          >
            <option value="">{t.allCountries}</option>
            {options.countries.map((country) => (
              <option key={country.countryCode} value={country.countryCode}>
                {policyCountryName(country.countryCode, lang)}
                {country.enabled ? '' : ` · ${t.disabledMarket}`}
              </option>
            ))}
          </select>
        </label>
        <label className="ar-label" htmlFor="policy-provider-type">
          {t.providerType}
          <select
            id="policy-provider-type"
            data-testid="policy-provider-type"
            className="ar-input"
            value={draft.providerType ?? ''}
            disabled={pending}
            onChange={(event) =>
              onChange({
                ...draft,
                providerType: (event.target.value as 'INDIVIDUAL' | 'BUSINESS') || null,
              })
            }
          >
            <option value="">{t.allTypes}</option>
            <option value="INDIVIDUAL">{t.INDIVIDUAL}</option>
            <option value="BUSINESS">{t.BUSINESS}</option>
          </select>
        </label>
      </div>
      <label className="ar-label" htmlFor="policy-category">
        {t.category}
        <select
          id="policy-category"
          data-testid="policy-category"
          className="ar-input"
          value={draft.categoryId ?? ''}
          disabled={pending}
          onChange={(event) => {
            const categoryId = event.target.value || null;
            onChange({
              ...draft,
              categoryId,
              requirements: {
                verificationRequired: true,
                documents: categoryId ? ['CATEGORY_LICENSE'] : ['INDIVIDUAL_IDENTITY'],
              },
            });
          }}
          aria-invalid={!!errors.category}
          aria-describedby={errors.category ? 'policy-category-error' : 'policy-category-hint'}
        >
          <option value="">{t.allCategories}</option>
          {options.categories
            .filter((category) => category.selectable)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {lang === 'ar' ? category.labelAr : category.labelEn}
              </option>
            ))}
        </select>
        <small id="policy-category-hint">{t.categoryHint}</small>
        {errors.category && (
          <span role="alert" id="policy-category-error" className="ap-error">
            {t.categoryRequired}
          </span>
        )}
      </label>
      <fieldset
        id="policy-documents"
        tabIndex={-1}
        className="ar-correction"
        disabled={pending}
        aria-describedby={errors.documents ? 'policy-documents-error' : undefined}
      >
        <legend>{t.documents}</legend>
        <div className="ar-fields">
          {(draft.categoryId
            ? DOCUMENT_KINDS.filter((kind) => kind === 'CATEGORY_LICENSE')
            : DOCUMENT_KINDS
          ).map((kind) => (
            <label className="ar-check" key={kind}>
              <input
                type="checkbox"
                data-testid={`policy-kind-${kind}`}
                checked={draft.requirements.documents.includes(kind)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    requirements: {
                      ...draft.requirements,
                      documents: event.target.checked
                        ? [...draft.requirements.documents, kind]
                        : draft.requirements.documents.filter((value) => value !== kind),
                    },
                  })
                }
              />
              <span>{DOCUMENT_KIND_LABELS[lang][kind]}</span>
            </label>
          ))}
        </div>
        {errors.documents && (
          <p role="alert" id="policy-documents-error" className="ap-error">
            {t.documentsRequired}
          </p>
        )}
      </fieldset>
      <div className="ar-actions">
        <button
          type="submit"
          className="ar-button ar-button-primary"
          data-testid="policy-publish"
          disabled={pending}
        >
          {t.review}
        </button>
        <button type="button" className="ar-button" onClick={onCancel} disabled={pending}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
