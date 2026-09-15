import { useRef, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import type {
  PublishVerificationPolicyRequest,
  VerificationPolicySummary,
} from '@homeservicemarketplace/contracts';
import { useLang } from '../../../i18n/LanguageContext';
import { ReviewBanner } from '../../admin-provider-review/components/ReviewPrimitives';
import { ReviewDialog } from '../../admin-provider-review/components/ReviewDialog';
import { POLICY_COPY, policyErrorMessage } from '../policies/policy-copy';
import { usePolicySettings } from '../policies/usePolicySettings';
import { PolicyForm } from '../policies/PolicyForm';
import { initialPolicyDraft } from '../policies/policy-draft';
import { PolicyScope, PolicyVersionCard } from '../policies/PolicyScope';
import '../../admin-provider-review/admin-review.css';
import '../policies/policy-settings.css';

type Confirmation =
  | { kind: 'publish'; policy: PublishVerificationPolicyRequest }
  | { kind: 'retire'; policy: VerificationPolicySummary };

/** Global requirements belong to restricted settings, separate from individual review decisions. */
export function VerificationPolicyPanel() {
  const { lang, dir, darkMode } = useLang();
  const t = POLICY_COPY[lang];
  const { query, options, publish, retire } = usePolicySettings();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(initialPolicyDraft);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [success, setSuccess] = useState<'publish' | 'retire' | null>(null);
  const pending = publish.isPending || retire.isPending;
  const mutationError = confirmation?.kind === 'publish' ? publish.error : retire.error;
  const forbidden = (query.error as { response?: { status?: number } })?.response?.status === 403;

  const closeConfirmation = () => {
    if (!pending) setConfirmation(null);
  };
  const openConfirmation = (next: Confirmation) => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLButtonElement ? active : null;
    setConfirmation(next);
  };
  const resetMutation = () => {
    publish.reset();
    retire.reset();
    setSuccess(null);
  };
  const execute = () => {
    if (!confirmation || pending) return;
    const kind = confirmation.kind;
    const completed = () => {
      setSuccess(kind);
      setConfirmation(null);
      if (kind === 'publish') {
        setDraft(initialPolicyDraft());
        setShowForm(false);
      }
    };
    if (kind === 'publish') publish.mutate(confirmation.policy, { onSuccess: completed });
    else retire.mutate(confirmation.policy.version, { onSuccess: completed });
  };

  return (
    <section
      aria-label={t.title}
      dir={dir}
      lang={lang}
      data-testid="policy-panel"
      className={`admin-review ap-settings ar-stack${darkMode ? ' dark' : ''}`}
    >
      <header className="ar-header">
        <div className="ar-stack">
          <span className="ar-eyebrow">{t.eyebrow}</span>
          <h1 className="ar-title">{t.title}</h1>
          <p className="ar-muted">{t.description}</p>
        </div>
        {query.isSuccess && !showForm && (
          <button
            type="button"
            data-testid="policy-new-version"
            className="ar-button ar-button-primary"
            disabled={!options.isSuccess || pending}
            onClick={() => {
              setShowForm(true);
              setSuccess(null);
            }}
          >
            <Plus size={18} aria-hidden />
            {t.newVersion}
          </button>
        )}
      </header>
      {forbidden ? (
        <div className="ar-card ar-stack" data-testid="policy-forbidden">
          <ShieldCheck size={28} aria-hidden />
          <h2 className="ar-heading">{t.forbiddenTitle}</h2>
          <ReviewBanner tone="warning" role="alert">
            {t.forbiddenBody}
          </ReviewBanner>
        </div>
      ) : query.isError ? (
        <ReviewBanner tone="danger" role="alert">
          <p>{t.loadFailed}</p>
          <button className="ar-button" type="button" onClick={() => void query.refetch()}>
            {t.retry}
          </button>
        </ReviewBanner>
      ) : query.isPending ? (
        <p role="status" aria-busy="true" data-testid="policy-loading">
          {t.loading}
        </p>
      ) : (
        <>
          <ReviewBanner>{t.appendOnly}</ReviewBanner>
          {success && (
            <ReviewBanner tone="success" role="status">
              {success === 'publish' ? t.publishedSuccess : t.stoppedSuccess}
            </ReviewBanner>
          )}
          {options.isError && (
            <ReviewBanner tone="danger" role="alert">
              <p>{t.optionsFailed}</p>
              <button type="button" className="ar-button" onClick={() => void options.refetch()}>
                {t.retry}
              </button>
            </ReviewBanner>
          )}
          {showForm && options.data && (
            <PolicyForm
              draft={draft}
              onChange={setDraft}
              lang={lang}
              options={options.data}
              pending={pending}
              onCancel={() => setShowForm(false)}
              onReview={() => {
                resetMutation();
                openConfirmation({
                  kind: 'publish',
                  policy: { ...draft, version: draft.version.trim() },
                });
              }}
            />
          )}
          <div className="ar-subheader">
            <h2 className="ar-heading">{t.history}</h2>
            <span className="ar-muted">{query.data.policies.length.toLocaleString(lang)}</span>
          </div>
          {query.data.policies.length === 0 ? (
            <p className="ar-card ar-muted" data-testid="policy-empty">
              {t.empty}
            </p>
          ) : (
            <div className="ap-policy-grid" data-testid="policy-versions">
              {query.data.policies.map((policy) => (
                <PolicyVersionCard
                  key={policy.version}
                  policy={policy}
                  options={options.data}
                  lang={lang}
                  pending={pending}
                  onRetire={() => {
                    resetMutation();
                    openConfirmation({ kind: 'retire', policy });
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
      <ReviewDialog
        openerRef={openerRef}
        open={confirmation !== null}
        onClose={closeConfirmation}
        title={confirmation?.kind === 'retire' ? t.confirmStop : t.confirmPublish}
        description={confirmation?.kind === 'retire' ? t.stopImpact : t.publishImpact}
      >
        {confirmation && (
          <>
            <p className="ar-wrap">
              <bdi dir="ltr">{confirmation.policy.version}</bdi>
            </p>
            <div className="ap-form-scope">
              <PolicyScope policy={confirmation.policy} options={options.data} lang={lang} />
            </div>
            {mutationError && (
              <ReviewBanner tone="danger" role="alert">
                <p data-testid="policy-error">{policyErrorMessage(mutationError, lang)}</p>
              </ReviewBanner>
            )}
            <div className="ar-actions">
              <button
                type="button"
                data-testid="policy-confirm"
                className={`ar-button ${confirmation.kind === 'retire' ? 'ar-button-danger' : 'ar-button-primary'}`}
                disabled={pending}
                onClick={execute}
              >
                {pending
                  ? confirmation.kind === 'retire'
                    ? t.stopping
                    : t.publishing
                  : confirmation.kind === 'retire'
                    ? t.stop
                    : t.publish}
              </button>
              <button
                type="button"
                className="ar-button"
                disabled={pending}
                onClick={closeConfirmation}
              >
                {t.cancel}
              </button>
            </div>
          </>
        )}
      </ReviewDialog>
    </section>
  );
}
