import { useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { CaseModal } from '../../case-ui/CaseModal';
import { CaseLeaveDialog } from '../../case-ui/CaseLeaveDialog';
import { CaseNotice } from '../../case-ui/CasePrimitives';
import { caseErrorStatus } from '../api';
import { useWorkspaceCommand } from './api';
import { ACTION_LABELS, WORKSPACE_COPY } from './copy';
import { DecisionFields, SimpleCommandFields } from './CommandFields';
import {
  commandConfirmation,
  commandPayload,
  initialCommandFields,
  type CommandFields,
  type CommandSelection,
} from './command-model';

export function WorkspaceCommandDialog({
  selection,
  view,
  admin,
  readOnly,
  lang,
  onClose,
  onConfirmed,
  refresh,
}: {
  selection: CommandSelection;
  view: DisputeWorkspaceView;
  admin: boolean;
  readOnly: boolean;
  lang: 'en' | 'ar';
  onClose: () => void;
  onConfirmed: () => void;
  refresh: () => Promise<DisputeWorkspaceView | null>;
}) {
  const t = WORKSPACE_COPY[lang];
  const [fields, setFields] = useState(() => initialCommandFields(selection, view));
  const [reviewedRevision, setReviewedRevision] = useState(view.revision);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const mutation = useWorkspaceCommand(view.disputeId, admin, reviewedRevision);
  const status = caseErrorStatus(mutation.error);
  const uncertain = mutation.isError && (status === undefined || status >= 500);
  const outdated = view.revision !== reviewedRevision && !uncertain;
  const allowed = view.availableActions.includes(selection.action);
  const isDecision = selection.action === 'DECIDE' || selection.action === 'DECIDE_APPEAL';
  const blocker = useBlocker(() => !finished.current && (dirty || mutation.isPending));
  useBeforeUnload((event) => {
    if (!finished.current && (dirty || mutation.isPending)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const set = (patch: Partial<CommandFields>) => {
    setFields((current) => ({ ...current, ...patch }));
    setDirty(true);
    setInvalid(false);
  };
  const close = () => {
    if (mutation.isPending) return;
    if (dirty) {
      setDiscard(true);
      return;
    }
    onClose();
  };
  async function send() {
    if (readOnly || mutation.isPending || !allowed || outdated || status === 409) return;
    if (!fields.acknowledged || (isDecision && fields.basisEventIds.length === 0)) {
      setInvalid(true);
      window.setTimeout(() => alert.current?.focus(), 0);
      return;
    }
    try {
      await mutation.mutateAsync(commandPayload(selection, fields));
      finished.current = true;
      onConfirmed();
    } catch {
      /* The exact pending intent and entered fields are retained. */
    }
  }
  async function reviewFresh() {
    const next = await refresh();
    if (next) {
      mutation.reviewFreshVersion();
      setReviewedRevision(next.revision);
      setFields((f) => ({ ...f, acknowledged: false }));
      setInvalid(false);
    }
  }
  return (
    <>
      <CaseModal
        title={ACTION_LABELS[lang][selection.action]}
        description={t.unsent}
        admin={admin}
        pending={mutation.isPending}
        closeLabel={t.cancel}
        onClose={close}
      >
        {(readOnly || !allowed) && <CaseNotice alert>{t.paused}</CaseNotice>}
        {(outdated || status === 409) && (
          <CaseNotice alert>
            {t.conflict}
            <div>
              <button
                type="button"
                className="case-button"
                onClick={() => void reviewFresh()}
                disabled={mutation.isPending || readOnly}
              >
                {t.refreshReview}
              </button>
            </div>
          </CaseNotice>
        )}
        <form
          className="case-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          aria-busy={mutation.isPending}
        >
          <fieldset className="cw-fieldset case-stack" disabled={mutation.isPending || uncertain}>
            <SimpleCommandFields
              selection={selection}
              fields={fields}
              set={set}
              view={view}
              lang={lang}
            />
            {isDecision && <DecisionFields fields={fields} set={set} view={view} lang={lang} />}
            <label className="cw-check">
              <input
                type="checkbox"
                checked={fields.acknowledged}
                onChange={(e) => set({ acknowledged: e.target.checked })}
              />
              <span>{commandConfirmation(selection.action, lang)}</span>
            </label>
          </fieldset>
          {invalid && (
            <div ref={alert} tabIndex={-1}>
              <CaseNotice alert>{t.invalid}</CaseNotice>
            </div>
          )}
          {mutation.isError && status !== 409 && <CaseNotice alert>{t.commandFailed}</CaseNotice>}
          <footer className="case-actions">
            <button
              type="submit"
              className="case-button case-button-primary"
              data-testid="workspace-command-confirm"
              disabled={readOnly || mutation.isPending || !allowed || outdated || status === 409}
            >
              {mutation.isPending ? t.recording : uncertain ? t.retry : t.confirm}
            </button>
            <button
              type="button"
              className="case-button"
              disabled={mutation.isPending}
              onClick={close}
            >
              {t.cancel}
            </button>
          </footer>
        </form>
      </CaseModal>
      <CaseLeaveDialog
        open={discard || blocker.state === 'blocked'}
        title={t.leaveTitle}
        description={uncertain ? t.commandFailed : t.leaveHint}
        stayLabel={t.stay}
        leaveLabel={t.leave}
        pending={mutation.isPending}
        onStay={() => {
          setDiscard(false);
          if (blocker.state === 'blocked') blocker.reset();
        }}
        onLeave={() => {
          finished.current = true;
          if (blocker.state === 'blocked') blocker.proceed();
          else onClose();
        }}
      />
    </>
  );
}
