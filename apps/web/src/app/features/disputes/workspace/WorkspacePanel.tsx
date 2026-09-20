import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useLang } from '../../../i18n/LanguageContext';
import { CaseBadge, CaseDate, CaseNotice } from '../../case-ui/CasePrimitives';
import { caseErrorStatus } from '../api';
import { useWorkspace } from './api';
import { ACTION_LABELS, WORKSPACE_COPY, WORKSPACE_STATES } from './copy';
import { WorkspaceInformation } from './WorkspaceInformation';
import { WorkspaceSolutions } from './WorkspaceSolutions';
import { WorkspaceTimeline } from './WorkspaceTimeline';
import { WorkspaceEvidence } from './WorkspaceEvidence';
import { WorkspaceOverview } from './WorkspaceOverview';
import { WorkspaceAppeals } from './WorkspaceAppeals';
import { WorkspaceCommandDialog } from './WorkspaceCommandDialog';
import { WorkspaceTaskPanel, WorkspaceTaskTabs } from './WorkspaceTaskTabs';
import {
  disputeTaskFromHash,
  disputeTaskSearch,
  selectedDisputeTask,
  type DisputeWorkspaceTaskId,
} from './dispute-task-navigation';
import type { CommandSelection } from './command-model';
import '../../case-ui/case-ui.css';
import '../../admin-provider-review/admin-review.css';
import './workspace.css';

