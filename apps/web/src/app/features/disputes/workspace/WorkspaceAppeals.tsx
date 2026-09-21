import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseDate } from '../../case-ui/CasePrimitives';
import { ACTION_LABELS, WORKSPACE_COPY } from './copy';
import type { CommandSelection } from './command-model';

// Sprint 12D — independent review, split out of the proposals/decisions
// section so it can own a tab.
//
// This is a MOVE, not a rewrite: the markup, the `DECIDE_APPEAL` guard and the
// `availableActions` check are the ones that already shipped. The request-an-
// appeal button deliberately stays with the original decision in
// `WorkspaceSolutions`, because appealing is an action taken ON a decision and
// splitting the two would separate the button from the text it disputes.
export function WorkspaceAppeals({
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
    <section id="case-appeals" className="case-card case-stack cw-section">
      <h2>{t.appeals}</h2>
      {!view.appeals.length && <p className="case-muted">{t.noAppeals}</p>}
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
