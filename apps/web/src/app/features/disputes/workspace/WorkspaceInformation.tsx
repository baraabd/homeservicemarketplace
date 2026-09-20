import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseBadge, CaseDate, CaseNotice } from '../../case-ui/CasePrimitives';
import { ACTION_LABELS, WORKSPACE_COPY, translatedLabel } from './copy';
import type { CommandSelection } from './command-model';
export function WorkspaceInformation({
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
    <section className="case-card case-stack cw-section" id="case-information">
      <h2>{t.information}</h2>
      <CaseNotice>{t.privateReplies}</CaseNotice>
      <h3>{t.requests}</h3>
      {!view.requests.length ? (
        <p className="case-muted">{t.noRequests}</p>
      ) : (
        <ul className="cw-items">
          {view.requests.map((request) => (
            <li className="cw-box" key={request.id}>
              <CaseBadge>{translatedLabel(t.requestStates, request.status, t.event)}</CaseBadge>
              <p className="case-statement">{request.question}</p>
              <p className="cw-meta">
                {t.deadline}: <CaseDate value={request.dueAt} lang={lang} />
              </p>
              {request.yours &&
                request.status === 'OPEN' &&
                view.availableActions.includes('RESPOND') && (
                  <button
                    type="button"
                    className="case-button"
                    disabled={disabled || new Date(request.dueAt) <= new Date()}
                    onClick={() => onAction({ action: 'RESPOND', entityId: request.id })}
                  >
                    {t.reply}
                  </button>
                )}
              {(request.status === 'EXPIRED' ||
                (request.status === 'OPEN' && new Date(request.dueAt) <= new Date())) && (
                <p className="cw-meta">{t.deadlinePassed}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="case-summary">
        <h3>{t.statements}</h3>
        {view.availableActions.includes('RESPOND') && (
          <button
            type="button"
            className="case-button"
            disabled={disabled}
            onClick={() => onAction({ action: 'RESPOND' })}
          >
            {ACTION_LABELS[lang].RESPOND}
          </button>
        )}
      </div>
      {!view.statements.length ? (
        <p className="case-muted">{t.noStatements}</p>
      ) : (
        <ul className="cw-items">
          {view.statements.map((s) => (
            <li className="cw-box" key={s.id}>
              <p className="cw-meta">
                {translatedLabel(t.roles, s.authorRole, t.event)} ·{' '}
                <CaseDate value={s.createdAt} lang={lang} />
              </p>
              <p className="case-statement">{s.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