export function WorkspacePanel({ caseId, admin = false }: { caseId: string; admin?: boolean }) {
  const { lang, dir, darkMode } = useLang(),
    t = WORKSPACE_COPY[lang];
  const query = useWorkspace(caseId, admin);
  const denied = query.isError && [401, 403, 404].includes(caseErrorStatus(query.error) ?? 0);
  const view = denied ? undefined : query.data;
  const disabled = query.isError || query.isFetching;
  const [selection, setSelection] = useState<CommandSelection | null>(null);
  const [success, setSuccess] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  // Presentation state lives in the URL so reload, deep links and the browser's
  // own history keep the reviewer where they were. Selecting a tab REPLACES the
  // entry: walking six sections must not bury the queue six steps back.
  const task = selectedDisputeTask(location.search, location.hash);
  const linkedFromHash = disputeTaskFromHash(location.hash) !== null;
  const selectTask = (next: DisputeWorkspaceTaskId) =>
    navigate(
      { search: disputeTaskSearch(location.search, next), hash: '' },
      { replace: true, state: location.state, preventScrollReset: true },
    );
  useEffect(() => {
    if (view?.disputeId) heading.current?.focus({ preventScroll: true });
  }, [view?.disputeId]);
  const actions =
    view?.availableActions.filter((a) =>
      ['ASSIGN', 'REQUEST_INFORMATION', 'PROPOSE', 'DECIDE', 'CLOSE', 'HOLD_PRIVATE_TEXT'].includes(
        a,
      ),
    ) ?? [];
  const phase = view
    ? ['GATHERING', 'PROPOSED', 'DECIDED', 'APPEALED', 'CLOSED'].indexOf(view.state)
    : 0;
  const next = view
    ? {
        GATHERING: t.gather,
        PROPOSED: t.proposed,
        DECIDED: t.decided,
        APPEALED: t.appealed,
        CLOSED: t.closed,
      }[view.state]
    : '';
  const open = (action: CommandSelection) => {
    setSuccess(false);
    setSelection(action);
  };
  const refresh = async () => {
    const result = await query.refetch();
    return result.isError ? null : (result.data ?? null);
  };
  return (
    <div
      className={`case-ui cw-workspace case-stack${admin ? ' admin-review case-admin' : ''}${darkMode ? ' dark' : ''}`}
      dir={dir}
      lang={lang}
      data-testid="dispute-workspace"
    >
      <header className="cw-header">
        <div className="cw-header-copy">
          <p className="case-eyebrow">{t.title}</p>
          <h1 ref={heading} tabIndex={-1}>
            {view ? WORKSPACE_STATES[lang][view.state] : t.loading}
          </h1>
          <p className="case-muted">{t.subtitle}</p>
          {view && (
            <p className="case-reference">
              {t.reference}: <bdi dir="ltr">{view.reference}</bdi>
            </p>
          )}
        </div>
        <button
          className="case-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw size={18} aria-hidden="true" />
          {t.refresh}
        </button>
      </header>
      {query.isPending && <p role="status">{t.loading}</p>}
      {query.isError && <CaseNotice alert>{denied ? t.denied : t.failed}</CaseNotice>}
      {view && (
        <>
          {success && (
            <p role="status" className="case-notice">
              {t.recordedSuccess}
            </p>
          )}
          {view.privacy && view.privacy.textState !== 'RETAINED' && (
            <CaseNotice>
              {view.privacy.textState === 'ERASED'
                ? lang === 'ar'
                  ? 'مُحيت النصوص الخاصة وفق سياسة الاحتفاظ. بقي سجل القرارات والوقائع دون تعديل.'
                  : 'Private text was erased under the retention policy. Decision facts and history remain unchanged.'
                : lang === 'ar'
                  ? 'انتهت مدة عرض النصوص الخاصة. لا يعني ذلك اكتمال محوها من التخزين بعد.'
                  : 'Private text access has expired. This does not yet mean storage erasure is complete.'}
            </CaseNotice>
          )}
          <ol className="cw-progress" aria-label={t.sections}>
            {t.process.map((step, i) => (
              <li key={step} aria-current={phase === i ? 'step' : undefined}>
                {(i + 1).toLocaleString(lang)}. {step}
              </li>
            ))}
          </ol>
          {/* The participant journey keeps its anchor row; the Admin workspace
              replaces it with real tabs below. */}
          {!admin && (
            <nav className="cw-nav" aria-label={t.sections}>
              {[
                ['information', t.information],
                ['evidence', t.evidence],
                ['solutions', t.solutions],
                ['appeals', t.appeals],
                ['history', t.history],
              ].map(([id, label]) => (
                <a className="case-button" href={`#case-${id}`} key={id}>
                  {label}
                </a>
              ))}
            </nav>
          )}
          <div className="cw-body">
            <aside className="cw-side case-stack">
              <section className="case-card case-stack">
                <h2>
                  <ShieldCheck size={21} aria-hidden="true" /> {t.next}
                </h2>
                <p>{next}</p>
                {view.role === 'REVIEWER' && (
                  <>
                    <CaseBadge>
                      {view.assignedToYou
                        ? t.youAssigned
                        : view.assignedReviewer
                          ? t.otherAssigned
                          : t.unassigned}
                    </CaseBadge>
                    {view.assignedReviewer && <p>{view.assignedReviewer.label}</p>}
                    {actions.map((action, i) => (
                      <button
                        key={action}
                        className={`case-button${i === 0 ? ' case-button-primary' : ''}`}
                        type="button"
                        disabled={disabled}
                        onClick={() => open({ action })}
                      >
                        {ACTION_LABELS[lang][action]}
                      </button>
                    ))}
                    {!actions.length && <p className="cw-meta">{t.noActions}</p>}
                  </>
                )}
                <p className="cw-meta">
                  {t.due}: <CaseDate value={view.policy.resolutionDueAt} lang={lang} />
                </p>
                <p className="cw-meta">{t.targetHint}</p>
              </section>
              <section className="case-card case-stack">
                <h2>{t.participants}</h2>
                {view.participants.map((p) => (
                  <div key={p.role}>
                    <p className="cw-meta">{t.roles[p.role]}</p>
                    <p>
                      <bdi dir="auto">{p.label}</bdi>
                    </p>
                  </div>
                ))}
              </section>
            </aside>
            <div className="case-stack cw-main">
              {admin ? (
                <WorkspaceTaskTabs
                  value={task}
                  onValueChange={selectTask}
                  lang={lang}
                  counts={{
                    overview: view.facts.length,
                    information: view.requests.length,
                    evidence: view.evidence.length,
                    solutions: view.proposals.length + view.decisions.length,
                    appeals: view.appeals.length,
                    history: view.events.length,
                  }}
                  focusLinkedPanel={linkedFromHash}
                >
                  <WorkspaceTaskPanel task="overview">
                    <WorkspaceOverview view={view} lang={lang} />
                  </WorkspaceTaskPanel>
                  <WorkspaceTaskPanel task="information">
                    <WorkspaceInformation
                      view={view}
                      lang={lang}
                      disabled={disabled}
                      onAction={open}
                    />
                  </WorkspaceTaskPanel>
                  <WorkspaceTaskPanel task="evidence">
                    <WorkspaceEvidence
                      view={view}
                      admin={admin}
                      lang={lang}
                      disabled={disabled}
                      onAction={open}
                    />
                  </WorkspaceTaskPanel>
                  <WorkspaceTaskPanel task="solutions">
                    <WorkspaceSolutions
                      view={view}
                      lang={lang}
                      disabled={disabled}
                      onAction={open}
                    />
                  </WorkspaceTaskPanel>
                  <WorkspaceTaskPanel task="appeals">
                    <WorkspaceAppeals view={view} lang={lang} disabled={disabled} onAction={open} />
                  </WorkspaceTaskPanel>
                  <WorkspaceTaskPanel task="history">
                    <WorkspaceTimeline view={view} admin={admin} lang={lang} />
                  </WorkspaceTaskPanel>
                </WorkspaceTaskTabs>
              ) : (
                <>
                  <WorkspaceOverview view={view} lang={lang} />
                  <WorkspaceInformation
                    view={view}
                    lang={lang}
                    disabled={disabled}
                    onAction={open}
                  />
                  <WorkspaceEvidence
                    view={view}
                    admin={admin}
                    lang={lang}
                    disabled={disabled}
                    onAction={open}
                  />
                  <WorkspaceSolutions view={view} lang={lang} disabled={disabled} onAction={open} />
                  <WorkspaceAppeals view={view} lang={lang} disabled={disabled} onAction={open} />
                  <WorkspaceTimeline view={view} admin={admin} lang={lang} />
                </>
              )}
            </div>
          </div>
          {selection && (
            <WorkspaceCommandDialog
              selection={selection}
              view={view}
              admin={admin}
              readOnly={disabled}
              lang={lang}
              onClose={() => setSelection(null)}
              onConfirmed={() => {
                setSuccess(true);
                setSelection(null);
              }}
              refresh={refresh}
            />
          )}
        </>
      )}
    </div>
  );
}
