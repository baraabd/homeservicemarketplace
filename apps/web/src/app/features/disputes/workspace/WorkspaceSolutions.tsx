import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseBadge, CaseDate, CaseNotice } from '../../case-ui/CasePrimitives';
import { ACTION_LABELS, WORKSPACE_COPY, translatedLabel } from './copy';
import type { CommandSelection } from './command-model';
export function WorkspaceSolutions({
  view,
  lang,
  disabled,
  onAction,
}: {
  view: DisputeWorkspaceView;
  lang: 'en' | 'ar';
  disabled: boolean;
  onAction: (selection: CommandSelection) => void;
}) {
  const t = WORKSPACE_COPY[lang];
  return (
    <section id="case-solutions" className="case-card case-stack cw-section">
      <h2>{t.solutions}</h2>
      <CaseNotice>{t.proposalHint}</CaseNotice>
      {view.proposals.map((p) => (
        <article className="cw-box case-stack" key={p.id}>
          <div className="case-summary">
            <h3>{t.proposal}</h3>
            <CaseBadge>{translatedLabel(t.proposalStates, p.status, t.event)}</CaseBadge>
          </div>
          <p className="case-statement">{p.summary}</p>
          <ol className="cw-items">
            {p.remedies.map((r, i) => (
              <li className="cw-box" key={i}>
                <h3>
                  {(i + 1).toLocaleString(lang)}. {t.remedyTypes[r.type]}
                </h3>
                <p className="case-statement">{r.description}</p>
                {r.conditions && (
                  <p className="case-statement">
                    {t.conditions}: {r.conditions}
                  </p>
                )}
                {r.dueAt && (
                  <p className="cw-meta">
                    {t.date}: <CaseDate value={r.dueAt} lang={lang} />
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="cw-meta">
            {t.validUntil}: <CaseDate value={p.expiresAt} lang={lang} />
          </p>
          <p>
            {t.responses}: {p.acceptedCount.toLocaleString(lang)}/{(2).toLocaleString(lang)}
          </p>
          {p.acceptedByYou !== null && (
            <CaseBadge>{p.acceptedByYou ? t.accepted : t.declined}</CaseBadge>
          )}
          {view.availableActions.includes('CONSENT') &&
            p.status === 'OPEN' &&
            p.acceptedByYou === null &&
            new Date(p.expiresAt) > new Date() && (
              <div className="case-actions">
                <button
                  type="button"
                  className="case-button case-button-primary"
                  disabled={disabled}
                  onClick={() => onAction({ action: 'CONSENT', entityId: p.id, accepted: true })}
                >
                  {t.accept}
                </button>
                <button
                  type="button"
                  className="case-button"
                  disabled={disabled}
                  onClick={() => onAction({ action: 'CONSENT', entityId: p.id, accepted: false })}
                >
                  {t.decline}
                </button>
              </div>
            )}
          {p.status === 'DECIDED' && (
            <p>
              {t.fulfilments}: {p.fulfilledCount.toLocaleString(lang)}/{(2).toLocaleString(lang)}
            </p>
          )}
          {view.availableActions.includes('CONFIRM_FULFILMENT') &&
            view.decisions[0]?.proposalId === p.id &&
            p.acceptedByYou &&
            !p.fulfilledByYou && (
              <button
                type="button"
                className="case-button"
                disabled={disabled}
                onClick={() => onAction({ action: 'CONFIRM_FULFILMENT', entityId: p.id })}
              >
                {ACTION_LABELS[lang].CONFIRM_FULFILMENT}
              </button>
            )}
        </article>
      ))}
      <h3>{t.decision}</h3>
      {!view.decisions.length && <p className="case-muted">{t.noDecisions}</p>}
      {view.decisions.map((d, index) => (
        <article className="cw-box case-stack" key={d.id}>
          <div className="case-summary">
            <CaseBadge>{d.supersedesId ? t.newDecision : t.originalDecision}</CaseBadge>
            <CaseDate value={d.createdAt} lang={lang} />
          </div>
          <p className="case-statement">{d.rationale}</p>
          <p className="cw-meta">
            {t.reason}: {translatedLabel(t.decisionReasons, d.reasonCode, t.event)}
          </p>
          <p className="cw-meta">
            {t.policy}: <bdi dir="ltr">{d.policyVersion}</bdi>
          </p>
          {d.supersedesId && (
            <p className="case-reference">
              {t.supersedes}: <bdi dir="ltr">{d.supersedesId}</bdi>
            </p>
          )}
          {!d.supersedesId && (
            <p>
              {t.appealBefore}: <CaseDate value={d.appealUntil} lang={lang} />
            </p>
          )}
          {view.availableActions.includes('APPEAL') && index === 0 && (
            <button
              type="button"
              className="case-button"
              disabled={disabled}
              onClick={() => onAction({ action: 'APPEAL', entityId: d.id })}
            >
              {ACTION_LABELS[lang].APPEAL}
            </button>
          )}
          <details className="cw-disclosure">
            <summary>{t.basis}</summary>
            <div className="case-stack">
              <ul>
                {d.basisEventIds.map((id) => (
                  <li key={id}>
                    <bdi className="case-reference" dir="ltr">
                      {id}
                    </bdi>
                  </li>
                ))}
              </ul>
              {!!d.evidenceIds.length && (
                <p className="cw-meta">
                  {t.evidenceUsed}: {d.evidenceIds.length.toLocaleString(lang)}
                </p>
              )}
            </div>
          </details>
        </article>
      ))}
      {view.appeals.map((a) => (
        <article className="cw-box" key={a.id}>
          <h3>{ACTION_LABELS[lang].APPEAL}</h3>
          <p className="cw-meta">
            <CaseDate value={a.createdAt} lang={lang} />
          </p>
          {a.grounds && <p className="case-statement">{a.grounds}</p>}
          <p>{a.status === 'OPEN' ? t.reviewPending : t.newDecision}</p>
          {a.status === 'OPEN' && view.availableActions.includes('DECIDE_APPEAL') && (
            <button
              type="button"
              className="case-button case-button-primary"
              disabled={disabled}
              onClick={() => onAction({ action: 'DECIDE_APPEAL', entityId: a.id })}
            >
              {ACTION_LABELS[lang].DECIDE_APPEAL}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
